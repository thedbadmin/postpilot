"""Instagram agent end to end, against the demo stack (POSTPILOT_MOCK=1, fresh database).

Run: docker compose down -v; docker compose up -d --build
     docker compose cp test_insta_flow.py app:/tmp/ && docker compose exec app python /tmp/test_insta_flow.py
"""
import os
import time

import requests

B = "http://127.0.0.1:47821/api/insta"
H = {"X-PP-Token": os.environ["POSTPILOT_TOKEN"]}


def call(m, p, body=None, ok=200):
    r = requests.request(m, B + p, json=body, headers=H, timeout=30)
    assert r.status_code == ok, (m, p, r.status_code, r.text)
    return r.json()


def settle(n=4):
    for _ in range(n):
        call("POST", "/check")
        time.sleep(1.5)


assert requests.get(B + "/status").status_code == 401, "auth must be enforced"
st = call("GET", "/status")
print("before connect:", st["account"], "| agent running:", st["agent"]["running"])
call("POST", "/connect", {"token": "short"}, ok=400)
acct = call("POST", "/connect", {"token": "IGAA" + "x" * 40})
print("connected:", acct["username"], acct["days_left"], "days")

media = call("GET", "/media")
mid = media[0]["id"]
print("media:", len(media), "first:", media[0]["caption"][:40])

# validation
call("POST", "/automations", {"keywords": "x"}, ok=400)                       # nothing to send
call("POST", "/automations", {"link": "not a url"}, ok=400)
call("POST", "/automations", {"link": "https://x.y", "require_follow": True}, ok=400)  # follow texts missing

d = st["defaults"]
open_a = call("POST", "/automations", {"name": "Handbook (open)", "media_id": mid, "keywords": "handbook, guide",
                                       "link": "https://lms.thedbadmin.com/handbook", "dm_text": d["dm_text"],
                                       "public_replies": "Sent! Check your DMs ðŸ“©\nDone, check your inbox!"})
gate_a = call("POST", "/automations", {"name": "Any post (followers)", "media_id": "", "keywords": "pdf",
                                       "require_follow": True, "link": "https://lms.thedbadmin.com/pdf",
                                       "dm_text": d["dm_text"], "gate_text": d["gate_text"],
                                       "nofollow_text": d["nofollow_text"]})
print("automations:", open_a["id"], gate_a["id"])

sim = lambda **k: call("POST", "/simulate", {"media_id": mid, **k})
sim(username="alice", text="HANDBOOK please!")          # open automation -> link at once
sim(username="bob", text="nice post")                   # no keyword -> ignored
sim(username="alice", text="guide")                     # same person again -> duplicate, no 2nd DM
sim(username="carol", text="send the PDF", follows=True)   # gate -> follows -> link
sim(username="dave", text="pdf pls", follows=False)        # gate -> never follows -> gave_up
settle(6)

ev = {e["username"] + ":" + e["text"]: e for e in call("GET", "/events")}
for k, e in ev.items():
    print(f"  {k:24} -> {e['status']:9} attempts={e['attempts']} auto={e['automation']} err={e['error']}")
assert ev["alice:HANDBOOK please!"]["status"] == "sent"
assert ev["alice:guide"]["status"] == "duplicate"
assert "bob:nice post" not in ev
assert ev["carol:send the PDF"]["status"] == "sent"
assert ev["dave:pdf pls"]["status"] == "gave_up" and ev["dave:pdf pls"]["attempts"] == 3

st = call("GET", "/status")
print("counts:", st["counts"], "| last_error:", st["agent"]["last_error"])
assert st["counts"]["sent"] == 2 and st["agent"]["last_error"] is None

# turning an automation off and on: older comments are not answered
call("PUT", f"/automations/{open_a['id']}", {**{k: open_a[k] for k in open_a if k in (
    "name", "media_id", "keywords", "link", "dm_text", "public_replies")}, "active": False})
sim(username="erin", text="handbook")
settle(2)
assert not any(e["username"] == "erin" for e in call("GET", "/events")), "inactive automation must not answer"
call("PUT", f"/automations/{open_a['id']}", {**{k: open_a[k] for k in open_a if k in (
    "name", "media_id", "keywords", "link", "dm_text", "public_replies")}, "active": True})
settle(2)
assert not any(e["username"] == "erin" for e in call("GET", "/events")), "comment from while it was off"

# pause stops the agent
call("POST", "/pause", {"paused": True})
sim(username="frank", text="handbook")
settle(2)
assert not any(e["username"] == "frank" for e in call("GET", "/events")), "paused agent must not answer"
call("POST", "/pause", {"paused": False})
settle(2)
assert any(e["username"] == "frank" and e["status"] == "sent" for e in call("GET", "/events"))

# PDF: Meta allows a file only after the person replies, so the first DM always asks for a reply
pdf, mid2 = "https://thedbadmin.github.io/postpilot/files/guide.pdf", media[1]["id"]
call("POST", "/automations", {"file_url": "http://x.y/a.pdf", "gate_text": "hi"}, ok=400)  # not https
call("POST", "/automations", {"file_url": pdf, "gate_text": ""}, ok=400)                   # no first DM
call("POST", "/automations", {"name": "PDF", "media_id": mid2, "keywords": "mvcc", "file_url": pdf,
                              "dm_text": "", "gate_text": d["ask_text"]})
call("POST", "/automations", {"name": "PDF (followers)", "media_id": mid2, "keywords": "notes", "file_url": pdf,
                              "require_follow": True, "dm_text": "Here you go {name} 📄", "gate_text": d["gate_text"],
                              "nofollow_text": d["nofollow_text"]})
sim2 = lambda **k: call("POST", "/simulate", {"media_id": mid2, **k})
sim2(username="gina", text="MVCC", follows=False)   # no follow needed: asked to reply -> replies -> PDF
sim2(username="hank", text="notes", follows=True)   # follows -> text + PDF
sim2(username="ivy", text="notes", follows=False)   # never follows -> gave_up
settle(6)
ev = {e["username"]: e["status"] for e in call("GET", "/events")}
assert (ev["gina"], ev["hank"], ev["ivy"]) == ("sent", "sent", "gave_up"), ev

call("DELETE", f"/automations/{gate_a['id']}")
call("POST", "/disconnect")
assert call("GET", "/status")["account"]["connected"] is False
print("ALL OK")
