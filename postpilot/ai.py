"""AI drafting: Groq (default, free tier), any OpenAI-compatible endpoint, or Anthropic."""
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from . import store
from .config import MOCK

ENDPOINTS = {
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "openai": "https://api.openai.com/v1/chat/completions",
}
LENGTHS = {"short": "60-110 words", "medium": "120-220 words", "long": "220-350 words"}

ACTIONS = {
    "improve": "Improve clarity and flow. Keep the meaning, voice and length roughly the same.",
    "shorten": "Make it about 40% shorter without losing the key point.",
    "hook": "Rewrite only the first 1-2 lines into a stronger hook that makes people click 'see more'. "
            "Keep the rest unchanged.",
    "hashtags": "Keep the text unchanged but replace/add at most 3 relevant hashtags at the end.",
    "fix": "Fix grammar, spelling and punctuation only. Change nothing else.",
    "professional": "Make the tone more professional while staying first-person and human.",
    "casual": "Make the tone more conversational and friendly.",
}


class AIError(Exception):
    pass


def _system():
    s = store.get_settings()
    now = datetime.now(ZoneInfo(s["timezone"]))
    return (
        "You are a LinkedIn ghostwriter for one person. "
        f"Today is {now:%A, %d %B %Y}.\n"
        f"Their voice: {s['brand_voice']}\n"
        f"Rules: strong first line (hook) that works before the 'see more' cut, short paragraphs with blank "
        f"lines between them, {LENGTHS.get(s['post_length'], LENGTHS['medium'])}, at most 3 relevant hashtags at "
        "the end, no invented facts, numbers or quotes, emojis only if they add meaning, no markdown "
        "(no **bold**, no headings) because LinkedIn shows it literally.\n"
        "Output ONLY the post text. No preface, no quotes around it, no explanation."
    )


def _clean(text):
    text = (text or "").strip()
    text = re.sub(r"^```\w*\n?|```$", "", text).strip()
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    if len(text) > 1 and text[0] == text[-1] == '"':
        text = text[1:-1].strip()
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)  # LinkedIn doesn't render markdown bold
    return text


def _chat(system, user, temperature=0.7):
    s = store.get_settings()
    key = store.get_secret("ai_api_key")
    if MOCK:
        time.sleep(0.4)
        topic = user.split("\n")[0].replace("Write a LinkedIn post about: ", "")[:80]
        return (f"Most people overthink this: {topic}\n\nHere is what I learned after trying it myself.\n\n"
                "1. Start small and ship.\n2. Ask for feedback early.\n3. Keep going when it gets boring.\n\n"
                "What would you add?\n\n#learning #growth #career")
    if not key:
        raise AIError("Add your AI API key in Settings (Groq keys are free at console.groq.com/keys).")
    provider = s["ai_provider"]
    delay = 3
    for attempt in range(3):
        try:
            if provider == "anthropic":
                r = requests.post("https://api.anthropic.com/v1/messages", timeout=90, headers={
                    "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": s["ai_model"], "max_tokens": 1500, "system": system,
                          "messages": [{"role": "user", "content": user}]})
            else:
                url = s["ai_base_url"].strip() or ENDPOINTS.get(provider, ENDPOINTS["groq"])
                r = requests.post(url, timeout=90, headers={"Authorization": f"Bearer {key}"}, json={
                    "model": s["ai_model"], "temperature": temperature,
                    "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
        except requests.RequestException as e:
            if attempt == 2:
                raise AIError(f"Could not reach the AI service: {e}") from e
            time.sleep(delay)
            delay *= 2
            continue
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            time.sleep(delay)
            delay *= 2
            continue
        if r.status_code == 401:
            raise AIError("AI API key was rejected. Check it in Settings.")
        if r.status_code != 200:
            raise AIError(f"AI service error {r.status_code}: {r.text[:200]}")
        data = r.json()
        if provider == "anthropic":
            return "".join(b.get("text", "") for b in data.get("content", []))
        return data["choices"][0]["message"]["content"]
    raise AIError("AI service is busy. Try again in a minute.")


def draft(topic, extra=""):
    user = f"Write a LinkedIn post about: {topic}"
    if extra:
        user += f"\n\nContext: {extra}"
    return _clean(_chat(_system(), user))


def rewrite(text, action, instruction=""):
    how = ACTIONS.get(action) or instruction or ACTIONS["improve"]
    if action == "custom" and instruction:
        how = instruction
    user = f"{how}\n\nPost:\n{text}"
    return _clean(_chat(_system(), user))
