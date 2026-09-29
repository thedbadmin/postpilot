"""Paths, constants and .env loading for PostPilot."""
import os
import sys
from pathlib import Path

APP_NAME = "PostPilot"
VERSION = "1.0.0"
DEFAULT_PORT = int(os.getenv("POSTPILOT_PORT", "47821"))
MOCK = os.getenv("POSTPILOT_MOCK", "") == "1"  # fake LinkedIn + AI (tests / demo)


def _app_dir() -> Path:
    # Folder containing the code or the frozen .exe
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent.parent


def _resource_dir() -> Path:
    # Bundled read-only files (web UI). PyInstaller unpacks to _MEIPASS.
    return Path(getattr(sys, "_MEIPASS", _app_dir()))


def _data_dir() -> Path:
    if os.getenv("POSTPILOT_HOME"):
        d = Path(os.environ["POSTPILOT_HOME"])
    elif os.name == "nt":
        d = Path(os.getenv("APPDATA", Path.home())) / APP_NAME
    else:
        d = Path.home() / ".postpilot"
    d.mkdir(parents=True, exist_ok=True)
    (d / "media").mkdir(exist_ok=True)
    return d


APP_DIR = _app_dir()
WEB_DIR = _resource_dir() / "web"
DATA_DIR = _data_dir()
MEDIA_DIR = DATA_DIR / "media"
INSTANCE_FILE = DATA_DIR / "instance.json"
LOG_FILE = DATA_DIR / "postpilot.log"


def load_env():
    """Read KEY=VALUE lines from .env next to the app (and its parent, for the old CLI folder)."""
    for f in (APP_DIR / ".env", APP_DIR.parent / ".env", DATA_DIR / ".env"):
        if f.exists():
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()
