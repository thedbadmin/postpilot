"""PostgreSQL storage, settings and secrets (OS keychain with file fallback)."""
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import APP_NAME, DATA_DIR

DATABASE_URL = os.getenv("DATABASE_URL", "")  # postgresql://user:pass@host:5432/dbname

_lock = threading.RLock()
_conn = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',   -- draft|scheduled|publishing|published|failed|missed
    scheduled_at TEXT,                      -- UTC ISO
    next_attempt_at TEXT,                   -- UTC ISO (retry backoff)
    attempts INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',  -- manual|ai|batch|extension
    topic TEXT,
    media TEXT NOT NULL DEFAULT '[]',       -- JSON list of media ids
    alt TEXT NOT NULL DEFAULT '',
    link TEXT,                              -- JSON {url,title,desc,thumb}
    linkedin_urn TEXT,
    error TEXT,
    created_at TEXT, updated_at TEXT, published_at TEXT
);
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, filename TEXT, path TEXT, mime TEXT, size INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS activity (
    id SERIAL PRIMARY KEY, ts TEXT, level TEXT, post_id INTEGER, message TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS ix_posts_status ON posts(status, scheduled_at);
CREATE TABLE IF NOT EXISTS ig_automations (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
    media_id TEXT NOT NULL DEFAULT '',      -- '' = any of the newest posts
    media_caption TEXT, media_thumb TEXT, media_permalink TEXT,
    keywords TEXT NOT NULL DEFAULT '',      -- comma-separated, '' = any comment
    require_follow BOOLEAN NOT NULL DEFAULT FALSE,
    link TEXT NOT NULL DEFAULT '', dm_text TEXT NOT NULL DEFAULT '',
    gate_text TEXT NOT NULL DEFAULT '', nofollow_text TEXT NOT NULL DEFAULT '',
    public_replies TEXT NOT NULL DEFAULT '', -- one per line
    active BOOLEAN NOT NULL DEFAULT TRUE, active_since TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ig_events (
    comment_id TEXT PRIMARY KEY,            -- one row per answered comment, so nothing is DMed twice
    automation_id INTEGER, media_id TEXT, user_id TEXT, username TEXT, text TEXT,
    status TEXT NOT NULL,                   -- new|sent|awaiting|gave_up|expired|duplicate|failed
    attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
    commented_at TEXT, prompted_at TEXT, created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_ig_events_status ON ig_events(status);
"""

DEFAULT_SETTINGS = {
    "language": "en",                  # en | hi (Hinglish)
    "timezone": "Asia/Kolkata",
    "ai_provider": "groq",             # groq | openai | anthropic
    "ai_model": "openai/gpt-oss-120b",
    "ai_base_url": "",                 # optional OpenAI-compatible endpoint
    "vision_model": "qwen/qwen3.8-27b",  # Groq (free) model for "write from image"; key: vision_api_key
    "brand_voice": "Clear, warm, professional, first-person. Short paragraphs. No corporate jargon.",
    "post_length": "medium",           # short | medium | long
    "slots": {"days": [0, 2, 4], "times": ["10:00"]},  # Mon=0
    "missed_grace_minutes": 360,       # if app was off longer than this, don't auto-post late
    "autostart": True,
    "notifications": True,
    "auth_mode": "direct",             # direct (own LinkedIn app) | broker (hosted login server)
    "broker_url": "",
    "client_id": "",
    "redirect_uri": "http://localhost:8080/callback",
    "li_version": "202608",
    "onboarded": False,
    "agent_paused": False,
    # posting limits (protect the account from over-posting; hard ceilings live in scheduler.py)
    "max_posts_per_day": 2,
    "min_gap_minutes": 180,
    "max_queue": 30,
    "profile_headline": "",
    "theme": "system",
    "app_name": "PostPilot",
    "ig_paused": False,                # Instagram agent (insta_agent.py)
}

SECRET_KEYS = ("li_client_secret", "ai_api_key", "li_token", "ext_token", "vision_api_key", "ig_token")


def utcnow():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def conn():
    global _conn
    with _lock:
        if _conn is None:
            if not DATABASE_URL:
                raise RuntimeError("DATABASE_URL is not set (e.g. postgresql://user:pass@host:5432/postpilot).")
            import psycopg2
            import psycopg2.extras
            _conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
            _conn.autocommit = True
            _conn.cursor().execute(SCHEMA)
        return _conn


def _run(sql, args):
    """Execute on Postgres; returns (rows, new_id_or_None). Queries are written with `?` placeholders."""
    insert = sql.lstrip().upper().startswith("INSERT")
    sql = sql.replace("IS NOT ?", "IS DISTINCT FROM ?").replace("?", "%s")
    with_id = insert and re.match(r"\s*INSERT INTO (posts|activity|ig_automations)\b", sql, re.I)
    cur = conn().cursor()
    cur.execute(sql + " RETURNING id" if with_id else sql, args)
    rows = cur.fetchall() if cur.description else []
    return rows, (rows[0]["id"] if with_id else None)


def q(sql, args=(), one=False):
    global _conn
    with _lock:
        try:
            rows, new_id = _run(sql, args)
        except Exception as e:
            if type(e).__name__ not in ("OperationalError", "InterfaceError"):
                raise
            _conn = None  # DB container restarted: reconnect once
            rows, new_id = _run(sql, args)
        if sql.lstrip().upper().startswith("INSERT"):
            return new_id
        return (rows[0] if rows else None) if one else rows


# ---------------- settings ----------------
def get_settings():
    s = dict(DEFAULT_SETTINGS)
    for r in q("SELECT key, value FROM settings"):
        try:
            s[r["key"]] = json.loads(r["value"])
        except ValueError:
            pass
    return s


def get_setting(key):
    return get_settings().get(key)


def set_settings(values: dict):
    for k, v in values.items():
        if k in DEFAULT_SETTINGS:
            q("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              (k, json.dumps(v)))


# ---------------- secrets ----------------
_SECRET_FILE = DATA_DIR / "secrets.json"
try:
    import keyring  # Windows Credential Manager / macOS Keychain
    keyring.get_password(APP_NAME, "_probe")
    _KEYRING = os.getenv("POSTPILOT_NO_KEYRING") != "1"
except Exception:  # no backend available (e.g. headless Linux)
    _KEYRING = False


def _file_secrets():
    try:
        return json.loads(_SECRET_FILE.read_text())
    except (OSError, ValueError):
        return {}


def get_secret(name):
    if _KEYRING:
        try:
            v = keyring.get_password(APP_NAME, name)
            if v is not None:
                return v
        except Exception:
            pass
    return _file_secrets().get(name)


def set_secret(name, value):
    if _KEYRING:
        try:
            if value:
                keyring.set_password(APP_NAME, name, value)
            else:
                try:
                    keyring.delete_password(APP_NAME, name)
                except Exception:
                    pass
            return
        except Exception:
            pass
    data = _file_secrets()
    if value:
        data[name] = value
    else:
        data.pop(name, None)
    _SECRET_FILE.write_text(json.dumps(data))
    try:
        os.chmod(_SECRET_FILE, 0o600)
    except OSError:
        pass


def get_token():
    raw = get_secret("li_token")
    return json.loads(raw) if raw else None


def set_token(tok):
    set_secret("li_token", json.dumps(tok) if tok else "")


# ---------------- activity ----------------
_listeners = []


def on_activity(fn):
    _listeners.append(fn)


def log(level, message, post_id=None):
    q("INSERT INTO activity(ts, level, post_id, message) VALUES(?,?,?,?)",
      (iso(utcnow()), level, post_id, message))
    for fn in _listeners:
        try:
            fn(level, message, post_id)
        except Exception:
            pass


# ---------------- posts ----------------
def post_dict(r):
    if r is None:
        return None
    d = dict(r)
    d["media"] = json.loads(d["media"] or "[]")
    d["link"] = json.loads(d["link"]) if d["link"] else None
    return d


def get_post(pid):
    return post_dict(q("SELECT * FROM posts WHERE id=?", (pid,), one=True))


def list_posts(status=None, limit=500):
    if status:
        sts = status.split(",")
        rows = q(f"SELECT * FROM posts WHERE status IN ({','.join('?' * len(sts))}) "
                 "ORDER BY COALESCE(scheduled_at, updated_at) DESC LIMIT ?", (*sts, limit))
    else:
        rows = q("SELECT * FROM posts ORDER BY COALESCE(scheduled_at, updated_at) DESC LIMIT ?", (limit,))
    return [post_dict(r) for r in rows]


def create_post(text="", source="manual", topic=None, media=None, alt="", link=None):
    now = iso(utcnow())
    pid = q("INSERT INTO posts(text, source, topic, media, alt, link, created_at, updated_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (text, source, topic, json.dumps(media or []), alt or "", json.dumps(link) if link else None, now, now))
    return get_post(pid)


def update_post(pid, **fields):
    if not fields:
        return get_post(pid)
    if "media" in fields:
        fields["media"] = json.dumps(fields["media"] or [])
    if "link" in fields:
        fields["link"] = json.dumps(fields["link"]) if fields["link"] else None
    fields["updated_at"] = iso(utcnow())
    cols = ", ".join(f"{k}=?" for k in fields)
    q(f"UPDATE posts SET {cols} WHERE id=?", (*fields.values(), pid))
    return get_post(pid)


def delete_post(pid):
    q("DELETE FROM posts WHERE id=?", (pid,))


def counts():
    out = {s: 0 for s in ("draft", "scheduled", "publishing", "published", "failed", "missed")}
    for r in q("SELECT status, COUNT(*) c FROM posts GROUP BY status"):
        out[r["status"]] = r["c"]
    return out


# ---------------- media ----------------
def add_media(mid, filename, path, mime, size):
    q("INSERT INTO media(id, filename, path, mime, size, created_at) VALUES(?,?,?,?,?,?)",
      (mid, filename, str(path), mime, size, iso(utcnow())))


def get_media(mid):
    r = q("SELECT * FROM media WHERE id=?", (mid,), one=True)
    return dict(r) if r else None


def is_video(mid):
    m = get_media(mid)
    return bool(m) and (m["mime"] or "").startswith("video/")


def media_path(mid):
    m = get_media(mid)
    return Path(m["path"]) if m else None
