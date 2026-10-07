"""Instagram agent: someone comments a keyword -> they get a DM with your link (optionally only after following).

Runs in its own thread next to the LinkedIn scheduler and polls Instagram (no webhooks, nothing public).
Makes no Instagram calls at all until a token is saved.
"""
import random
import re
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import instagram, store
from .config import MOCK

TICK_SECONDS = 60
MAX_DMS_PER_HOUR = 150    # Meta allows about 200 automated DMs an hour; stay well under it
MAX_FOLLOW_TRIES = 3      # follow checks per person before giving up (= 2 reminders)
WINDOW_DAYS = 7           # Meta: the private reply must come within 7 days of the comment
ANY_POST_MEDIA = 10       # "any post" automations watch your newest 10 posts
MAX_TEXT_BYTES = 1000     # Instagram DM text limit

DEFAULT_TEXTS = {
    "dm_text": "Hey {name}! Here's the link you asked for 👇\n{link}",
    "gate_text": "Hey {name}! 🙌 Happy to send it. Please follow {account} first, then reply DONE here "
                 "and I'll send the link right away.",
    "nofollow_text": "I can't see your follow yet 🙂 Follow {account}, then reply DONE again.",
}

state = {"running": False, "last_tick": None, "last_error": None, "note": None}
_wake = threading.Event()


def wake():
    _wake.set()


# ---------------- messages ----------------
def _render(tpl, a, username):
    me = instagram.get_token() or {}
    return ((tpl or "").replace("{name}", f"@{username}").replace("{account}", f"@{me.get('username', '')}")
            .replace("{link}", a["link"] or "").strip())


def _link_message(a, username):
    text = _render(a["dm_text"], a, username)
    return f"{text}\n\n{a['link']}".strip() if a["link"] and a["link"] not in text else text


def _matches(a, text):
    kws = [k.strip().lower() for k in (a["keywords"] or "").split(",") if k.strip()]
    low = (text or "").lower()
    return not kws or any(re.search(rf"(?<!\w){re.escape(k)}(?!\w)", low) for k in kws)


def _pick(autos, media_id, text, when):
    for a in sorted(autos, key=lambda a: not a["media_id"]):  # a post's own automation wins over "any post"
        since = datetime.fromisoformat(a["active_since"]).replace(microsecond=0)  # Meta stamps whole seconds
        if a["media_id"] in (media_id, "") and when >= since and _matches(a, text):
            return a
    return None


def _set(comment_id, **f):
    f["updated_at"] = store.iso(store.utcnow())
    store.q(f"UPDATE ig_events SET {', '.join(k + '=?' for k in f)} WHERE comment_id=?", (*f.values(), comment_id))


# ---------------- the loop ----------------
def _scan(autos):
    """New matching comments -> claim them in ig_events (each comment only once) -> answer."""
    me = instagram.get_token()
    watch = {a["media_id"] for a in autos if a["media_id"]}
    if any(not a["media_id"] for a in autos):
        watch |= {m["id"] for m in instagram.recent_media(ANY_POST_MEDIA)}
    oldest = store.utcnow() - timedelta(days=WINDOW_DAYS)
    since = store.iso(store.utcnow() - timedelta(hours=1))
    budget = MAX_DMS_PER_HOUR - store.q("SELECT COUNT(*) c FROM ig_events WHERE status <> 'duplicate' "
                                        "AND created_at >= ?", (since,), one=True)["c"]
    for mid in watch:
        for c in instagram.comments(mid):
            frm = c.get("from") or {}
            uid, uname = frm.get("id"), frm.get("username") or c.get("username") or ""
            if not uid or uid == me["user_id"] or uname == me["username"]:
                continue  # our own replies
            when = instagram.ts(c["timestamp"])
            if when < oldest or store.q("SELECT 1 FROM ig_events WHERE comment_id=?", (c["id"],), one=True):
                continue
            a = _pick(autos, mid, c.get("text", ""), when)
            if not a:
                continue
            if budget <= 0:  # left unclaimed, so it is picked up next hour (still inside the 7 days)
                state["note"] = f"Hourly limit of {MAX_DMS_PER_HOUR} DMs reached; the rest go out next hour."
                return
            budget -= 1
            _answer(a, c, mid, uid, uname, when)


def _answer(a, c, mid, uid, uname, when):
    now = store.iso(store.utcnow())
    dup = store.q("SELECT 1 FROM ig_events WHERE automation_id=? AND user_id=? AND status NOT IN ('failed','duplicate')",
                  (a["id"], uid), one=True)
    store.q("INSERT INTO ig_events(comment_id, automation_id, media_id, user_id, username, text, status, commented_at, "
            "created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (c["id"], a["id"], mid, uid, uname, c.get("text", ""), "duplicate" if dup else "new", store.iso(when), now, now))
    if dup:
        return  # one DM per person per automation, however often they comment
    note = None
    replies = [r.strip() for r in (a["public_replies"] or "").splitlines() if r.strip()]
    try:
        if replies:
            try:
                instagram.reply_comment(c["id"], _render(random.choice(replies), a, uname))
            except instagram.IGTokenError:
                raise
            except instagram.IGError as e:
                note = f"Public reply failed: {e}"
        sent_at = store.utcnow()
        if a["require_follow"]:
            instagram.private_reply(c["id"], _render(a["gate_text"], a, uname))
            _set(c["id"], status="awaiting", prompted_at=store.iso(sent_at), error=note)
        else:
            instagram.private_reply(c["id"], _link_message(a, uname))
            _set(c["id"], status="sent", error=note)
    except instagram.IGTokenError:
        store.q("DELETE FROM ig_events WHERE comment_id=?", (c["id"],))  # nothing was sent: retry after reconnecting
        raise
    except instagram.IGError as e:
        _set(c["id"], status="failed", error=str(e))


def _follow_ups():
    """People who were asked to follow: once they reply, check the follow and send the link or a reminder."""
    waiting = store.q("SELECT * FROM ig_events WHERE status='awaiting'")
    if not waiting:
        return
    inbox = instagram.recent_messages()
    expire_before = store.utcnow() - timedelta(days=WINDOW_DAYS)
    for e in waiting:
        asked = datetime.fromisoformat(e["prompted_at"])
        if not any(t > asked for t, _ in inbox.get(e["user_id"], [])):
            if asked < expire_before:
                _set(e["comment_id"], status="expired", error="No reply within 7 days.")
            continue
        a = store.q("SELECT * FROM ig_automations WHERE id=?", (e["automation_id"],), one=True)
        if not a:
            _set(e["comment_id"], status="expired", error="The automation was deleted.")
            continue
        sent_at = store.utcnow()
        try:
            if instagram.follows_me(e["user_id"]):
                instagram.send_dm(e["user_id"], _link_message(a, e["username"]))
                _set(e["comment_id"], status="sent", error=None)
            elif e["attempts"] + 1 >= MAX_FOLLOW_TRIES:
                _set(e["comment_id"], status="gave_up", attempts=e["attempts"] + 1, error=None)
            else:
                instagram.send_dm(e["user_id"], _render(a["nofollow_text"], a, e["username"]))
                _set(e["comment_id"], attempts=e["attempts"] + 1, prompted_at=store.iso(sent_at), error=None)
        except instagram.IGTokenError:
            raise
        except instagram.IGError as ex:
            _set(e["comment_id"], status="failed", error=str(ex))


def tick():
    if not instagram.get_token():
        return
    state["note"] = None
    instagram.refresh_if_due()
    autos = store.q("SELECT * FROM ig_automations WHERE active")
    if autos:
        _scan(autos)
    _follow_ups()


def _loop():
    state["running"] = True
    try:  # a crash mid-send leaves 'new'; the DM may have gone out, so never resend automatically
        store.q("UPDATE ig_events SET status='failed', error=? WHERE status='new'",
                ("PostPilot stopped while sending this DM. Check your Instagram inbox.",))
    except Exception:  # noqa: BLE001
        pass
    while True:
        try:
            if not store.get_setting("ig_paused"):
                tick()
            state.update(last_tick=store.iso(store.utcnow()), last_error=None)
        except Exception as e:  # noqa: BLE001 - shown in the Instagram tab; LinkedIn is unaffected
            state["last_error"] = str(e)
        _wake.wait(TICK_SECONDS)
        _wake.clear()


def start():
    if not state["running"]:
        threading.Thread(target=_loop, daemon=True, name="instagram").start()


# ---------------- API (mounted by server.py under its auth) ----------------
router = APIRouter(prefix="/api/insta")


@router.get("/status")
def status():
    tz = ZoneInfo(store.get_setting("timezone"))
    today = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    c = {r["status"]: r["c"] for r in store.q("SELECT status, COUNT(*) c FROM ig_events GROUP BY status")}
    return {
        "mock": MOCK, "account": instagram.account(), "defaults": DEFAULT_TEXTS,
        "agent": {**state, "paused": bool(store.get_setting("ig_paused")), "tick_seconds": TICK_SECONDS},
        "counts": {"sent_today": store.q("SELECT COUNT(*) c FROM ig_events WHERE status='sent' AND updated_at>=?",
                                         (store.iso(today),), one=True)["c"],
                   "sent": c.get("sent", 0), "awaiting": c.get("awaiting", 0), "failed": c.get("failed", 0),
                   "automations": store.q("SELECT COUNT(*) c FROM ig_automations WHERE active", one=True)["c"]},
        "limits": {"dms_per_hour": MAX_DMS_PER_HOUR, "follow_tries": MAX_FOLLOW_TRIES, "window_days": WINDOW_DAYS},
    }


class TokenIn(BaseModel):
    token: str


@router.post("/connect")
def connect(body: TokenIn):
    tok = body.token.strip()
    if len(tok) < 20 or " " in tok:
        raise HTTPException(400, "That doesn't look like an Instagram access token.")
    acct = instagram.connect(tok)
    wake()
    return acct


@router.post("/disconnect")
def disconnect():
    instagram.disconnect()
    return {"ok": True}


@router.get("/media")
def media():
    return instagram.recent_media(24)


class AutoIn(BaseModel):
    name: str = ""
    media_id: str = ""        # "" = any of your newest posts
    media_caption: str = ""
    media_thumb: str = ""
    media_permalink: str = ""
    keywords: str = ""        # comma-separated; "" = any comment
    require_follow: bool = False
    link: str = ""
    dm_text: str = ""
    gate_text: str = ""
    nofollow_text: str = ""
    public_replies: str = ""  # one per line; a random one is posted under the comment
    active: bool = True


def _clean(body):
    d = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items()}
    d["keywords"] = ", ".join(dict.fromkeys(k.strip() for k in d["keywords"].split(",") if k.strip()))
    if d["link"] and not re.match(r"https?://\S+$", d["link"]):
        raise HTTPException(400, "The link must start with http:// or https:// and have no spaces.")
    if not (d["dm_text"] or d["link"]):
        raise HTTPException(400, "Add the message or the link to send.")
    if d["require_follow"] and not (d["gate_text"] and d["nofollow_text"]):
        raise HTTPException(400, "Add both follow messages, or turn off “Only for followers”.")
    if max(len((d["dm_text"] + d["link"]).encode()), len(d["gate_text"].encode()),
           len(d["nofollow_text"].encode())) > MAX_TEXT_BYTES - 60:
        raise HTTPException(400, "Messages must stay under about 900 characters (Instagram's DM limit).")
    return d


def _get(aid):
    a = store.q("SELECT * FROM ig_automations WHERE id=?", (aid,), one=True)
    if not a:
        raise HTTPException(404, "Automation not found")
    return dict(a)


@router.get("/automations")
def automations():
    return [dict(r) for r in store.q(
        "SELECT a.*, (SELECT COUNT(*) FROM ig_events e WHERE e.automation_id=a.id AND e.status='sent') sent "
        "FROM ig_automations a ORDER BY a.id DESC")]


@router.post("/automations")
def create_automation(body: AutoIn):
    d, now = _clean(body), store.iso(store.utcnow())
    aid = store.q(f"INSERT INTO ig_automations({', '.join(d)}, active_since, created_at, updated_at) "
                  f"VALUES({', '.join('?' * (len(d) + 3))})", (*d.values(), now, now, now))
    wake()
    return _get(aid)


@router.put("/automations/{aid}")
def update_automation(aid: int, body: AutoIn):
    old, d = _get(aid), _clean(body)
    d["updated_at"] = store.iso(store.utcnow())
    if d["active"] and not old["active"]:
        d["active_since"] = d["updated_at"]  # comments made while it was off are not answered
    store.q(f"UPDATE ig_automations SET {', '.join(k + '=?' for k in d)} WHERE id=?", (*d.values(), aid))
    wake()
    return _get(aid)


@router.delete("/automations/{aid}")
def delete_automation(aid: int):
    store.q("DELETE FROM ig_automations WHERE id=?", (aid,))
    return {"ok": True}


@router.get("/events")
def events(limit: int = 200):
    return [dict(r) for r in store.q(
        "SELECT e.*, a.name automation FROM ig_events e LEFT JOIN ig_automations a ON a.id=e.automation_id "
        "ORDER BY e.created_at DESC LIMIT ?", (max(1, min(limit, 1000)),))]


class PauseIn(BaseModel):
    paused: bool


@router.post("/pause")
def pause(body: PauseIn):
    store.set_settings({"ig_paused": body.paused})
    wake()
    return {"paused": body.paused}


@router.post("/check")
def check_now():
    wake()
    return {"ok": True}


class SimIn(BaseModel):
    media_id: str
    username: str = "test_follower"
    text: str = "HANDBOOK"
    follows: bool = True


@router.post("/simulate")
def simulate(body: SimIn):
    if not MOCK:
        raise HTTPException(404, "Only available in demo mode.")
    instagram.mock_comment(body.media_id, body.username.strip().lstrip("@") or "test_follower", body.text, body.follows)
    wake()
    return {"ok": True}
