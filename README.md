# PostPilot — LinkedIn post scheduler with an AI assistant

A desktop app for Windows. You write posts (yourself or with AI) and see exactly how each one will look in the LinkedIn feed. You then queue them into your posting slots and get on with your day. A background agent publishes them on time through LinkedIn's **official API**. It starts with Windows and keeps running in the system tray.

> PostPilot never likes, comments, messages or scrapes. Nothing is published without an explicit click from you.

**Office team:** to use PostPilot, keep the server running and fix problems, read [HANDBOOK.md](HANDBOOK.md).

---

## 1. What's inside

```
postpilot/
├── run.py                  # start the app  (python run.py | --background | --headless)
├── start_postpilot.bat     # double-click: sets up Python packages once, then opens the app
├── requirements.txt
├── .env.example            # optional keys; picked up on first start
├── postpilot/              # the agent (Python)
│   ├── config.py           #   data folder (%APPDATA%\PostPilot), port, .env loading
│   ├── store.py            #   PostgreSQL: posts, images, activity log, settings; secrets in Credential Manager
│   ├── linkedin.py         #   OAuth login + publishing (text, image, carousel, link card)
│   ├── ai.py               #   drafting/rewriting via Groq, OpenAI or Anthropic
│   ├── linkpreview.py      #   fetches title/description/image for link cards
│   ├── scheduler.py        #   background loop: publish, retry, flag missed posts, notify
│   ├── server.py           #   local API on 127.0.0.1 (window + extension talk to this)
│   ├── autostart.py        #   "Start with Windows" (per-user Run key, no admin)
│   └── desktop.py          #   native window (WebView2) + tray icon
├── web/                    # the screens (HTML/CSS/JS, no build step)
├── extension/              # Chrome/Edge companion extension
├── auth_broker/            # login server for public release (keeps the Client Secret off user PCs)
├── assets/                 # app icon
├── build_windows.bat       # builds dist\PostPilot\PostPilot.exe
└── installer.iss           # Inno Setup script -> PostPilot-Setup.exe
```

## 2. Run it (development, from VS Code)

Requirements: Windows 10/11 and **Python 3.11–3.13** (pywebview's Windows backend doesn't support every new Python release on day one). The window uses Microsoft Edge WebView2, which is already installed on Windows 10/11.

The app stores everything in **PostgreSQL**, so set `DATABASE_URL` before starting it (e.g. start just the `db` service from `docker-compose.yml`):

```bat
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set DATABASE_URL=postgresql://postpilot:postpilot@127.0.0.1:5433/postpilot
python run.py
```

Or just double-click **`start_postpilot.bat`**. The first run installs everything into `.venv`, and after that it opens straight away.

Because this folder sits inside your old `linkedin_agent` folder, the first start **imports automatically**:

- the LinkedIn Client ID and Secret, plus your Groq key, from `..\.env`
- your LinkedIn session from `..\token.json`, so you don't have to log in again
- your tone from `..\brand_voice.txt`

**Try it without touching LinkedIn (demo mode):**

```bat
set POSTPILOT_MOCK=1
set POSTPILOT_HOME=%TEMP%\pp-demo
python run.py
```

Nothing is sent to LinkedIn or the AI in this mode, and it uses a separate throw-away data folder.

## 3. Using it

| Screen | What you do there |
|---|---|
| **Dashboard** | Shows the agent status (running / paused / not responding), counts, a countdown to the next post, what's coming up, and recent activity. You can pause and resume the agent here. |
| **Compose** | Write, or type a topic and use **Write with AI**. You can also **Rewrite with AI** (stronger hook, shorter, hashtags, grammar…). Add up to 20 images (drag, drop or paste) or one link card. The **live preview** switches between desktop/mobile and light/dark, and shows the real "…more" cut. Then pick *Next free slot*, *a specific time*, or *Post now*. |
| **Queue** | Every post, by tab: Drafts · Scheduled · Published · Needs attention. Select several drafts and use **Schedule selected into next slots** to plan the week in one click. Failed or missed posts show the reason and a **Retry** button. |
| **Calendar** | Month view. Your posting days are marked, and clicking a post previews it. |
| **AI Batch** | Paste up to 30 topics (one per line) and get a draft for each. Review them, then **Schedule all into next slots**. |
| **Activity** | The full log of what the agent did: published, retries, errors, logins. |
| **Settings** | LinkedIn account, AI provider/key/voice, posting days and times, time zone, missed-post policy, Start with Windows, notifications, language (English/Hinglish), theme, and browser extension pairing. |

**How the agent behaves**

- It checks the queue every 15 s. Closing the window only hides it; **Quit** from the tray icon stops auto-posting.
- Network errors, rate limits and LinkedIn 5xx errors are retried 3 times (after 2, 10 and 30 min). Then the post is marked *Failed* and you get a notification.
- If the PC was off at post time, the post is published late only within your grace window (Settings, default 6 h). Otherwise it becomes *Missed*, so a stale post never goes out unexpectedly.
- **Posting limits** (Settings → Posting schedule) are enforced by the agent, not just the UI. They apply to scheduling, bulk scheduling, "Post now", the extension and anything queued before a limit change:
  - max posts per day (default 2, hard cap 5)
  - minimum gap between posts (default 3 h, hard minimum 1 h)
  - max posts waiting in the queue (default 30, hard cap 60)

  *Next free slot* skips days and times that would break a limit. If a queued post would exceed the daily limit at publish time, it is moved to the next free slot instead. The hard caps are constants in `postpilot/scheduler.py` (`HARD_MAX_PER_DAY`, `HARD_MIN_GAP_MIN`, `HARD_MAX_QUEUE`), so a public build can't be configured into a spam tool.
- LinkedIn sessions last 60 days. The app warns you 7 days before expiry: on the dashboard, with a tray notification, and on the extension badge.

## 3b. Instagram agent (comment a keyword → get the link in DMs)

Click **Instagram agent ↗** in the sidebar. It opens in its own tab (`#/insta`), next to the LinkedIn one.

- **Connect:** in your Meta developer app go to Instagram → API setup with Instagram login → step 2 → **Generate token** on your account, then paste it in the Instagram tab's Settings. PostPilot renews the token daily, so you paste it only once.
- **Automations:** pick a post (or "any post" = your 10 newest), keywords, the link to send, and the DM text. Optionally switch on **Only for followers**: the first DM asks people to follow and reply, and the link is sent once the follow is confirmed (at most 2 reminders).
- **How it runs:** a separate thread polls Instagram every 60 s (`postpilot/insta_agent.py`). There are no webhooks, so nothing has to be reachable from the internet. Each comment is answered at most once (`ig_events`), and each person gets one DM per automation.
- **Instagram's rules:** one DM per comment, within 7 days of it; further DMs only after the person replies. The agent also caps itself at 150 DMs/hour. Comments made while an automation is off are not answered.
- **Until Meta's App Review** the app is in development mode: only accounts added as *Instagram testers* in the Meta app trigger the bot.
- **Without a token** the agent makes no Instagram calls at all. Demo mode (`POSTPILOT_MOCK=1`) fakes Instagram and adds a "Simulate comment" card. `test_insta_flow.py` tests the whole flow against it.

## 4. Browser extension (Chrome / Edge)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension` folder.
3. In PostPilot, go to Settings → Browser extension → **Create connection code**, then paste the code into the extension popup.

The extension lets you:

- save the current page as a link-card draft
- save selected text or a quick idea as a draft (from the popup or the right-click menu)
- see scheduled, draft and needs-attention counts, plus the next post, on the toolbar badge

For the public version, publish it to the Chrome Web Store / Edge Add-ons. The extension doesn't post by itself, and that's intentional:

- Automating clicks on linkedin.com breaks LinkedIn's User Agreement and gets accounts restricted.
- An extension stops working when the browser is closed.

## 5. Build the Windows app and installer

```bat
build_windows.bat          :: -> dist\PostPilot\PostPilot.exe  (no Python needed on user PCs)
```

Then open `installer.iss` in [Inno Setup](https://jrsoftware.org/isinfo.php) and click **Compile**. That produces `Output\PostPilot-Setup.exe`, which installs per-user (no admin), adds a Start-menu shortcut, and removes autostart on uninstall.

## 6. Going public — checklist

1. **Login server:** deploy `auth_broker/` (see its README). In the bundled `.env`, set `POSTPILOT_BROKER_URL`, and do **not** ship `LINKEDIN_CLIENT_SECRET`.
2. **LinkedIn app:** add both products, *Share on LinkedIn* (`w_member_social`) and *Sign In with LinkedIn using OpenID Connect*. Add `https://<login-server>/callback` as an authorized redirect URL. LinkedIn's API allows 150 post requests per member per day.
3. **Name and branding:** LinkedIn's brand guidelines don't allow "LinkedIn" in a third-party product name or logo. "PostPilot" is a working name, so check trademark availability before launch.
4. **Code signing:** sign `PostPilot.exe` and the installer. Otherwise Windows SmartScreen warns users.
5. **Privacy policy and terms:** state that posts, images and tokens stay on the user's PC, and that drafts are sent to the chosen AI provider.
6. **Session refresh:** LinkedIn issues programmatic refresh tokens only to approved Marketing Developer Platform partners, so users reconnect every 60 days. The app reminds them.

## 6b. Run on a server (VPS)

`docker-compose.server.yml` runs **Caddy** (automatic HTTPS), the **app** and **Postgres**. Only ports 80/443 are open; Postgres has no public port. Access is controlled by the app's `POSTPILOT_TOKEN` (the `#t=...` link). There is no password layer, so before exposing it to the public internet, add `basic_auth` to the `Caddyfile` or put it behind a private network such as Tailscale.

**One-time setup** (Linux with Docker installed; DOMAIN is the server's IP or a DNS name pointing at it; ports 80 and 443 open):

```sh
# copy this postpilot/ folder to /opt/postpilot (without .venv, .env, backups), then:
cd /opt/postpilot
cat > .env <<'EOF'
DOMAIN=postpilot.thedbadmin.com
POSTPILOT_TOKEN=<openssl rand -hex 32>
POSTGRES_PASSWORD=<openssl rand -hex 24>
EOF
chmod 600 .env
```

**Move the data from the Windows PC** (the source is the local Docker stack; the archive contains the LinkedIn token and API keys, so keep it off OneDrive/email and delete it afterwards):

```sh
# on the PC, in postpilot/ (works in PowerShell; files go via docker cp because `>` corrupts binary there)
docker compose exec -T db pg_dump -U postpilot -Fc -f /tmp/pp_db.dump postpilot
docker compose exec -T app tar czf /tmp/pp_data.tgz -C /data .
docker cp postpilot-db-1:/tmp/pp_db.dump $HOME/pp_db.dump
docker cp postpilot-app-1:/tmp/pp_data.tgz $HOME/pp_data.tgz
scp $HOME/pp_db.dump $HOME/pp_data.tgz you@vps:/opt/postpilot/   # then delete both local copies

# on the VPS: restore with publishing PAUSED
dc="docker compose -f docker-compose.server.yml"
$dc up -d db
$dc exec -T db pg_restore -U postpilot -d postpilot --clean --if-exists < pp_db.dump
$dc exec -T db psql -U postpilot -c "INSERT INTO settings VALUES ('agent_paused','true') ON CONFLICT (key) DO UPDATE SET value='true'"
$dc run --rm --no-deps -T app sh -c 'tar xzf - -C /data' < pp_data.tgz
$dc up -d --build
rm pp_db.dump pp_data.tgz
```

Open `https://<DOMAIN>/#t=<POSTPILOT_TOKEN>` once (the browser remembers the key), then check the posts, drafts, images, settings and LinkedIn status.

**Switch over (only one scheduler may run):** on the PC run `docker compose down` (keeps its data, which is your rollback). Then press **Resume** on the server's dashboard. Publish one test post you've approved and check it on LinkedIn.

**LinkedIn reconnect from the server:** in the LinkedIn developer app add `https://<DOMAIN>/callback` as an authorized redirect URL. In PostPilot → Settings → LinkedIn account → Advanced, set the Redirect URL to the same value. "Reconnect" then signs in within the same browser tab.

**Backups:** `chmod +x backup.sh`, then add the cron line from the top of `backup.sh`. It writes `backups/db_*.dump` + `backups/data_*.tgz` daily and keeps 14 days. Copy them off the VPS too.
Restore:

```sh
$dc stop app
$dc exec -T db pg_restore -U postpilot -d postpilot --clean --if-exists < backups/db_<ts>.dump
$dc run --rm --no-deps -T app sh -c 'tar xzf - -C /data' < backups/data_<ts>.tgz
$dc start app
```

**Alerts:** point a free uptime monitor (e.g. UptimeRobot) at `https://<DOMAIN>/health`. It returns 503 when the agent stops ticking, and needs no access key.

**Not covered here:** the browser extension still talks to `127.0.0.1` only; one shared login (not multi-user); secrets sit in `/data/secrets.json` (mode 600) inside the Docker volume, unencrypted.

## 7. Where data lives

| What | Where |
|---|---|
| Posts, log, settings | PostgreSQL (`DATABASE_URL`) |
| Images and videos | `%APPDATA%\PostPilot\media\` (Docker: `/data/media` in the `appdata` volume) |
| LinkedIn token, Client Secret, AI key, extension code | Windows Credential Manager → "PostPilot" |
| App log | `%APPDATA%\PostPilot\postpilot.log` |

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Window doesn't open | Look for the tray icon, since it may already be running. Check `postpilot.log`. |
| "Login state mismatch" or port 8080 is busy | Close whatever uses port 8080, or change the redirect URL in both the LinkedIn app and Settings. |
| Post failed with 401 | The session expired or was revoked. Go to Settings → Reconnect. |
| Post failed with 4xx | LinkedIn rejected the content (image format/size, text). Edit the post and use **Retry**. |
| AI says key rejected | Paste the key again in Settings → AI writing and use **Test**. |
| Extension says app offline | Start PostPilot. The extension only talks to the app on this computer. |

## 9. Not included yet

- @mentions of people or pages (needs their LinkedIn URN; there's no public name-search API).
- Company Page posting (needs `w_organization_social`, which requires LinkedIn Community Management API approval).
- Multi-account.
- Analytics. Post stats need the Community Management API, which is also approval-gated.
