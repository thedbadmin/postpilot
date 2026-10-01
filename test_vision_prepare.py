"""Image prep for "Write from image": any upload becomes a JPEG no larger than MAX_SIDE.

Run: python test_vision_prepare.py   (needs Pillow; no DB, no Groq)
"""
import base64
import io
import os
import tempfile

os.environ.setdefault("DATABASE_URL", "postgresql://unused")
from PIL import Image  # noqa: E402

from postpilot import vision  # noqa: E402


def check(size, mode, ext):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "x" + ext)
        Image.new(mode, size).save(p)
        out = Image.open(io.BytesIO(base64.b64decode(vision.prepare(p))))
        assert out.format == "JPEG" and max(out.size) <= vision.MAX_SIDE, (size, mode, out.size)
        return out.size


assert check((4000, 3000), "RGB", ".jpg") == (1600, 1200)   # big photo shrinks, keeps aspect
assert check((800, 600), "RGBA", ".png") == (800, 600)      # small PNG with alpha: same size, flattened
assert check((300, 300), "P", ".gif") == (300, 300)         # GIF -> first frame as JPEG
print("ok")
