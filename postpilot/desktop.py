"""Native window (pywebview / WebView2 on Windows) + system tray icon.
Closing the window only hides it; the agent keeps publishing from the tray."""
import os
import threading

from . import scheduler, server, store
from .config import APP_DIR, APP_NAME, DATA_DIR, WEB_DIR

_state = {"quitting": False, "window": None, "icon": None}


def _icon_image():
    from PIL import Image
    for p in (WEB_DIR / "icon.png", APP_DIR / "assets" / "icon.png"):
        if p.exists():
            return Image.open(p)
    img = Image.new("RGBA", (64, 64), (10, 102, 194, 255))
    return img


def show():
    w = _state["window"]
    if w:
        w.show()
        try:
            w.restore()
        except Exception:
            pass


def quit_app(*_):
    _state["quitting"] = True
    if _state["icon"]:
        _state["icon"].stop()
    if _state["window"]:
        _state["window"].destroy()
    os._exit(0)


def _start_tray():
    try:
        import pystray
    except ImportError:
        return None

    def status_text(_item):
        c = store.counts()
        return f"{c['scheduled']} scheduled · {c['published']} published"

    def pause_text(_item):
        return "Resume agent" if store.get_setting("agent_paused") else "Pause agent"

    def toggle_pause(*_):
        store.set_settings({"agent_paused": not store.get_setting("agent_paused")})
        store.log("warn" if store.get_setting("agent_paused") else "info",
                  "Agent paused from tray." if store.get_setting("agent_paused") else "Agent resumed.")
        scheduler.wake()

    menu = pystray.Menu(
        pystray.MenuItem(f"Open {APP_NAME}", lambda *_: show(), default=True),
        pystray.MenuItem(status_text, None, enabled=False),
        pystray.MenuItem(pause_text, toggle_pause),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit (stops auto-posting)", quit_app),
    )
    icon = pystray.Icon(APP_NAME, _icon_image(), APP_NAME, menu)
    _state["icon"] = icon

    def notify(title, msg):
        try:
            icon.notify(msg, title)
        except Exception:
            pass

    scheduler.set_notifier(notify)
    if os.name == "nt":
        icon.run_detached()
    else:
        threading.Thread(target=icon.run, daemon=True).start()
    return icon


def run(url, start_hidden=False):
    import webview

    server.show_window_cb = show
    window = webview.create_window(APP_NAME, url, width=1320, height=860, min_size=(1000, 660),
                                   hidden=start_hidden, background_color="#F4F2EE")
    _state["window"] = window

    def on_closing():
        if _state["quitting"] or not _state["icon"]:
            return True
        threading.Thread(target=window.hide, daemon=True).start()
        if not _state.get("hinted"):
            _state["hinted"] = True
            scheduler._toast(APP_NAME, "Still running in the tray. Scheduled posts will go out on time.")
        return False  # cancel close -> keep running in tray

    window.events.closing += on_closing
    tray = _start_tray()
    if tray is None and start_hidden:
        window.show()
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    webview.start(private_mode=False, storage_path=str(DATA_DIR / "webview"))
    if not _state["quitting"] and not _state["icon"]:
        os._exit(0)
