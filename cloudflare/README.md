# Instagram webhook (free, one-time setup, ~10 minutes)

**Why:** Meta lets the app send a message *after* someone replies (the PDF, the follow check) only when the app
receives DMs by webhook. Without it Instagram refuses those messages with error 2534022
("sent outside the allowed window"). The first DM after a comment (Link automations) works without it.

PostPilot stays private and keeps polling. This tiny worker only tells Meta "received" and throws the event away.

## 1. Create the worker (Cloudflare, free)

1. Sign up / log in at https://dash.cloudflare.com
2. **Workers & Pages → Create → Create Worker** (start from "Hello World").
3. Name it `postpilot-ig-webhook` → **Deploy**.
4. **Edit code** → delete everything → paste the contents of [`instagram-webhook.js`](instagram-webhook.js) → **Deploy**.
5. Copy its address, e.g. `https://postpilot-ig-webhook.<your-name>.workers.dev`.
   Opening it in a browser shows "PostPilot webhook".

## 2. Connect it in the Meta app

1. https://developers.facebook.com → your app → **Instagram → API setup with Instagram login**.
2. Step **"Configure webhooks"**:
   - **Callback URL:** the worker address from step 1.5
   - **Verify token:** `postpilot`
   - **Verify and save**.
3. In the webhook fields list, **Subscribe** to `messages`.
4. Step **"Generate access tokens"**: on the @thedbadmin row switch **Webhook subscription** on
   (PostPilot also tries this by itself).

## 3. Check in PostPilot

Instagram tab → **Check now**. **Settings → Reply messages** should say **Ready**.
