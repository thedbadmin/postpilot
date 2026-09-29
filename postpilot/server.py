"""Local HTTP API (127.0.0.1 only) used by the desktop window and the browser extension."""
import json
import secrets
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ai, autostart, linkedin, linkpreview, scheduler, store
from .config import APP_NAME, MEDIA_DIR, MOCK, VERSION, WEB_DIR

APP_TOKEN = secrets.token_urlsafe(24)  # regenerated each launch; given to the window via URL fragment
MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif"}
show_window_cb = None  # set by desktop shell

app = FastAPI(title=APP_NAME, version=VERSION, docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origin_regex=r"^chrome-extension://.*$|^moz-extension://.*$",
                   allow_methods=["*"], allow_headers=["*"])


def auth(x_pp_token: Optional[str] = Header(None), t: Optional[str] = Query(None)):
    tok = x_pp_token or t
    if tok and (secrets.compare_digest(tok, APP_TOKEN) or
                (store.get_secret("ext_token") and secrets.compare_digest(tok, store.get_secret("ext_token")))):
        return True
    raise HTTPException(401, "Unauthorized")


@app.exception_handler(linkedin.TokenError)
async def _tok_err(_r, e):
    return JSONResponse({"detail": str(e), "code": "token"}, 400)


@app.exception_handler(ai.AIError)
async def _ai_err(_r, e):
    return JSONResponse({"detail": str(e), "code": "ai"}, 400)


# ---------------- UI ----------------
@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-store"})


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/media/{mid}")
def media(mid: str, _=Depends(auth)):
    p = store.media_path(mid)
    if not p or not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


# ---------------- status ----------------
def _post_out(p):
    if p:
        p["url"] = linkedin.post_url(p.get("linkedin_urn"))
    return p


@app.get("/api/status", dependencies=[Depends(auth)])
def status():
    nxt = store.q("SELECT * FROM posts WHERE status='scheduled' ORDER BY scheduled_at LIMIT 1", one=True)
    last = scheduler.state["last_tick"]
    healthy = bool(last) and (store.utcnow() - datetime.fromisoformat(last)).total_seconds() < 90
    return {
        "app": APP_NAME, "version": VERSION, "mock": MOCK,
        "agent": {**scheduler.state, "healthy": healthy},
        "account": linkedin.account(),
        "counts": store.counts(),
        "next": _post_out(store.post_dict(nxt)),
        "next_slot": store.iso(scheduler.next_slot()),
        "usage": scheduler.today_usage(),
        "login": linkedin.login_state,
        "settings": public_settings(),
    }


# ---------------- posts ----------------
class PostIn(BaseModel):
    text: Optional[str] = None
    media: Optional[list] = None
    alt: Optional[str] = None
    link: Optional[dict] = None
    topic: Optional[str] = None
    source: Optional[str] = None


def _validate(p):
    if len(p["text"]) > 3000:
        raise HTTPException(400, "LinkedIn allows at most 3,000 characters.")
    if p["media"] and p["link"]:
        raise HTTPException(400, "A post can have images or a link card, not both.")
    if len(p["media"]) > 20:
        raise HTTPException(400, "At most 20 images per post.")
    if not p["text"].strip() and not p["media"] and not p["link"]:
        raise HTTPException(400, "The post is empty.")


@app.get("/api/posts", dependencies=[Depends(auth)])
def posts(status: Optional[str] = None):
    return [_post_out(p) for p in store.list_posts(status)]


@app.get("/api/posts/{pid}", dependencies=[Depends(auth)])
def get_post(pid: int):
    p = store.get_post(pid)
    if not p:
        raise HTTPException(404, "Post not found")
    return _post_out(p)


@app.post("/api/posts", dependencies=[Depends(auth)])
def create_post(body: PostIn):
    p = store.create_post(body.text or "", body.source or "manual", body.topic, body.media, body.alt or "", body.link)
    return _post_out(p)


@app.put("/api/posts/{pid}", dependencies=[Depends(auth)])
def update_post(pid: int, body: PostIn):
    p = get_post(pid)
    if p["status"] in ("published", "publishing"):
        raise HTTPException(400, "Published posts can't be edited here.")
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k != "source"}
    if "link" in body.model_fields_set and body.link is None:
        fields["link"] = None
    merged = {**p, **fields}
    if p["status"] == "scheduled":
        _validate(merged)
    return _post_out(store.update_post(pid, **fields))


@app.delete("/api/posts/{pid}", dependencies=[Depends(auth)])
def delete_post(pid: int):
    p = get_post(pid)
    if p["status"] == "publishing":
        raise HTTPException(400, "This post is being published right now.")
    store.delete_post(pid)
    return {"ok": True}


class ScheduleIn(BaseModel):
    when: Optional[str] = None  # ISO datetime, or "next_slot", or "now"


@app.post("/api/posts/{pid}/schedule", dependencies=[Depends(auth)])
def schedule(pid: int, body: ScheduleIn):
    p = get_post(pid)
    if p["status"] in ("published", "publishing"):
        raise HTTPException(400, "Already published.")
    _validate(p)
    if not linkedin.account()["connected"]:
        raise HTTPException(400, "Connect your LinkedIn account first (Settings).")
    if body.when == "now":
        when = store.utcnow()
    elif body.when in (None, "", "next_slot"):
        when = scheduler.next_slot(exclude_id=pid)
        if not when:
            raise HTTPException(400, "No posting slots set. Add days and times in Settings.")
    else:
        when = datetime.fromisoformat(body.when.replace("Z", "+00:00"))
        if when.tzinfo is None:
            raise HTTPException(400, "Time must include a timezone.")
        if when < store.utcnow() - timedelta_minutes(1):
            raise HTTPException(400, "That time is in the past.")
    problem = scheduler.limit_problem(when, exclude_id=pid)
    if problem:
        raise HTTPException(400, problem)
    p = store.update_post(pid, status="scheduled", scheduled_at=store.iso(when), attempts=0,
                          next_attempt_at=None, error=None)
    store.log("info", "Publishing now…" if body.when == "now" else "Scheduled.", pid)
    scheduler.wake()
    return _post_out(p)


def timedelta_minutes(m):
    from datetime import timedelta
    return timedelta(minutes=m)


class BulkIn(BaseModel):
    ids: list


@app.post("/api/posts/bulk-schedule", dependencies=[Depends(auth)])
def bulk_schedule(body: BulkIn):
    """Put several drafts into the next free slots, in the order given."""
    if not linkedin.account()["connected"]:
        raise HTTPException(400, "Connect your LinkedIn account first (Settings).")
    done, errors = [], []
    for pid in body.ids:
        p = store.get_post(int(pid))
        if not p or p["status"] not in ("draft", "failed", "missed"):
            continue
        try:
            _validate(p)
        except HTTPException as e:
            errors.append(f"#{pid}: {e.detail}")
            continue
        qp = scheduler.limit_problem(store.utcnow(), exclude_id=p["id"])
        if qp and qp.startswith("Queue is full"):
            errors.append(qp)
            break
        when = scheduler.next_slot(exclude_id=p["id"])
        if not when:
            errors.append("No free slot within your posting days and limits. Add more days/times in Settings.")
            break
        store.update_post(p["id"], status="scheduled", scheduled_at=store.iso(when), attempts=0,
                          next_attempt_at=None, error=None)
        done.append(p["id"])
    if done:
        store.log("info", f"Scheduled {len(done)} post(s) into your posting slots.")
    scheduler.wake()
    return {"scheduled": done, "errors": errors}


@app.post("/api/posts/{pid}/unschedule", dependencies=[Depends(auth)])
def unschedule(pid: int):
    p = get_post(pid)
    if p["status"] not in ("scheduled", "failed", "missed"):
        raise HTTPException(400, "Only queued posts can be moved back to drafts.")
    store.log("info", "Moved back to drafts.", pid)
    return _post_out(store.update_post(pid, status="draft", scheduled_at=None, attempts=0,
                                       next_attempt_at=None, error=None))


@app.post("/api/posts/{pid}/duplicate", dependencies=[Depends(auth)])
def duplicate(pid: int):
    p = get_post(pid)
    return _post_out(store.create_post(p["text"], "manual", p["topic"], p["media"], p["alt"], p["link"]))


# ---------------- media ----------------
@app.post("/api/media", dependencies=[Depends(auth)])
async def upload_media(file: UploadFile = File(...)):
    ext = IMAGE_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "Only JPG, PNG or GIF images are supported by LinkedIn.")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Image is larger than 10 MB.")
    mid = uuid.uuid4().hex
    path = MEDIA_DIR / f"{mid}{ext}"
    path.write_bytes(data)
    store.add_media(mid, file.filename or f"image{ext}", path, file.content_type, len(data))
    return {"id": mid, "filename": file.filename}


class UrlIn(BaseModel):
    url: str


@app.post("/api/link-preview", dependencies=[Depends(auth)])
def link_preview(body: UrlIn):
    try:
        return linkpreview.fetch(body.url.strip())
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------------- AI ----------------
class DraftIn(BaseModel):
    topic: str
    extra: Optional[str] = ""


class RewriteIn(BaseModel):
    text: str
    action: str
    instruction: Optional[str] = ""


@app.post("/api/ai/draft", dependencies=[Depends(auth)])
def ai_draft(body: DraftIn):
    return {"text": ai.draft(body.topic, body.extra or "")}


@app.post("/api/ai/rewrite", dependencies=[Depends(auth)])
def ai_rewrite(body: RewriteIn):
    return {"text": ai.rewrite(body.text, body.action, body.instruction or "")}


jobs = {}


class BatchIn(BaseModel):
    topics: list


@app.post("/api/ai/batch", dependencies=[Depends(auth)])
def ai_batch(body: BatchIn):
    topics = [t.strip() for t in body.topics if str(t).strip()][:30]
    if not topics:
        raise HTTPException(400, "Add at least one topic.")
    jid = uuid.uuid4().hex[:8]
    job = jobs[jid] = {"id": jid, "total": len(topics), "done": 0, "failed": 0, "post_ids": [],
                       "errors": [], "finished": False}

    def run():
        for t in topics:
            try:
                text = ai.draft(t)
                p = store.create_post(text, "batch", t)
                job["post_ids"].append(p["id"])
            except Exception as e:
                job["failed"] += 1
                job["errors"].append(f"{t}: {e}")
            job["done"] += 1
        job["finished"] = True
        store.log("success", f"AI drafted {job['done'] - job['failed']} post(s) from your topic list.")

    threading.Thread(target=run, daemon=True).start()
    return job


@app.get("/api/jobs/{jid}", dependencies=[Depends(auth)])
def job(jid: str):
    if jid not in jobs:
        raise HTTPException(404)
    return jobs[jid]


# ---------------- account ----------------
@app.post("/api/account/login", dependencies=[Depends(auth)])
def login():
    return linkedin.start_login()


@app.post("/api/account/logout", dependencies=[Depends(auth)])
def logout():
    linkedin.logout()
    return {"ok": True}


# ---------------- settings ----------------
def public_settings():
    s = store.get_settings()
    s["has_client_secret"] = bool(store.get_secret("li_client_secret"))
    s["has_ai_key"] = bool(store.get_secret("ai_api_key"))
    s["autostart_supported"] = autostart.supported()
    return s


class SettingsIn(BaseModel):
    values: dict = {}
    secrets: dict = {}


@app.get("/api/settings", dependencies=[Depends(auth)])
def get_settings():
    return public_settings()


@app.put("/api/settings", dependencies=[Depends(auth)])
def put_settings(body: SettingsIn):
    v = body.values
    if "slots" in v:
        for t in v["slots"].get("times", []):
            try:
                hh, mm = map(int, t.split(":"))
                assert 0 <= hh < 24 and 0 <= mm < 60
            except Exception:
                raise HTTPException(400, f"Invalid time: {t}")
    if "timezone" in v:
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(v["timezone"])
        except Exception:
            raise HTTPException(400, "Unknown time zone.")
    L = scheduler.limits()["hard"]
    for k, lo, hi in (("max_posts_per_day", 1, L["per_day"]), ("min_gap_minutes", L["gap_min"], 1440),
                      ("max_queue", 1, L["max_queue"])):
        if k in v:
            try:
                v[k] = int(v[k])
            except (TypeError, ValueError):
                raise HTTPException(400, "Limits must be whole numbers.")
            if not lo <= v[k] <= hi:
                raise HTTPException(400, f"Allowed range for this limit is {lo}–{hi}.")
    store.set_settings(v)
    for k in ("li_client_secret", "ai_api_key"):
        if k in body.secrets and body.secrets[k] is not None:
            store.set_secret(k, body.secrets[k].strip())
    if "autostart" in v:
        autostart.set_enabled(bool(v["autostart"]))
    return public_settings()


@app.post("/api/extension/pair", dependencies=[Depends(auth)])
def pair_extension():
    tok = "pp_" + secrets.token_urlsafe(18)
    store.set_secret("ext_token", tok)
    store.log("info", "Browser extension pairing code created.")
    return {"code": tok}


# ---------------- activity ----------------
@app.get("/api/activity", dependencies=[Depends(auth)])
def activity(limit: int = 200):
    return [dict(r) for r in store.q("SELECT * FROM activity ORDER BY id DESC LIMIT ?", (limit,))]


@app.post("/api/show", dependencies=[Depends(auth)])
def show():
    if show_window_cb:
        show_window_cb()
    return {"ok": True}
