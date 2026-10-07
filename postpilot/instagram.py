"""Instagram: Graph API client for the comment-to-DM agent (Instagram API with Instagram Login).

Single user: the long-lived token is pasted from the Meta app dashboard (no OAuth redirect, nothing public)
and refreshed daily, so it never reaches its 60-day expiry. Everything is polled; there are no webhooks.
"""
import json
import secrets
from datetime import datetime, timedelta

import requests

from . import store
from .config import MOCK

API = "https://graph.instagram.com/v23.0"  # Graph versions live ~2 years; bump when Meta retires this one
REFRESH_URL = "https://graph.instagram.com/refresh_access_token"
REFRESH_EVERY = timedelta(hours=24)  # a token can be refreshed once it is 24 h old; each refresh = 60 more days


class IGError(Exception):
    """Instagram rejected the request or couldn't be reached."""


class IGTokenError(IGError):
    """Token missing, expired or revoked -> paste a new one in Instagram settings."""


def ts(s):
    """Meta timestamp ('2026-10-06T10:00:00+0000') -> aware datetime."""
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%S%z")


# ---------------- token ----------------
def get_token():
    raw = store.get_secret("ig_token")
    return json.loads(raw) if raw else None


def _save(tok):
    store.set_secret("ig_token", json.dumps(tok) if tok else "")


def _token():
    t = get_token()
    if not t:
        raise IGTokenError("Instagram is not connected. Paste your token in Instagram → Settings.")
    return t["access_token"]


def account():
    t = get_token()
    if not t:
        return {"connected": False}
    days = (datetime.fromisoformat(t["expires_at"]) - store.utcnow()).total_seconds() / 86400
    return {"connected": days > 0, "user_id": t["user_id"], "username": t["username"], "name": t.get("name", ""),
            "picture": t.get("picture", ""), "followers": t.get("followers"), "days_left": round(days, 1)}


def connect(access_token):
    info = _call("GET", "me", token=access_token,
                 params={"fields": "user_id,username,name,profile_picture_url,followers_count"})
    now = store.utcnow()
    tok = {"access_token": access_token, "user_id": str(info.get("user_id") or info["id"]),
           "username": info.get("username", ""), "name": info.get("name", ""),
           "picture": info.get("profile_picture_url", ""), "followers": info.get("followers_count"),
           "expires_at": store.iso(now + timedelta(days=60)), "refreshed_at": store.iso(now)}
    _save(tok)
    try:
        _refresh(tok)  # learns the real expiry; fails harmlessly while the token is under 24 h old
    except IGError:
        pass
    return account()


def disconnect():
    _save(None)


def _refresh(tok):
    if MOCK:
        return
    try:
        r = requests.get(REFRESH_URL, params={"grant_type": "ig_refresh_token", "access_token": tok["access_token"]},
                         timeout=30)
    except requests.RequestException as e:  # no {e}: the URL contains the token
        raise IGError("Could not reach Instagram to renew the token.") from e
    data = _result(r)
    now = store.utcnow()
    tok.update(access_token=data["access_token"], refreshed_at=store.iso(now),
               expires_at=store.iso(now + timedelta(seconds=int(data.get("expires_in", 5184000)))))
    _save(tok)


def refresh_if_due():
    t = get_token()
    if not t or store.utcnow() - datetime.fromisoformat(t["refreshed_at"]) < REFRESH_EVERY:
        return
    try:
        _refresh(t)
    except IGTokenError:
        raise
    except IGError:  # network hiccup: try again tomorrow, there are weeks of margin
        t["refreshed_at"] = store.iso(store.utcnow())
        _save(t)


# ---------------- API calls ----------------
def _result(r):
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code == 200:
        return data
    err = data.get("error") or {}
    msg = err.get("message") or r.text[:200]
    if err.get("error_user_msg"):  # Meta's plain-language reason, e.g. "Link can't be shared: ..." behind "Invalid message id"
        msg = f"{err.get('error_user_title') or msg}: {err['error_user_msg']}"
    if r.status_code == 401 or err.get("code") == 190:
        raise IGTokenError(f"Instagram rejected the token ({msg}). Paste a new token in Instagram → Settings.")
    raise IGError(f"Instagram API {r.status_code}: {msg}")


def _call(method, path, token=None, params=None, body=None):
    tok = token or _token()
    if MOCK:
        return _mock(method, path, params or {}, body or {})
    try:
        r = requests.request(method, f"{API}/{path}", params=params, json=body, timeout=30,
                             headers={"Authorization": f"Bearer {tok}"})
    except requests.RequestException as e:
        raise IGError(f"Could not reach Instagram: {e}") from e
    return _result(r)


def recent_media(limit=24):
    return _call("GET", "me/media", params={"limit": limit, "fields": "id,caption,media_type,media_product_type,"
                                            "thumbnail_url,media_url,permalink,timestamp,comments_count"}).get("data", [])


def comments(media_id):
    """Newest top-level comments on a post, each with from{id, username}."""
    return _call("GET", f"{media_id}/comments", params={"fields": "id,text,timestamp,from,username",
                                                        "limit": 50}).get("data", [])


def private_reply(comment_id, text):
    """The one DM Meta allows in answer to a comment (within 7 days of it)."""
    return _call("POST", "me/messages", body={"recipient": {"comment_id": comment_id}, "message": {"text": text}})


def send_dm(user_id, text):
    """Normal DM; only allowed within 24 h of the person's last message to us."""
    return _call("POST", "me/messages", body={"recipient": {"id": user_id}, "message": {"text": text}})


def send_file(user_id, url):
    """A PDF (max 25 MB) Instagram downloads from a public URL; like send_dm, only after the person has replied."""
    return _call("POST", "me/messages", body={"recipient": {"id": user_id},
                                              "message": {"attachment": {"type": "file", "payload": {"url": url}}}})


def reply_comment(comment_id, text):
    return _call("POST", f"{comment_id}/replies", body={"message": text})


def follows_me(user_id):
    return bool(_call("GET", user_id, params={"fields": "username,is_user_follow_business"})
                .get("is_user_follow_business"))


def recent_messages(limit=25):
    """Latest DMs from other people, from the most recently active conversations: {user_id: [(time, text)]}."""
    data = _call("GET", "me/conversations", params={"platform": "instagram", "limit": limit,
                                                    "fields": "messages.limit(5){from,message,created_time}"})
    out = {}
    for conv in data.get("data", []):
        for m in (conv.get("messages") or {}).get("data", []):
            uid = (m.get("from") or {}).get("id")
            if uid:
                out.setdefault(uid, []).append((ts(m["created_time"]), m.get("message", "")))
    return out


# ---------------- demo mode: a fake Instagram so the whole flow runs without Meta ----------------
_ME = "17840000000000000"


def _stamp(sec=0):
    return (store.utcnow() + timedelta(seconds=sec)).strftime("%Y-%m-%dT%H:%M:%S+0000")


_M = {"comments": {}, "users": {}, "msgs": [], "media": [
    {"id": "18000000000000001", "media_type": "IMAGE", "media_url": "/static/icon.png", "comments_count": 0,
     "caption": "The Ultimate PostgreSQL 17 → 18 Upgrade Handbook. Comment HANDBOOK and I'll DM you the guide!",
     "permalink": "https://www.instagram.com/p/demo1/"},
    {"id": "18000000000000002", "media_type": "VIDEO", "media_product_type": "REELS", "media_url": "/static/icon.png",
     "caption": "UPDATE ≠ OVERWRITE: how MVCC really works", "permalink": "https://www.instagram.com/reel/demo2/"},
    {"id": "18000000000000003", "media_type": "CAROUSEL_ALBUM", "media_url": "/static/icon.png",
     "caption": "The Modern DBA: Arjun's journey from SQL to production", "permalink": "https://www.instagram.com/p/demo3/"},
]}


def mock_comment(media_id, username, text, follows):
    """Demo only: a fake follower comments; they reply "done" to the bot's first 3 DMs."""
    uid = "1784" + str(abs(hash(username)) % 10 ** 12).zfill(12)
    _M["users"][uid] = {"username": username, "follows": follows, "replies_left": 3}
    _M["comments"].setdefault(media_id, []).insert(0, {
        "id": "1790" + str(secrets.randbelow(10 ** 12)).zfill(12), "text": text, "timestamp": _stamp(),
        "from": {"id": uid, "username": username}, "username": username})


def _mock(method, path, params, body):
    if path == "me":
        return {"user_id": _ME, "username": "thedbadmin", "name": "TheDBAdmin (demo)", "followers_count": 89}
    if path == "me/media":
        return {"data": _M["media"]}
    if path.endswith("/comments"):
        return {"data": _M["comments"].get(path.split("/")[0], [])}
    if path.endswith("/replies"):
        return {"id": "1790" + str(secrets.randbelow(10 ** 12))}
    if path == "me/messages":
        to = body["recipient"]
        uid = to.get("id") or next(c["from"]["id"] for cs in _M["comments"].values() for c in cs
                                   if c["id"] == to.get("comment_id"))
        msg = body["message"]
        text = msg.get("text") or f"[file] {msg['attachment']['payload']['url']}"
        _M["msgs"].append({"from": {"id": _ME}, "to": uid, "message": text, "created_time": _stamp()})
        u = _M["users"][uid]
        if u["replies_left"] > 0:
            u["replies_left"] -= 1
            _M["msgs"].append({"from": {"id": uid, "username": u["username"]}, "to": _ME, "message": "done",
                               "created_time": _stamp(2)})
        return {"recipient_id": uid, "message_id": "m_" + secrets.token_hex(6)}
    if path == "me/conversations":
        convs = {}
        for m in reversed(_M["msgs"]):
            other = m["to"] if m["from"]["id"] == _ME else m["from"]["id"]
            convs.setdefault(other, []).append({k: m[k] for k in ("from", "message", "created_time")})
        return {"data": [{"messages": {"data": ms[:5]}} for ms in convs.values()]}
    if path in _M["users"]:
        u = _M["users"][path]
        return {"username": u["username"], "is_user_follow_business": u["follows"]}
    raise IGError(f"Instagram API 400: demo mode has no {method} {path}")
