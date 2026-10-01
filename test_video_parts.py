"""Video -> 2 still frames + audio track (or None when silent). Run: python test_video_parts.py (needs imageio-ffmpeg)."""
import os
import subprocess
import tempfile
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://unused")
import imageio_ffmpeg  # noqa: E402

from postpilot import vision  # noqa: E402

ff = imageio_ffmpeg.get_ffmpeg_exe()
with tempfile.TemporaryDirectory() as d:
    talk, silent = Path(d) / "talk.mp4", Path(d) / "silent.mp4"
    (Path(d) / "a").mkdir()
    src = ["-f", "lavfi", "-i", "testsrc=duration=4:size=640x360:rate=25"]
    subprocess.run([ff, "-v", "error", "-y", *src, "-f", "lavfi", "-i", "sine=duration=4", "-shortest",
                    "-pix_fmt", "yuv420p", str(talk)], check=True)
    subprocess.run([ff, "-v", "error", "-y", *src, "-pix_fmt", "yuv420p", str(silent)], check=True)
    frames, audio = vision.video_parts(talk, Path(d) / "a"); (Path(d) / "b").mkdir()
    assert len(frames) == 2 and audio and audio.stat().st_size > 0
    frames, audio = vision.video_parts(silent, Path(d) / "b")
    assert len(frames) == 2 and audio is None
print("ok")
