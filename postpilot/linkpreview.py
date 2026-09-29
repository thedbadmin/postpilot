"""Fetch Open Graph title/description/image for a URL so the link card can be pre-filled.
(LinkedIn's Posts API does not scrape URLs itself, so the app must supply these fields.)"""
import html
import re
import uuid
from urllib.parse import urljoin, urlparse

import requests

from . import store
from .config import MEDIA_DIR, MOCK

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PostPilot/1.0 (+link preview)"


def _meta(page, *names):
    for n in names:
        for pat in (rf'<meta[^>]+(?:property|name)=["\']{n}["\'][^>]*content=["\']([^"\']*)',
                    rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']{n}["\']'):
            m = re.search(pat, page, re.I)
            if m and m.group(1).strip():
                return html.unescape(m.group(1).strip())
    return ""


def save_remote_image(url, max_bytes=5_000_000):
    r = requests.get(url, timeout=15, headers={"User-Agent": UA}, stream=True)
    mime = r.headers.get("Content-Type", "").split(";")[0].strip()
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif"}.get(mime)
    if r.status_code != 200 or not ext:
        return None
    data = r.raw.read(max_bytes + 1, decode_content=True)
    if len(data) > max_bytes:
        return None
    mid = uuid.uuid4().hex
    path = MEDIA_DIR / f"{mid}{ext}"
    path.write_bytes(data)
    store.add_media(mid, f"thumbnail{ext}", path, mime, len(data))
    return mid


def fetch(url):
    if not re.match(r"https?://", url or ""):
        raise ValueError("Link must start with http:// or https://")
    domain = urlparse(url).netloc.replace("www.", "")
    if MOCK:
        return {"url": url, "title": f"Article on {domain}", "desc": "A short description of the page.",
                "thumb": None, "domain": domain}
    out = {"url": url, "title": "", "desc": "", "thumb": None, "domain": domain}
    try:
        r = requests.get(url, timeout=12, headers={"User-Agent": UA})
        page = r.text[:500_000]
    except requests.RequestException:
        return out
    out["title"] = _meta(page, "og:title", "twitter:title")
    if not out["title"]:
        m = re.search(r"<title[^>]*>(.*?)</title>", page, re.I | re.S)
        out["title"] = html.unescape(m.group(1).strip()) if m else ""
    out["desc"] = _meta(page, "og:description", "twitter:description", "description")[:300]
    img = _meta(page, "og:image", "twitter:image")
    if img:
        try:
            out["thumb"] = save_remote_image(urljoin(url, img))
        except requests.RequestException:
            pass
    return out
