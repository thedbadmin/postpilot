"""Video upload against a fake LinkedIn: byte ranges, ETag order, finalize, waiting for processing.

Run: python test_video_upload.py   (no DB, no LinkedIn)
"""
import os
import tempfile
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://unused")
from postpilot import linkedin  # noqa: E402

PART = 4 * 1024 * 1024
data = os.urandom(PART * 2 + 1000)  # 3 parts, the last one short
linkedin._token = lambda: {"access_token": "x", "person_urn": "urn:li:person:x"}
linkedin.store.get_setting = lambda k: "202608"
linkedin.time.sleep = lambda s: None


class R:
    def __init__(self, code, js=None, headers=None):
        self.status_code, self._js, self.headers, self.text = code, js, headers or {}, ""

    def json(self):
        return self._js


def fake(statuses):
    calls = []

    def req(method, url, **kw):
        calls.append((method, url, kw))
        if "initializeUpload" in url:
            assert kw["json"]["initializeUploadRequest"]["fileSizeBytes"] == len(data)
            parts = [{"firstByte": i, "lastByte": min(i + PART, len(data)) - 1, "uploadUrl": f"https://up/{i}"}
                     for i in range(0, len(data), PART)]
            return R(200, {"value": {"video": "urn:li:video:V1", "uploadToken": "tok", "uploadInstructions": parts}})
        if url.startswith("https://up/"):
            first = int(url.rsplit("/", 1)[1])
            assert kw["data"] == data[first:first + PART]          # exact byte range
            return R(200, headers={"etag": f'"e{first}"'})
        if "finalizeUpload" in url:
            assert kw["json"]["finalizeUploadRequest"]["uploadedPartIds"] == [f"e{i}" for i in range(0, len(data), PART)]
            return R(200, {})
        return R(200, {"status": statuses.pop(0), "processingFailureReason": "bad codec"})
    linkedin._req = req
    return calls


with tempfile.TemporaryDirectory() as d:
    p = Path(d) / "v.mp4"
    p.write_bytes(data)

    calls = fake(["PROCESSING", "PROCESSING", "AVAILABLE"])
    assert linkedin.upload_video(p) == "urn:li:video:V1"
    assert sum(1 for c in calls if c[1].startswith("https://up/")) == 3    # 3 parts uploaded
    assert sum(1 for c in calls if c[0] == "GET") == 3                     # waited until AVAILABLE

    fake(["PROCESSING", "PROCESSING_FAILED"])
    try:
        linkedin.upload_video(p)
        raise AssertionError("expected PermanentError")
    except linkedin.PermanentError as e:
        assert "bad codec" in str(e)
print("ok")
