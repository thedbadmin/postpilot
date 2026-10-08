"""WhatsApp agent end to end, against the demo stack (POSTPILOT_MOCK=1).

Run: docker compose up -d --build
     docker compose cp test_wa_flow.py app:/tmp/ && docker compose exec app python /tmp/test_wa_flow.py
"""
import os
import random
import time

import requests

B = "http://127.0.0.1:47821/api/wa"
H = {"X-PP-Token": os.environ["POSTPILOT_TOKEN"]}
BOSS = "919900011122"
R = str(random.randint(10000, 99999))  # fresh customers each run: the demo database is kept between runs
N1, N2, N3 = (f"91981{i}{R}" for i in (1, 2, 3))


def call(m, p, body=None, ok=200):
    r = requests.request(m, B + p, json=body, headers=H, timeout=30)
    assert r.status_code == ok, (m, p, r.status_code, r.text)
    return r.json()


def settle(sec=12):  # QUIET_SECONDS + a tick
    end = time.time() + sec
    while time.time() < end:
        call("POST", "/check")
        time.sleep(2)


def chat(num):
    return call("GET", f"/chats/{num}")


assert requests.get(B + "/status").status_code == 401, "auth must be enforced"
call("POST", "/disconnect")
call("POST", "/connect", {"api_key": "short"}, ok=400)
acct = call("POST", "/connect", {"api_key": "kapso_" + "x" * 30})
print("connected:", acct)
call("PUT", "/settings", {"values": {"wa_boss": "123"}}, ok=400)
call("PUT", "/settings", {"values": {"wa_template": "Bad Name"}}, ok=400)
call("PUT", "/settings", {"values": {"wa_boss": "+91 99000 11122", "wa_business": "TheDBAdmin Training",
                                     "wa_knowledge": "Next batch: 1 Nov."}})
call("POST", "/pause", {"paused": False})

# the bot tries a made-up chat without sending anything
d = call("POST", "/test", {"messages": [{"sender": "customer", "text": "fees?"}]})
assert d["action"] == "reply" and d["reply"], d
d = call("POST", "/test", {"messages": [{"sender": "customer", "text": "I paid but got no access, refund!"}]})
assert d["action"] == "escalate", d
call("POST", "/test", {"messages": [{"sender": "bot", "text": "hi"}]}, ok=400)

sim = lambda **k: call("POST", "/simulate", k)  # noqa: E731
sim(contact=N1, name="Asha", text="Hi, next batch kab hai?")
sim(contact=N1, name="Asha", text="and fees?")              # two lines -> one reply
sim(contact=N2, name="Ravi", text="Payment done but no access, urgent!")
settle()

a = chat(N1)
print("Asha:", a["status"], [(m["sender"], m["text"][:30]) for m in a["messages"]])
assert a["status"] == "bot" and [m["sender"] for m in a["messages"]] == ["customer", "customer", "bot"], a  # one reply to both
r = chat(N2)
print("Ravi:", r["status"], r["alert"], r["summary"])
assert r["status"] == "escalated" and r["messages"][-1]["sender"] == "bot", r
assert r["alert"] == "Boss alerted on WhatsApp (template).", r["alert"]  # boss never wrote -> template
st = call("GET", "/status")
assert any(m["to"] == BOSS and m["text"].startswith(f"[template urgent_alert] Ravi (+{N2})") for m in st["demo_sent"])
assert st["counts"]["open"] >= 1 and st["counts"]["replies_today"] >= 2, st["counts"]

# Ravi writes again: escalated -> the bot stays quiet
sim(contact=N2, name="Ravi", text="hello??")
settle()
assert chat(N2)["messages"][-1]["sender"] == "customer"

# the boss answers Ravi from the Business app -> human; then hands back in PostPilot -> bot answers new messages only
sim(contact=N2, name="Ravi", text="Ravi, fixing it now", as_boss=True)
settle(4)
assert chat(N2)["status"] == "human"
call("POST", f"/chats/{N2}/status", {"status": "bot"})
sim(contact=N2, name="Ravi", text="thanks, when is the next batch?")
settle()
r = chat(N2)
assert r["status"] == "bot" and r["messages"][-1]["sender"] == "bot", r

# a team member replies from PostPilot -> human
call("POST", f"/chats/{N1}/send", {"text": "Hi Asha, I'm Abhishek."})
assert chat(N1)["status"] == "human"
call("POST", f"/chats/{N1}/send", {"text": " "}, ok=400)

# the boss writing to the company number is never treated as a customer
sim(contact="+91 99000 11122", name="Boss", text="ok noted")
settle()
assert all(c["contact"] != BOSS for c in call("GET", "/chats")), "boss became a customer chat"
# ...and now his 24 h window is open, so the next alert is a free message
call("POST", "/test-alert")
assert call("GET", "/status")["demo_sent"][0]["text"].startswith("🔴 Urgent WhatsApp from Test from PostPilot")

# pause: nobody is answered
call("POST", "/pause", {"paused": True})
sim(contact=N3, name="Mona", text="hi")
time.sleep(12)
assert requests.get(B + f"/chats/{N3}", headers=H).status_code == 404
call("POST", "/pause", {"paused": False})
settle()
assert chat(N3)["messages"][-1]["sender"] == "bot"

print("counts:", call("GET", "/status")["counts"])
print("ALL WHATSAPP CHECKS PASSED")
