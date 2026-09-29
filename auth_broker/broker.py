"""PostPilot login server ("auth broker").

Why: a desktop app can't keep a LinkedIn Client Secret secret. This tiny server holds the secret,
does the OAuth code exchange, and hands the access token only to the app instance that started
the login (proved with a PKCE-style verifier). Nothing is stored on disk; pending logins expire
after 10 minutes.

Env vars: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, PUBLIC_URL (e.g. https://login.example.com)
LinkedIn app: add  {PUBLIC_URL}/callback  as an Authorized redirect URL.
Run:  uvicorn broker:app --host 0.0.0.0 --port 8000
"""
import base64
import hashlib
import html
import os
import secrets
import threading
import time
import urllib.parse

import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

CLIENT_ID = os.environ.get("LINKEDIN_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("LINKEDIN_CLIENT_SECRET", "")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:8000").rstrip("/")
REDIRECT = f"{PUBLIC_URL}/callback"
SCOPES = "openid profile w_member_social"
TTL = 600

app = FastAPI(title="PostPilot login server", docs_url=None, redoc_url=None)
_pending = {}  # state -> {"challenge", "created", "token"}
_lock = threading.Lock()


def _gc():
    now = time.time()
    with _lock:
        for k in [k for k, v in _pending.items() if now - v["created"] > TTL]:
            _pending.pop(k, None)


def _page(title, body):
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:64px 16px;color:#1d2226">
<h2>{html.escape(title)}</h2><p>{html.escape(body)}</p></body></html>""")


@app.get("/health")
def health():
    return {"ok": True, "configured": bool(CLIENT_ID and CLIENT_SECRET)}


@app.get("/start")
def start(state: str, challenge: str):
    _gc()
    if not (16 <= len(state) <= 128 and 32 <= len(challenge) <= 128):
        raise HTTPException(400, "Bad request")
    with _lock:
        if len(_pending) > 5000:
            raise HTTPException(429, "Too many pending logins, try again shortly")
        _pending[state] = {"challenge": challenge, "created": time.time(), "token": None}
    url = "https://www.linkedin.com/oauth/v2/authorization?" + urllib.parse.urlencode(
        {"response_type": "code", "client_id": CLIENT_ID, "redirect_uri": REDIRECT, "scope": SCOPES, "state": state})
    return RedirectResponse(url)


@app.get("/callback")
def callback(state: str = "", code: str = "", error: str = "", error_description: str = ""):
    with _lock:
        entry = _pending.get(state)
    if not entry:
        return _page("Login expired", "Please start the sign-in again from the PostPilot app.")
    if error:
        with _lock:
            _pending.pop(state, None)
        return _page("Sign-in cancelled", error_description or error)
    r = requests.post("https://www.linkedin.com/oauth/v2/accessToken", timeout=30, data={
        "grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET, "redirect_uri": REDIRECT})
    if r.status_code != 200:
        return _page("Sign-in failed", f"LinkedIn returned {r.status_code}. Please try again.")
    tok = r.json()
    with _lock:
        entry["token"] = {"access_token": tok["access_token"], "expires_in": tok.get("expires_in", 5184000)}
    return _page("PostPilot is connected", "You can close this tab and return to the app.")


class Claim(BaseModel):
    state: str
    verifier: str


@app.post("/claim")
def claim(body: Claim):
    with _lock:
        entry = _pending.get(body.state)
        if not entry:
            return JSONResponse({"detail": "unknown"}, 404)
        digest = base64.urlsafe_b64encode(hashlib.sha256(body.verifier.encode()).digest()).decode().rstrip("=")
        if not secrets.compare_digest(digest, entry["challenge"]):
            raise HTTPException(403, "Verifier mismatch")
        if not entry["token"]:
            return JSONResponse({"detail": "pending"}, 202)
        _pending.pop(body.state, None)
        return entry["token"]
