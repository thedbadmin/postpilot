"""PostPilot launcher.

  python run.py               open the app (window + tray icon, agent runs in background)
  python run.py --background  start hidden in the tray (used by "Start with Windows")
  python run.py --headless    agent + local API only, no window (servers / testing)
"""
import argparse
import json
import logging
import socket
import sys
import threading
import time

import requests

from postpilot import config, scheduler, server, store


def _existing_instance():
    """If PostPilot is already running, ask it to show its window and return True."""
    try:
        info = json.loads(config.INSTANCE_FILE.read_text())
        r = requests.post(f"http://127.0.0.1:{info['port']}/api/show",
                          headers={"X-PP-Token": info["token"]}, timeout=2)
        return r.status_code == 200
    except Exception:
        return False


def _free_port(start):
    for port in range(start, start + 50):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("No free local port found.")


def _bootstrap():
    """First run: pick up keys from .env / the old CLI version so the user doesn't re-enter them."""
    import os
    s = store.get_settings()
    new = {}
    if not s["client_id"] and os.getenv("LINKEDIN_CLIENT_ID"):
        new["client_id"] = os.environ["LINKEDIN_CLIENT_ID"]
    if os.getenv("LINKEDIN_REDIRECT_URI") and s["redirect_uri"] == store.DEFAULT_SETTINGS["redirect_uri"]:
        new["redirect_uri"] = os.environ["LINKEDIN_REDIRECT_URI"]
    if os.getenv("POSTPILOT_BROKER_URL") and not s["broker_url"]:
        new.update(broker_url=os.environ["POSTPILOT_BROKER_URL"], auth_mode="broker")
    if not store.get_secret("li_client_secret") and os.getenv("LINKEDIN_CLIENT_SECRET"):
        store.set_secret("li_client_secret", os.environ["LINKEDIN_CLIENT_SECRET"])
    if not store.get_secret("ai_api_key"):
        prov = os.getenv("LLM_PROVIDER", "groq").lower()
        key = {"groq": "GROQ_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}.get(prov)
        if key and os.getenv(key):
            store.set_secret("ai_api_key", os.environ[key])
            new["ai_provider"] = prov
            if prov == "anthropic":
                new["ai_model"] = os.getenv("CLAUDE_MODEL", "claude-sonnet-5")
            elif prov == "groq" and os.getenv("GROQ_MODEL"):
                new["ai_model"] = os.environ["GROQ_MODEL"]
    cli = config.APP_DIR.parent
    if not store.get_token() and (cli / "token.json").exists():
        try:
            store.set_token(json.loads((cli / "token.json").read_text()))
            store.log("info", "Imported LinkedIn session from the command-line version.")
        except (OSError, ValueError):
            pass
    voice = cli / "brand_voice.txt"
    if not store.q("SELECT 1 FROM settings WHERE key='brand_voice'") and voice.exists():
        new["brand_voice"] = voice.read_text(encoding="utf-8").strip()
    if new:
        store.set_settings(new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--background", action="store_true")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--port", type=int, default=config.DEFAULT_PORT)
    args = ap.parse_args()

    logging.basicConfig(filename=config.LOG_FILE, level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if _existing_instance():
        return

    _bootstrap()
    from postpilot import autostart
    if store.get_setting("autostart") and autostart.is_enabled():
        autostart.set_enabled(True)  # refresh the path in case the app folder moved
    port = _free_port(args.port)
    import uvicorn
    srv = uvicorn.Server(uvicorn.Config(server.app, host="127.0.0.1", port=port, log_level="warning",
                                       log_config=None))
    threading.Thread(target=srv.run, daemon=True, name="api").start()
    while not srv.started:
        time.sleep(0.05)
    config.INSTANCE_FILE.write_text(json.dumps({"port": port, "token": server.APP_TOKEN}))
    scheduler.start()
    from postpilot import insta_agent
    insta_agent.start()  # idle until an Instagram token is saved
    url =f"http://127.0.0.1:{port}/#t={server.APP_TOKEN}"

    if args.headless:
        print(f"{config.APP_NAME} running headless. UI: {url}", flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return
    from postpilot import desktop
    desktop.run(url, start_hidden=args.background)


if __name__ == "__main__":
    sys.exit(main())
