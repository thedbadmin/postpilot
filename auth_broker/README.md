# PostPilot login server

Keeps the LinkedIn **Client Secret** off users' computers. Needed only when you distribute PostPilot to other people.

## Deploy (any host that runs Docker or Python: Render, Railway, Fly.io, a VPS)

1. Set environment variables:
   - `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`, from your LinkedIn developer app
   - `PUBLIC_URL`, the HTTPS address of this server, e.g. `https://login.yourdomain.com`
2. In the LinkedIn developer portal → your app → **Auth** → add `https://login.yourdomain.com/callback` as an authorized redirect URL.
3. Start it with `docker build -t pp-login . && docker run -p 8000:8000 --env-file .env pp-login`
   (or `pip install -r requirements.txt && uvicorn broker:app --host 0.0.0.0 --port 8000`).
4. Open `https://login.yourdomain.com/health` and check that it shows `"configured": true`.
5. In PostPilot → Settings → LinkedIn account → Advanced, choose **PostPilot login server** and paste the URL.
   To ship this as the default, put `POSTPILOT_BROKER_URL=https://login.yourdomain.com` in the `.env` file bundled with the app.

## How it works

The app generates `state` and a secret `verifier`, then opens `/start?state=…&challenge=sha256(verifier)`.
LinkedIn redirects back to `/callback`, and this server exchanges the code for a token.
The app polls `/claim` with the verifier and receives the token exactly once.
Pending logins live in memory for 10 minutes. Run a single instance, or swap the dict for Redis if you scale out.
