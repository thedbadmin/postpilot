"""Duplicate-post guard: only a failed *connect* may be retried; any later network error must not be.

Run: python test_publish_safety.py   (no DB or LinkedIn needed)
"""
import os

os.environ.setdefault("DATABASE_URL", "postgresql://unused")
import requests  # noqa: E402

from postpilot import linkedin  # noqa: E402

linkedin._token = lambda: {"access_token": "x", "person_urn": "urn:li:person:x"}
linkedin.store.get_setting = lambda k: "202608"
post = {"text": "hi", "media": [], "link": None}


def outcome(exc):
    def boom(*a, **k):
        raise exc
    linkedin.requests.post = boom
    try:
        linkedin.publish(post)
    except linkedin.TransientError:
        return "retry"
    except linkedin.PermanentError:
        return "failed"


assert outcome(requests.ConnectTimeout("no route")) == "retry"
assert outcome(requests.ReadTimeout("sent, no answer")) == "failed"
assert outcome(requests.ConnectionError("reset mid-response")) == "failed"
print("ok")
