# PostPilot: full project context

> Paste this whole file into a chat with an AI assistant so it understands the project before you ask questions.
> Accurate as of commit `9a89dce` (October 2026). Repo: https://github.com/thedbadmin/postpilot

## 1. What the product is

PostPilot schedules LinkedIn posts, with an AI writing assistant built in. The owner (Abhishek, "TheDBAdmin", a database/PostgreSQL content creator) writes posts, or has AI draft them, previews exactly how they will look in the LinkedIn feed, and queues them into weekly posting slots. A background agent publishes them on time through **LinkedIn's official REST API**.

Hard product principles:
- **Official API only.** It never likes, comments, messages, scrapes, or automates clicks on linkedin.com.
- **Nothing is published without an explicit user action.** Scheduling and "Post now" are always clicks.
- **Anti-spam limits are built in** and enforced by the backend, not only the UI (see §6).
- **Single user, single LinkedIn account.** There is no multi-tenant design.

It started as a **Windows desktop app** (native window and tray icon). It now **mainly runs as a Docker stack on a home server/VPS**, used from a browser on the LAN (`https://<server-ip>` or `https://postpilot.thedbadmin.com`). Both modes share the same codebase.

## 2. Tech stack at a glance

| Area | Technology |
|---|---|
| Backend language | **Python 3.12** (3.11–3.13 supported) |
| Web framework | **FastAPI** + **Uvicorn** (ASGI), **Pydantic** v2 models |
| Database | **PostgreSQL 16** via **psycopg2** (raw SQL, no ORM) |
| Background jobs | One Python `threading.Thread` scheduler loop (no Celery/Redis) |
| HTTP client | `requests` |
| Frontend | **Vanilla JavaScript + HTML + CSS**: no framework, no bundler, no build step, no npm |
| Desktop shell (Windows mode) | **pywebview** (Microsoft Edge WebView2) + **pystray** (tray icon) |
| Secrets | **keyring** (Windows Credential Manager) → falls back to `/data/secrets.json` (mode 600) in Docker |
| Images | **Pillow** (resize/convert for the vision AI) |
| Video | **imageio-ffmpeg** (bundled ffmpeg binary: frame grabs + audio extraction) |
| AI (text) | **Groq** (default, free tier, model `openai/gpt-oss-120b`), or OpenAI, Anthropic, or any OpenAI-compatible endpoint |
| AI (image/video) | Groq vision model (`qwen/qwen3.8-27b`) + Groq **Whisper** (`whisper-large-v3-turbo`) speech-to-text |
| Social API | LinkedIn REST API (`Linkedin-Version: 202608`): Posts, Images, Videos APIs; OAuth 2.0 + OpenID Connect |
| Containers | **Docker** + **Docker Compose** |
| Reverse proxy / HTTPS | **Caddy 2** (automatic TLS) |
| Browser extension | Chrome/Edge **Manifest V3** (plain JS service worker + popup) |
| Windows packaging | **PyInstaller** (`build_windows.bat`) + **Inno Setup** (`installer.iss`) → per-user installer, no admin |
| Shell scripts | POSIX `sh` (`deploy.sh`, `backup.sh`) |
| Tests | Plain Python assert scripts (`test_*.py`), no pytest; network and DB are stubbed |
| UI languages | English + Hinglish (custom i18n dictionary in `web/i18n.js`) |

**Languages used:** Python (~2,200 lines), JavaScript (~1,500 lines), HTML/CSS, SQL (inline in Python), YAML (Compose), Caddyfile, POSIX shell, Windows batch, Inno Setup script. The whole codebase is about 4,000 lines and is deliberately small and dependency-light.

## 3. Repository layout

```
postpilot/
├── run.py                    # launcher: python run.py | --background | --headless
├── docker_entry.py           # Docker entrypoint: wraps run.py --headless, binds 0.0.0.0, fixed token from env
├── postpilot/                # backend package
│   ├── config.py             # paths (data dir), port 47821, MOCK flag, .env loader
│   ├── store.py              # PostgreSQL access, schema, settings, secrets, activity log
│   ├── server.py             # FastAPI app: REST API + serves the web UI
│   ├── scheduler.py          # background publish loop, retries, posting limits, slot finder
│   ├── linkedin.py           # OAuth login (3 modes) + publishing (text/image/carousel/link/video)
│   ├── ai.py                 # text drafting/rewriting (Groq/OpenAI/Anthropic)
│   ├── vision.py             # "Write from image/video" (Groq vision + Whisper)
│   ├── linkpreview.py        # fetches Open Graph title/desc/image for link cards
│   ├── desktop.py            # pywebview window + pystray tray icon (Windows mode only)
│   └── autostart.py          # "Start with Windows" via HKCU Run registry key
├── web/                      # the whole UI (served as static files)
│   ├── index.html            # shell: sidebar + <main>, loads the scripts below in order
│   ├── core.js               # API client, auth token, icons, date/timezone helpers, router, toasts, modals
│   ├── i18n.js               # English → Hinglish translations, t() helper
│   ├── preview.js            # pixel-faithful LinkedIn feed preview (desktop/mobile, light/dark, "…more" cut)
│   ├── views-main.js         # Dashboard, Queue, Calendar, Activity views
│   ├── views-compose.js      # Compose editor, AI draft/rewrite, media upload, AI Batch
│   ├── views-settings.js     # Settings + onboarding wizard
│   └── styles.css
├── extension/                # Chrome/Edge MV3 companion (api.js, background.js, popup.*)
├── auth_broker/              # optional hosted OAuth "login server" for a public release
├── Dockerfile                # python:3.12-slim app image
├── docker-compose.yml        # local/dev stack: db + app (127.0.0.1 only)
├── docker-compose.server.yml # server stack: db + app + caddy (ports 80/443)
├── Caddyfile                 # HTTPS reverse proxy to app:47821
├── deploy.sh                 # server: backup → git pull → rebuild → wait for /health
├── backup.sh                 # pg_dump + tar of /data, keeps 14 days (cron)
├── build_windows.bat, installer.iss, start_postpilot.bat   # Windows desktop build/run
├── requirements.txt          # desktop deps (server image installs its own subset)
├── test_*.py                 # standalone test scripts
└── README.md, PRIVACY_POLICY_DRAFT.md
```

## 4. Architecture

```
 Browser (LAN / internet)                    Chrome/Edge extension
        │  HTTPS                                    │ http://127.0.0.1 only (desktop mode)
        ▼                                           ▼
   ┌─────────┐   reverse_proxy   ┌──────────────────────────────────────┐
   │  Caddy  │ ────────────────▶ │  app container (Python, port 47821)  │
   └─────────┘                   │  ┌─────────────┐  ┌───────────────┐  │
                                 │  │ FastAPI API │  │ Scheduler     │  │──▶ LinkedIn REST API
                                 │  │ + static UI │  │ thread (15 s) │  │──▶ Groq / OpenAI / Anthropic
                                 │  └──────┬──────┘  └──────┬────────┘  │
                                 │         └──── store.py ──┘           │
                                 │   /data volume: media/, secrets.json, log
                                 └──────────────┬───────────────────────┘
                                                ▼
                                       PostgreSQL 16 (db container, no public port)
```

- **One process** runs both the API (Uvicorn in a thread) and the scheduler (another thread). They share state through PostgreSQL and a small in-memory `scheduler.state` dict.
- **Only one scheduler may run per LinkedIn account.** Two instances would race and could double-post.
- **Desktop mode:** `run.py` starts the same API on `127.0.0.1` with a random per-launch token, then opens it in a pywebview window. Closing the window hides it to the tray, and the agent keeps running.
- **Server mode:** `docker_entry.py` monkey-patches the Uvicorn host to `0.0.0.0` and sets the token from `POSTPILOT_TOKEN`, then calls `run.py --headless`.

## 5. Data model (PostgreSQL)

Schema is created on first connect (`store.SCHEMA`, `CREATE TABLE IF NOT EXISTS`). There is no migration tool.

| Table | Key columns |
|---|---|
| `posts` | `id SERIAL`, `text`, `status` (`draft│scheduled│publishing│published│failed│missed`), `scheduled_at`, `next_attempt_at`, `attempts`, `source` (`manual│ai│batch│extension`), `topic`, `media` (JSON list of media ids), `alt`, `link` (JSON `{url,title,desc,thumb}`), `linkedin_urn`, `error`, `created_at`, `updated_at`, `published_at` |
| `media` | `id` (uuid hex), `filename`, `path` (file on disk under `/data/media`), `mime`, `size`, `created_at` |
| `activity` | `id`, `ts`, `level` (`info│success│warn│error`), `post_id`, `message`: the user-visible log |
| `settings` | `key`, `value` (JSON-encoded): timezone, slots, limits, AI provider/model, brand voice, language, theme, `agent_paused`, … |

Quirks to know:
- **Timestamps are stored as ISO-8601 UTC text**, not `timestamptz`. The DB is initialised with `--locale=C` so text ordering equals time ordering.
- SQL is written with SQLite-style `?` placeholders; `store._run()` rewrites them to `%s` (and `IS NOT ?` to `IS DISTINCT FROM ?`). The app used SQLite before moving to Postgres.
- Media binaries live on disk (Docker volume), not in the DB. Secrets (LinkedIn token, client secret, AI keys, extension token) are not in the DB either.

## 6. Core flows

### Post lifecycle
`draft` → (user schedules) → `scheduled` → (scheduler picks it up when due) → `publishing` → `published`
- Transient error (network before send, HTTP 429, 5xx): back to `scheduled` with backoff of 2, 10 and 30 min, then `failed` after 4 attempts.
- Permanent error (4xx), token expired/revoked (401), or a missing media file: `failed`, with the reason shown and a **Retry** button.
- Overdue by more than the **grace window** (default 6 h, e.g. the PC was off): `missed`. It is never auto-posted late.
- A crash while `publishing` becomes `failed`, with a "check LinkedIn before retrying" message.

### Scheduler loop (`scheduler.py`)
Every 15 s (or immediately when woken by an API call): unless paused, process due posts → check LinkedIn token expiry (warn under 7 days) → update `last_tick`. `/health` returns 503 if there has been no tick for 90 s (except while a long video upload is running).

### Posting limits (anti-spam, enforced server-side)
- Per day: default 2, **hard cap 5**. Minimum gap: default 3 h, **hard minimum 1 h**. Queue size: default 30, **hard cap 60**.
- Hard caps are constants (`HARD_MAX_PER_DAY`, `HARD_MIN_GAP_MIN`, `HARD_MAX_QUEUE`) so a build can't be configured into a spam tool.
- `next_slot()` walks the weekly slot pattern (e.g. Mon/Wed/Fri 10:00 in the user's timezone, default `Asia/Kolkata`) and skips slots that would break a limit. At publish time, if the daily limit is already hit, the post is moved to the next free slot.

### Duplicate-post guard (`linkedin.publish`)
Only a **connect** failure is retried. If the request was sent and the response was lost (read timeout or connection reset), the post is marked `failed` with "may already be live, check your profile". This avoids double-posting. It is covered by `test_publish_safety.py`.

### Publishing to LinkedIn
- `POST /rest/posts` with `author = urn:li:person:<id>`, `commentary` (escaped for LinkedIn "little text": reserved chars are escaped, `#word` is kept as a hashtag), `visibility PUBLIC`.
- **Images:** `/rest/images?action=initializeUpload` → PUT the bytes → image URN. 1 image = `media`, 2–20 = `multiImage` (carousel). JPG/PNG/GIF up to 10 MB.
- **Video:** `/rest/videos?action=initializeUpload` → PUT each byte range → `finalizeUpload` with ETags → poll until `AVAILABLE` (up to 15 min). One MP4 per post, 75 KB–500 MB, streamed to disk on upload.
- **Link card:** `article` content with title, description and an optional uploaded thumbnail (LinkedIn's API doesn't scrape URLs, so `linkpreview.py` fetches Open Graph tags).
- Text is limited to 3,000 characters. A post has either images/video or a link card, not both.

### LinkedIn login (OAuth 2.0, scopes `openid profile w_member_social`)
1. **Direct, desktop:** a one-shot local HTTP server on the `http://localhost:8080/callback` redirect + the system browser.
2. **Direct, server:** the redirect goes to the app's own `https://<domain>/callback`; the login thread waits for it.
3. **Broker:** `auth_broker/broker.py` holds the Client Secret on a hosted server and does a PKCE-style state/verifier handshake, so public desktop builds never ship the secret.

Tokens last 60 days. Refresh tokens need LinkedIn Marketing Developer Platform approval, so the user reconnects every 60 days and gets warnings starting 7 days before expiry.

### AI writing (`ai.py`, `vision.py`)
- A system prompt holds the user's brand voice, post length, today's date, and rules (hook first line, short paragraphs, ≤3 hashtags, no markdown, no invented facts).
- Actions: **draft** from a topic, **rewrite** (improve, shorten, stronger hook, hashtags, fix grammar, professional, casual, custom), and **AI Batch** (up to 30 topics → drafts, run in a background thread and polled through `/api/jobs/{id}`).
- **Write from image:** up to 3 images, resized to 1600 px JPEG → Groq vision model.
- **Write from video:** 2 still frames (at 1/3 and 2/3 of the video) + a Whisper transcript (first 4,000 chars) → one vision request. A separate Groq key and strict anti-hallucination rules apply; the transcript is treated as data, not instructions.
- Retries with exponential backoff on 429/5xx. Output is cleaned (strips `<think>`, code fences, quotes, `**bold**`).

## 7. HTTP API (FastAPI, all under token auth unless noted)

Auth uses the `X-PP-Token` header or `?t=` query. Valid tokens are the app token (`POSTPILOT_TOKEN`) or the paired browser-extension token. `POSTPILOT_NO_AUTH=1` disables auth on a trusted LAN. The web UI receives the token once through the URL fragment `#t=…` and keeps it in `localStorage`.

| Method & path | Purpose |
|---|---|
| `GET /` , `/static/*` | Web UI (no auth) |
| `GET /health` | Liveness for Docker/uptime monitors (no auth, no data) |
| `GET /callback` | OAuth redirect target (server mode) |
| `GET /api/status` | Agent state, account, counts, next post, next slot, usage, settings |
| `GET/POST /api/posts`, `GET/PUT/DELETE /api/posts/{id}` | CRUD |
| `POST /api/posts/{id}/schedule` | `when`: ISO datetime, `"next_slot"` or `"now"` (limit-checked) |
| `POST /api/posts/bulk-schedule` | Put many drafts into the next free slots |
| `POST /api/posts/{id}/unschedule`, `/duplicate` | |
| `POST /api/media` | Upload image or MP4 (multipart) |
| `GET /media/{id}` | Serve an uploaded file |
| `POST /api/link-preview` | Fetch Open Graph data for a URL |
| `POST /api/ai/draft`, `/api/ai/rewrite`, `/api/ai/draft-from-image`, `/api/ai/batch`; `GET /api/jobs/{id}` | AI |
| `POST /api/account/login`, `/api/account/logout` | LinkedIn connect/disconnect |
| `GET/PUT /api/settings` | Settings + secrets (validated: times, timezone, limit ranges) |
| `POST /api/extension/pair` | Create the extension pairing token |
| `GET /api/activity` | Activity log |

## 8. Frontend

- A single-page app built from plain `<script>` tags (no modules, no build). The global state object is `S`, and `api()` wraps `fetch`.
- A **hash router** (`#/dashboard`, `#/compose`, `#/queue`, `#/calendar`, `#/batch`, `#/activity`, `#/settings`) where each view registers `VIEWS[name] = {render, tick?, second?}`. The status is refreshed periodically, and countdowns tick every second.
- The UI renders with template strings + `innerHTML` (escaped with an `esc()` helper) and uses inline SVG line icons.
- **Live LinkedIn preview** (`preview.js`) mimics the feed card, including the "…more" truncation, desktop/mobile widths, and light/dark themes.
- Timezone-aware date handling is done by hand (`zonedToUtc`, `utcToLocalInput`) against the user's configured IANA zone.
- Languages: English and Hinglish via `t()` in `i18n.js`.

## 9. Browser extension (MV3)

Its permissions are `storage`, `activeTab`, `scripting`, `contextMenus` and `alarms`; its host permission is `http://127.0.0.1/*`. It is paired by pasting a `port:pp_token` code from Settings. It can save the current page as a link-card draft, save selected text as a draft, and show a toolbar badge (scheduled count, or "!" when posts need attention). **It never posts**, by design. It only works with the desktop install, not the remote server.

## 10. Deployment & operations

| Environment | How it runs |
|---|---|
| **Production (home server / VPS)** | `docker-compose.server.yml`: `caddy` (80/443, auto-HTTPS) → `app` → `db` (Postgres, no public port). Volumes: `pgdata`, `appdata` (`/data`), `caddy_data`, `caddy_config`. Log rotation 10 MB × 3. |
| **Dev/test PC** | `docker-compose.yml` + a gitignored `docker-compose.override.yml` with `POSTPILOT_MOCK=1` (fake LinkedIn + AI) and a local `.env` (`POSTPILOT_TOKEN`, `POSTGRES_PASSWORD`). UI at `http://127.0.0.1:47821/#t=<token>`. |
| **Windows desktop** | `start_postpilot.bat` (venv + `run.py`) or `PostPilot.exe` from PyInstaller + the Inno Setup installer. Autostart through the HKCU Run key. |

- **Deploy:** on the server run `./deploy.sh`, which backs up first, then `git pull --ff-only`, `docker compose up -d --build`, and polls `/health` (it prints a rollback command on failure).
- **Backups:** `backup.sh` via daily cron writes `pg_dump -Fc` + a tar of `/data` (excluding `*.mp4`), keeps 14 days, and uses `umask 077`.
- **Monitoring:** an external uptime monitor on `/health`.
- **Env vars:** `DATABASE_URL`, `POSTPILOT_TOKEN`, `POSTPILOT_NO_AUTH`, `POSTPILOT_MOCK`, `POSTPILOT_HOME`, `POSTPILOT_PORT`, `POSTPILOT_NO_KEYRING`, `POSTGRES_PASSWORD`, `DOMAIN`, `LINKEDIN_CLIENT_ID/SECRET/REDIRECT_URI`, `POSTPILOT_BROKER_URL`, `LLM_PROVIDER`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
- **Workflow:** change code on the dev PC → test on the mock stack + run `test_*.py` (with `POSTPILOT_MOCK=0`) → push to GitHub `main` → run `deploy.sh` on the server.

## 11. Known limitations / open areas (good research topics)

- **Not supported:** @mentions (no public name→URN search), Company Page posting (needs Community Management API approval), analytics (same approval), multi-account / multi-user, and LinkedIn refresh tokens (MDP partners only).
- **Security:** server access relies on a single static token in the URL fragment + `localStorage`; there is no password/SSO layer (README suggests Caddy `basic_auth` or Tailscale). Secrets on the server sit unencrypted in `/data/secrets.json` (mode 600).
- **Scalability:** a single process with in-memory job state (`jobs` dict, `login_state`) that is lost on restart, one global DB connection guarded by a lock, and no task queue.
- **Schema:** no migrations; timestamps are stored as text rather than `timestamptz`.
- **Tests:** a few assert scripts only. There are no API/integration tests, no frontend tests, and no CI.
- **Video drafting** uses only the first ~4,000 transcript characters; long videos aren't summarised in chunks.
- **Backups** skip videos and stay on the same server unless copied off.
- **Branding:** "PostPilot" is a working name; LinkedIn brand rules forbid "LinkedIn" in third-party product names.
