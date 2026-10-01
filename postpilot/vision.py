"""Draft a post from attached images with Groq's free vision model.

Separate from ai.py on purpose: it has its own key and model (Settings > AI writing > Image AI), so the
main writing provider stays exactly as configured. Reuses ai.py's voice prompt and clean-up.
"""
import base64
import io
import time

import requests

from . import ai, store
from .config import MOCK

URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_IMAGES = 3     # Groq's per-request limit
MAX_SIDE = 1600    # px; keeps requests small and well inside Groq's size limits

PROMPT = ("Write a LinkedIn post based on the attached image(s). Build the post only on what is actually "
          "visible plus the author's context below, if any. If text in the image is readable, you may use it.\n"
          "Strict rules:\n"
          "- Do not invent names, places, dates, numbers or events the image does not show.\n"
          "- Do not claim the author did, built, fixed, tested, attended or experienced anything unless the "
          "author's context says so. Without such context, write as an observation or takeaway "
          "(e.g. 'This chart shows…', 'Here is what stands out…'), not as a personal story.\n"
          "- Do not add causes, steps, tools, feelings or outcomes that are neither visible nor in the context.\n"
          "- Every number in the post must appear in the image or the context, or be calculated directly "
          "from them.")


def prepare(path):
    """Image file -> base64 JPEG, at most MAX_SIDE px on the long side (GIF: first frame)."""
    from PIL import Image
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def draft(media_ids, topic=""):
    paths = [store.media_path(m) for m in (media_ids or []) if not store.is_video(m)][:MAX_IMAGES]
    paths = [p for p in paths if p and p.exists()]
    if not paths:
        raise ai.AIError("The attached image could not be found. Re-attach it and try again.")
    if MOCK:
        time.sleep(0.4)
        return "A picture says a lot, so here is what this one shows.\n\nWhat do you see in it?\n\n#photo"
    key = store.get_secret("vision_api_key")
    if not key:
        raise ai.AIError("Add your free Groq key in Settings → AI writing → Image AI key.")
    model = store.get_setting("vision_model")
    text = PROMPT + (f"\n\nContext from the author: {topic}" if topic else "")
    content = [{"type": "text", "text": text}] + [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{prepare(p)}"}} for p in paths]
    body = {"model": model, "temperature": 0.3,  # low: describing an image should not get creative with facts
            "messages": [{"role": "system", "content": ai._system()}, {"role": "user", "content": content}]}
    for attempt in range(2):
        try:
            r = requests.post(URL, timeout=120, headers={"Authorization": f"Bearer {key}"}, json=body)
        except requests.RequestException as e:
            raise ai.AIError(f"Could not reach Groq: {e}") from e
        if r.status_code in (500, 502, 503, 504) and attempt == 0:
            time.sleep(3)
            continue
        break
    if r.status_code == 401:
        raise ai.AIError("Image AI key was rejected. Check it in Settings → AI writing.")
    if r.status_code == 429:
        raise ai.AIError("Free image-AI limit reached for now. Try again in a minute.")
    if r.status_code == 404 or (r.status_code == 400 and "model" in r.text.lower()):
        raise ai.AIError(f"Groq doesn't accept the image model “{model}”. Update it in Settings → AI writing.")
    if r.status_code != 200:
        raise ai.AIError(f"Image AI error {r.status_code}: {r.text[:200]}")
    out = ai._clean(r.json()["choices"][0]["message"].get("content") or "")
    if not out:
        raise ai.AIError("The image AI returned an empty draft. Try again.")
    return out
