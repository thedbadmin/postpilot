"""WhatsApp: client for the company number, through Kapso (an official Meta partner).

Why Kapso: the number lives in the WhatsApp Business app, and only Meta partners may connect such a number to the
API while the app keeps working ("coexistence"). Kapso's free plan does that, and it keeps every message, so
PostPilot just polls it like the Instagram agent: no webhook, nothing public. Sending uses Kapso's copy of
Meta's Cloud API (same request bodies), so moving straight to Meta later only changes the URLs.
"""
import json
import secrets
from datetime import datetime, timedelta, timezone

import requests

from . import store
from .config import MOCK

PLATFORM = "https://api.kapso.ai/platform/v1"
CLOUD = "https://api.kapso.ai/meta/whatsapp/v24.0"
WINDOW_CLOSED = (131047, 131026, 470)  # Meta: more than 24 h since this person last wrote -> template only


class WAError(Exception):
    """WhatsApp/Kapso rejected the request or couldn't be reached."""


class WAKeyError(WAError):
    """API key missing or revoked -> paste a new one in WhatsApp settings."""


class WAWindowError(WAError):
    """Free-form messages are only allowed within 24 h of the person's last message."""


# ---------------- connection ----------------
def get_conn():
    raw = store.get_secret("wa_conn")
    return json.loads(raw) if raw else None


def account():
    c = get_conn()
    if not c:
        return {"connected": False}
    return {"connected": True, **{k: c.get(k, "") for k in ("phone_number_id", "number", "name", "coexistence")}}


def connect(api_key, phone_number_id=""):
    """Checks the key and finds the number: the only one in the Kapso project, or the one given."""
    nums = _call("GET", f"{PLATFORM}/whatsapp/phone_numbers", key=api_key, params={"per_page": 50}).get("data", [])
    if phone_number_id:
        nums = [n for n in nums if str(n.get("phone_number_id")) == phone_number_id]
    if not nums:
        raise WAError("No WhatsApp number found in this Kapso project. Connect the number in Kapso first.")
    if len(nums) > 1:
        raise WAError("This Kapso project has several numbers. Paste the Phone number ID of the company number too.")
    n = nums[0]
    store.set_secret("wa_conn", json.dumps({
        "api_key": api_key, "phone_number_id": str(n["phone_number_id"]),
        "number": n.get("display_phone_number") or n.get("display_phone_number_normalized") or "",
        "name": n.get("verified_name") or n.get("display_name") or n.get("name") or "",
        "coexistence": bool(n.get("is_coexistence")), "connected_at": store.iso(store.utcnow())}))
    return account()


def disconnect():
    store.set_secret("wa_conn", "")


# ---------------- API calls ----------------
def _result(r):
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code in (200, 201):
        return data
    err = data.get("error") if isinstance(data.get("error"), dict) else {}
    msg = err.get("message") or data.get("message") or (data.get("error") if isinstance(data.get("error"), str) else "") \
        or r.text[:200]
    details = (err.get("error_data") or {}).get("details")
    if details:
        msg = f"{msg}: {details}"
    if r.status_code == 401:
        raise WAKeyError(f"Kapso rejected the API key ({msg}). Paste a new key in WhatsApp → Settings.")
    if err.get("code") in WINDOW_CLOSED:
        raise WAWindowError(msg)
    raise WAError(f"WhatsApp API {r.status_code}: {msg}")


def _call(method, url, key=None, params=None, body=None):
    if not key:
        c = get_conn()
        if not c:
            raise WAKeyError("WhatsApp is not connected. Paste your Kapso API key in WhatsApp → Settings.")
        key = c["api_key"]
    if MOCK:
        return _mock(method, url, params or {}, body or {})
    try:
        r = requests.request(method, url, params=params, json=body, timeout=30, headers={"X-API-Key": key})
    except requests.RequestException as e:
        raise WAError(f"Could not reach Kapso: {e}") from e
    return _result(r)


def recent_messages(limit=50):
    """Newest messages of the company number, both directions, as
    {id, contact, name, sender: customer|bot|boss|history, text, at}. 'bot' = sent through the API."""
    c = get_conn()
    if MOCK and c:
        return [dict(m) for m in _M["msgs"][:limit]]
    data = _call("GET", f"{PLATFORM}/whatsapp/messages",
                 params={"phone_number_id": c["phone_number_id"], "limit": limit}).get("data", [])
    out = []
    for m in data:
        k = m.get("kapso") or {}
        inbound = k.get("direction") == "inbound"
        contact = k.get("phone_number") or (m.get("from") if inbound else m.get("to")) \
            or (m.get("from_user_id") if inbound else m.get("to_user_id"))
        if not contact:
            continue
        origin = k.get("origin") or "cloud_api"
        sender = "history" if origin == "history_sync" else "customer" if inbound \
            else "boss" if origin == "business_app" else "bot"
        out.append({"id": m["id"], "contact": str(contact).lstrip("+"), "name": k.get("contact_name") or "",
                    "sender": sender, "text": _text(m),
                    "at": datetime.fromtimestamp(int(m.get("timestamp") or 0), timezone.utc)})
    return out


def _text(m):
    t = m.get("type")
    if t == "text":
        return (m.get("text") or {}).get("body", "")
    caption = ((m.get(t) or {}) if isinstance(m.get(t), dict) else {}).get("caption", "")
    label = {"audio": "voice note", "image": "photo", "video": "video", "document": "file", "sticker": "sticker",
             "location": "location", "contacts": "contact card", "reaction": "reaction"}.get(t, t or "message")
    if t == "button":
        return (m.get("button") or {}).get("text", "")
    if t == "interactive":
        return (m.get("kapso") or {}).get("content") or "[button reply]"
    return f"[sent a {label}]" + (f" {caption}" if caption else "")


def _to(contact):
    """Phone numbers go in 'to'; Meta's newer user ids (e.g. IN.123…) in 'recipient'."""
    return {"recipient_type": "individual", "recipient": contact} if "." in contact else {"to": contact}


def send_text(contact, text):
    """Free-form message; Meta only allows it within 24 h of the person's last message. -> message id."""
    c = get_conn()
    r = _call("POST", f"{CLOUD}/{c['phone_number_id']}/messages",
              body={"messaging_product": "whatsapp", **_to(contact), "type": "text",
                    "text": {"body": text[:4096], "preview_url": True}})
    return (r.get("messages") or [{}])[0].get("id") or "out_" + secrets.token_hex(8)


def send_template(contact, name, lang, params):
    """An approved template (works any time; Meta charges a small fee). params fill {{1}}, {{2}}…"""
    c = get_conn()
    r = _call("POST", f"{CLOUD}/{c['phone_number_id']}/messages", body={
        "messaging_product": "whatsapp", **_to(contact), "type": "template",
        "template": {"name": name, "language": {"code": lang}, "components": [
            {"type": "body", "parameters": [{"type": "text", "text": str(p)[:900] or "-"} for p in params]}]}})
    return (r.get("messages") or [{}])[0].get("id") or "out_" + secrets.token_hex(8)


# ---------------- demo mode: a fake WhatsApp so the whole flow runs without Meta or Kapso ----------------
_M = {"msgs": [], "sent": []}


def mock_incoming(contact, name, text, sender="customer"):
    """Demo only: a customer writes to the company number (or the boss replies from the Business app)."""
    _M["msgs"].insert(0, {"id": "wamid.demo" + secrets.token_hex(8), "contact": contact, "name": name,
                          "sender": sender, "text": text, "at": store.utcnow()})


def mock_sent():
    return list(reversed(_M["sent"][-30:]))


def _mock(method, url, params, body):
    if url.endswith("/whatsapp/phone_numbers"):
        return {"data": [{"phone_number_id": "100000000000001", "display_phone_number": "+91 98765 43210",
                          "verified_name": "TheDBAdmin Training (demo)", "is_coexistence": True}]}
    if url.endswith("/messages") and method == "POST":
        to = body.get("to") or body.get("recipient")
        recent = store.utcnow() - timedelta(hours=24)
        if body["type"] == "text" and not any(m["contact"] == to and m["sender"] == "customer" and m["at"] > recent
                                              for m in _M["msgs"]):  # like Meta: e.g. the boss never wrote to us
            raise WAWindowError("Re-engagement message: more than 24 hours since this person last wrote (demo).")
        wid = "wamid.demo" + secrets.token_hex(8)
        text = body.get("text", {}).get("body") or "[template {}] {}".format(
            body["template"]["name"], " | ".join(p["text"] for p in body["template"]["components"][0]["parameters"]))
        _M["msgs"].insert(0, {"id": wid, "contact": to, "name": "", "sender": "bot", "text": text, "at": store.utcnow()})
        _M["sent"].append({"to": to, "text": text, "at": store.iso(store.utcnow())})
        return {"messages": [{"id": wid}]}
    raise WAError(f"WhatsApp API 400: demo mode has no {method} {url}")
