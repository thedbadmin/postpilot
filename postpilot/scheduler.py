"""Background agent: publishes due posts, retries transient failures, flags missed posts."""
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import linkedin, store

TICK_SECONDS = 15
MAX_ATTEMPTS = 4
BACKOFF_MIN = [2, 10, 30]  # minutes between retries

state = {"running": False, "last_tick": None, "last_error": None, "started_at": None}
_wake = threading.Event()
_notify = None  # desktop notification callback(title, message)


def set_notifier(fn):
    global _notify
    _notify = fn


def _toast(title, msg):
    if _notify and store.get_setting("notifications"):
        try:
            _notify(title, msg)
        except Exception:
            pass


def wake():
    _wake.set()


def _parse(s):
    return datetime.fromisoformat(s) if s else None


def _preview(text, n=50):
    t = " ".join((text or "").split())
    return t[:n] + ("…" if len(t) > n else "")


def process_due():
    now = store.utcnow()
    grace = timedelta(minutes=max(3, int(store.get_setting("missed_grace_minutes") or 0)))
    rows = store.q("SELECT id FROM posts WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at",
                   (store.iso(now),))
    for r in rows:
        post = store.get_post(r["id"])
        if post["next_attempt_at"] and _parse(post["next_attempt_at"]) > now:
            continue
        due = _parse(post["scheduled_at"])
        if post["attempts"] == 0 and now - due > grace:
            store.update_post(post["id"], status="missed",
                              error="The app was not running at the scheduled time. Reschedule or post now.")
            store.log("warn", f"Missed scheduled time: “{_preview(post['text'])}”", post["id"])
            _toast("Post missed", "A scheduled post was missed while the app was off. Open PostPilot to reschedule.")
            continue
        # safety net: never exceed the daily limit, even if posts were queued before a limit change
        L = limits()
        tz = ZoneInfo(store.get_setting("timezone"))
        today = now.astimezone(tz).date()
        done_today = sum(1 for r2 in store.q("SELECT published_at FROM posts WHERE status='published' AND published_at IS NOT NULL")
                         if _parse(r2["published_at"]).astimezone(tz).date() == today)
        if done_today >= L["per_day"]:
            nxt = next_slot(exclude_id=post["id"])
            store.update_post(post["id"], scheduled_at=store.iso(nxt) if nxt else None,
                              status="scheduled" if nxt else "draft",
                              error=f"Held back: daily limit of {L['per_day']} post(s) already reached.")
            store.log("warn", f"Daily limit reached — moved “{_preview(post['text'])}” to "
                      + (f"the next free slot." if nxt else "drafts."), post["id"])
            continue
        store.update_post(post["id"], status="publishing")
        try:
            urn = linkedin.publish(post)
            store.update_post(post["id"], status="published", linkedin_urn=urn, error=None,
                              published_at=store.iso(store.utcnow()), next_attempt_at=None)
            store.log("success", f"Published: “{_preview(post['text'])}”", post["id"])
            _toast("Posted to LinkedIn", _preview(post["text"], 80))
        except linkedin.TransientError as e:
            attempts = post["attempts"] + 1
            if attempts >= MAX_ATTEMPTS:
                store.update_post(post["id"], status="failed", attempts=attempts, error=str(e))
                store.log("error", f"Gave up after {attempts} attempts: {e}", post["id"])
                _toast("Post failed", "LinkedIn could not be reached. Open PostPilot to retry.")
            else:
                wait = BACKOFF_MIN[min(attempts - 1, len(BACKOFF_MIN) - 1)]
                store.update_post(post["id"], status="scheduled", attempts=attempts, error=str(e),
                                  next_attempt_at=store.iso(store.utcnow() + timedelta(minutes=wait)))
                store.log("warn", f"Temporary problem, retrying in {wait} min: {e}", post["id"])
        except linkedin.TokenError as e:
            store.update_post(post["id"], status="failed", error=str(e))
            store.log("error", f"Not published — {e}", post["id"])
            _toast("Reconnect LinkedIn", str(e))
        except Exception as e:  # PermanentError and anything unexpected
            store.update_post(post["id"], status="failed", error=str(e))
            store.log("error", f"LinkedIn rejected the post: {e}", post["id"])
            _toast("Post failed", str(e)[:120])


_warned_day = None


def _token_check():
    global _warned_day
    days = linkedin.token_days_left()
    today = store.utcnow().date()
    if days is not None and days < 7 and _warned_day != today:
        _warned_day = today
        pending = store.counts()["scheduled"]
        msg = (f"LinkedIn session expires in {max(0, int(days))} day(s)."
               + (f" {pending} post(s) are waiting." if pending else "") + " Reconnect in Settings.")
        store.log("warn", msg)
        _toast("Reconnect soon", msg)


def _loop():
    state.update(running=True, started_at=store.iso(store.utcnow()))
    # posts left in 'publishing' by a crash go back to the queue
    store.q("UPDATE posts SET status='scheduled' WHERE status='publishing'")
    store.log("info", "Agent started.")
    while True:
        try:
            if not store.get_setting("agent_paused"):
                process_due()
            _token_check()
            state.update(last_tick=store.iso(store.utcnow()), last_error=None)
        except Exception as e:
            state["last_error"] = str(e)
        _wake.wait(TICK_SECONDS)
        _wake.clear()


def start():
    if not state["running"]:
        threading.Thread(target=_loop, daemon=True, name="scheduler").start()


# ---------------- posting limits ----------------
HARD_MAX_PER_DAY = 5       # ceiling users can't raise in Settings
HARD_MIN_GAP_MIN = 60      # minimum minutes between two posts, whatever Settings say
HARD_MAX_QUEUE = 60        # max posts waiting in the queue


def limits():
    s = store.get_settings()
    return {
        "per_day": max(1, min(HARD_MAX_PER_DAY, int(s.get("max_posts_per_day") or 2))),
        "gap_min": max(HARD_MIN_GAP_MIN, int(s.get("min_gap_minutes") or HARD_MIN_GAP_MIN)),
        "max_queue": max(1, min(HARD_MAX_QUEUE, int(s.get("max_queue") or 30))),
        "hard": {"per_day": HARD_MAX_PER_DAY, "gap_min": HARD_MIN_GAP_MIN, "max_queue": HARD_MAX_QUEUE},
    }


def _busy_times(exclude_id=None):
    """UTC datetimes of posts that are queued or already published (published use published_at)."""
    rows = store.q("SELECT id, status, scheduled_at, published_at FROM posts "
                   "WHERE status IN ('scheduled','publishing','published') AND id IS NOT ?", (exclude_id,))
    out = []
    for r in rows:
        t = r["published_at"] if r["status"] == "published" and r["published_at"] else r["scheduled_at"]
        if t:
            out.append(_parse(t))
    return out


def limit_problem(when, exclude_id=None, check_queue=True):
    """Return a user-facing reason if posting at `when` would break a limit, else None."""
    L = limits()
    tz = ZoneInfo(store.get_setting("timezone"))
    busy = _busy_times(exclude_id)
    day = when.astimezone(tz).date()
    same_day = sum(1 for b in busy if b.astimezone(tz).date() == day)
    if same_day >= L["per_day"]:
        return (f"Daily limit reached: {L['per_day']} post(s) per day are already planned for "
                f"{day:%a %d %b}. Pick another day or raise the limit in Settings.")
    near = [b for b in busy if abs((b - when).total_seconds()) < L["gap_min"] * 60]
    if near:
        return (f"Too close to another post. Keep at least {L['gap_min'] // 60}h {L['gap_min'] % 60:02d}m "
                "between posts so each one gets reach.")
    if check_queue:
        queued = store.q("SELECT COUNT(*) c FROM posts WHERE status IN ('scheduled','publishing') AND id IS NOT ?",
                         (exclude_id,), one=True)["c"]
        if queued >= L["max_queue"]:
            return f"Queue is full ({L['max_queue']} scheduled posts). Let some publish first or raise the limit in Settings."
    return None


def today_usage():
    tz = ZoneInfo(store.get_setting("timezone"))
    today = store.utcnow().astimezone(tz).date()
    busy = _busy_times()
    return {"today": sum(1 for b in busy if b.astimezone(tz).date() == today), **limits()}


# ---------------- slots ----------------
def next_slot(after=None, exclude_id=None):
    """Next free time from the weekly slot pattern (Settings > Posting schedule)."""
    s = store.get_settings()
    tz = ZoneInfo(s["timezone"])
    slots = s.get("slots") or {}
    days = sorted(set(int(d) for d in slots.get("days", [])))
    times = sorted(slots.get("times", []))
    if not days or not times:
        return None
    start = (after or store.utcnow()) + timedelta(minutes=5)
    local = start.astimezone(tz)
    for i in range(120):
        day = (local + timedelta(days=i)).date()
        if day.weekday() not in days:
            continue
        for t in times:
            hh, mm = map(int, t.split(":"))
            cand = datetime(day.year, day.month, day.day, hh, mm, tzinfo=tz)
            if cand.astimezone(timezone.utc) <= start:
                continue
            if limit_problem(cand.astimezone(timezone.utc), exclude_id, check_queue=False):
                continue
            return cand.astimezone(timezone.utc)
    return None
