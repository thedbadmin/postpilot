"""Start PostPilot with Windows (per-user Run key, no admin rights needed)."""
import os
import sys

from .config import APP_DIR, APP_NAME

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def supported():
    return os.name == "nt"


def _command():
    if getattr(sys, "frozen", False):  # packaged .exe
        return f'"{sys.executable}" --background'
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    exe = pyw if os.path.exists(pyw) else sys.executable
    return f'"{exe}" "{APP_DIR / "run.py"}" --background'


def set_enabled(enabled: bool):
    if not supported():
        return False
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if enabled:
            winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, _command())
        else:
            try:
                winreg.DeleteValue(k, APP_NAME)
            except FileNotFoundError:
                pass
    return True


def is_enabled():
    if not supported():
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, APP_NAME)
            return True
    except OSError:
        return False
