// Instagram webhook receiver for PostPilot (Cloudflare Worker, free plan).
//
// Meta only lets the app message someone after they reply when the app receives DMs by webhook.
// PostPilot itself stays private and keeps polling; this worker just answers Meta and discards
// what it receives (nothing is stored or forwarded). Setup: cloudflare/README.md.

const VERIFY_TOKEN = "postpilot"; // the same text goes in "Verify token" in the Meta app

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET") { // Meta checks the URL once when you save it
      const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
      return new Response(ok ? url.searchParams.get("hub.challenge") : "PostPilot webhook", { status: ok || !url.search ? 200 : 403 });
    }
    return new Response("ok"); // a DM event: acknowledged and dropped
  },
};
