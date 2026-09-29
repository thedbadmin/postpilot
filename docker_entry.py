"""Docker entrypoint: run.py --headless, but listening on 0.0.0.0 and with a fixed access token.

Wraps run.py without modifying it (it hardcodes 127.0.0.1 and a random per-launch token).
"""
import os
import sys

import uvicorn

_Config = uvicorn.Config
uvicorn.Config = lambda *a, **k: _Config(*a, **{**k, "host": "0.0.0.0"})

from postpilot import server  # noqa: E402

server.APP_TOKEN = os.environ["POSTPILOT_TOKEN"]

import run  # noqa: E402

sys.argv = ["run.py", "--headless"]
sys.exit(run.main())
