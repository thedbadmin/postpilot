"""LinkedIn: OAuth login (direct or via broker) and publishing through the official Posts/Images APIs."""
import base64
import hashlib
import secrets
import threading
import time
import urllib.parse
import webbrowser
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

from . import store
from .config import MOCK

AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
API = "https://api.linkedin.com"
SCOPES = "openid profile w_member_social"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif"}


class TokenError(Exception):
    """Not connected / token expired or revoked -> user must reconnect."""


class TransientError(Exception):
    """Network problem, rate limit or LinkedIn 5xx -> retry later."""


class PermanentError(Exception):
    """LinkedIn rejected the request (4xx) -> retrying won't help."""


def post_url(urn):
    return f"https://www.linkedin.com/feed/update/{urn}/" if urn else None


def token_days_left():
    t = store.get_token()
    if not t:
        return None
    from datetime import datetime
    exp = datetime.fromisoformat(t["expires_at"])
    return (exp - store.utcnow()).total_seconds() / 86400


def account():
    t = store.get_token()
    if not t:
        return {"connected": False}
    days = token_days_left()
    return {
        "connected": days is not None and days > 0,
        "name": t.get("name", ""),
        "picture": t.get("picture", ""),
        "email": t.get("email", ""),
        "headline": t.get("headline", ""),
        "expires_at": t.get("expires_at"),
        "days_left": round(days, 1) if days is not None else None,
    }


def _token():
    t = store.get_token()
    if not t:
        raise TokenError("LinkedIn account not connected.")
    if (token_days_left() or 0) <= 0:
        raise TokenError("LinkedIn session expired. Please reconnect.")
    return t


def _headers(t, json_body=True):
    h = {
        "Authorization": f"Bearer {t['access_token']}",
        "Linkedin-Version": str(store.get_setting("li_version")),
        "X-Restli-Protocol-Version": "2.0.0",
    }
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def _check(r, ok, what):
    if r.status_code in ok:
        return
    msg = f"{what}: LinkedIn API {r.status_code}: {r.text[:300]}"
    if r.status_code == 401:
        raise TokenError("LinkedIn rejected the session (401). Please reconnect.")
    if r.status_code == 429 or r.status_code >= 500:
        raise TransientError(msg)
    raise PermanentError(msg)


def _req(method, url, **kw):
    try:
        return requests.request(method, url, timeout=kw.pop("timeout", 30), **kw)
    except requests.RequestException as e:
        raise TransientError(f"Network error: {e}") from e


# ---------------- login ----------------
login_state = {"status": "idle", "error": None}  # idle|waiting|done|error


def _finish_login(tok):
    u = _req("GET", f"{API}/v2/userinfo", headers={"Authorization": f"Bearer {tok['access_token']}"})
    if u.status_code != 200:
        raise PermanentError(f"Userinfo failed: {u.status_code} {u.text[:200]}")
    info = u.json()
    store.set_token({
        "access_token": tok["access_token"],
        "expires_at": store.iso(store.utcnow() + timedelta(seconds=int(tok.get("expires_in", 5184000)))),
        "person_urn": f"urn:li:person:{info['sub']}",
        "name": info.get("name", ""),
        "picture": info.get("picture", ""),
        "email": info.get("email", ""),
    })
    store.log("success", f"LinkedIn connected as {info.get('name', '')}.")


def _direct_login():
    s = store.get_settings()
    client_id, secret = s["client_id"], store.get_secret("li_client_secret")
    if not client_id or not secret:
        raise PermanentError("Add your LinkedIn Client ID and Client Secret in Settings first.")
    redirect = s["redirect_uri"]
    state = secrets.token_urlsafe(16)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": client_id, "redirect_uri": redirect,
        "scope": SCOPES, "state": state,
    })
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in qs or "error" in qs:
                result.update({k: v[0] for k, v in qs.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<html><body style='font-family:sans-serif;text-align:center;padding:60px'>"
                             b"<h2>PostPilot is connected.</h2><p>You can close this tab and return to the app.</p>"
                             b"</body></html>")

        def log_message(self, *a):
            pass

    p = urllib.parse.urlparse(redirect)
    server = HTTPServer((p.hostname if p.hostname != "localhost" else "127.0.0.1", p.port or 80), Handler)
    server.timeout = 1
    webbrowser.open(url)
    deadline = time.time() + 300
    try:
        while "code" not in result and "error" not in result:
            if time.time() > deadline:
                raise PermanentError("Login timed out. Please try again.")
            server.handle_request()
    finally:
        server.server_close()
    if "error" in result:
        raise PermanentError(f"LinkedIn login cancelled: {result.get('error_description', result['error'])}")
    if result.get("state") != state:
        raise PermanentError("Login state mismatch. Please try again.")
    r = _req("POST", TOKEN_URL, data={
        "grant_type": "authorization_code", "code": result["code"],
        "client_id": client_id, "client_secret": secret, "redirect_uri": redirect,
    })
    if r.status_code != 200:
        raise PermanentError(f"Token exchange failed: {r.status_code} {r.text[:200]}")
    _finish_login(r.json())


def _broker_login():
    """Hosted login server keeps the Client Secret off user machines (see auth_broker/)."""
    base = store.get_setting("broker_url").rstrip("/")
    if not base:
        raise PermanentError("Set the login server URL in Settings.")
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    webbrowser.open(f"{base}/start?" + urllib.parse.urlencode({"state": state, "challenge": challenge}))
    deadline = time.time() + 300
    while time.time() < deadline:
        time.sleep(2)
        r = _req("POST", f"{base}/claim", json={"state": state, "verifier": verifier})
        if r.status_code == 200:
            _finish_login(r.json())
            return
        if r.status_code not in (202, 404):
            raise PermanentError(f"Login server error: {r.status_code} {r.text[:200]}")
    raise PermanentError("Login timed out. Please try again.")


def start_login():
    if login_state["status"] == "waiting":
        return login_state

    def run():
        try:
            if MOCK:
                time.sleep(1)
                store.set_token({"access_token": "mock", "person_urn": "urn:li:person:MOCK",
                                 "expires_at": store.iso(store.utcnow() + timedelta(days=60)),
                                 "name": "Versha Jain", "picture": "", "email": ""})
                store.log("success", "LinkedIn connected (demo mode).")
            elif store.get_setting("auth_mode") == "broker":
                _broker_login()
            else:
                _direct_login()
            login_state.update(status="done", error=None)
        except Exception as e:  # noqa: BLE001 - surface any failure to the UI
            login_state.update(status="error", error=str(e))
            store.log("error", f"LinkedIn login failed: {e}")

    login_state.update(status="waiting", error=None)
    threading.Thread(target=run, daemon=True).start()
    return login_state


def logout():
    store.set_token(None)
    store.log("info", "LinkedIn disconnected.")


# ---------------- publishing ----------------
def upload_image(path):
    t = _token()
    if MOCK:
        return f"urn:li:image:MOCK{secrets.token_hex(4)}"
    r = _req("POST", f"{API}/rest/images?action=initializeUpload", headers=_headers(t),
             json={"initializeUploadRequest": {"owner": t["person_urn"]}})
    _check(r, (200,), "Image init")
    v = r.json()["value"]
    with open(path, "rb") as f:
        up = _req("PUT", v["uploadUrl"], data=f, headers={"Authorization": f"Bearer {t['access_token']}"},
                  timeout=180)
    _check(up, (200, 201), "Image upload")
    return v["image"]


def _escape_little_text(s):
    # LinkedIn "little text" reserves these characters in commentary. A '#' followed by a word is kept
    # so it renders as a hashtag (HashtagElement); a lone '#' is escaped.
    import re
    s = re.sub(r"([\\|{}@\[\]()<>*_~])", r"\\\1", s)
    return re.sub(r"#(?!\w)", r"\\#", s)


def publish(post):
    """Publish a post dict (from store). Returns the post URN."""
    t = _token()
    body = {
        "author": t["person_urn"],
        "commentary": _escape_little_text(post["text"]),
        "visibility": "PUBLIC",
        "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [],
                         "thirdPartyDistributionChannels": []},
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }
    media_ids = post.get("media") or []
    link = post.get("link")
    if media_ids:
        urns = []
        for mid in media_ids:
            p = store.media_path(mid)
            if not p or not p.exists():
                raise PermanentError("An attached image file is missing. Edit the post and re-attach it.")
            urns.append(upload_image(p))
        imgs = [{"id": u, "altText": (post.get("alt") or "")[:4086]} for u in urns]
        body["content"] = {"media": imgs[0]} if len(imgs) == 1 else {"multiImage": {"images": imgs}}
    elif link and link.get("url"):
        art = {"source": link["url"], "title": link.get("title") or link["url"]}
        if link.get("desc"):
            art["description"] = link["desc"]
        if link.get("thumb"):
            p = store.media_path(link["thumb"])
            if p and p.exists():
                art["thumbnail"] = upload_image(p)
        body["content"] = {"article": art}
    if MOCK:
        if "FAIL" in post["text"]:
            raise PermanentError("LinkedIn API 422: mock failure")
        time.sleep(0.3)
        return f"urn:li:share:{int(time.time() * 1000)}"
    r = _req("POST", f"{API}/rest/posts", headers=_headers(t), json=body)
    _check(r, (201,), "Post")
    return r.headers.get("x-restli-id", "")
