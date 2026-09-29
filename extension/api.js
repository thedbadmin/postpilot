// Shared helpers: talk to the PostPilot desktop app on this computer (127.0.0.1 only).
async function getConn() {
  const { pp } = await chrome.storage.local.get("pp");
  return pp || null; // { port, token }
}

async function setConn(code) {
  const m = String(code || "").trim().match(/^(\d{2,5}):(pp_[\w-]+)$/);
  if (!m) throw new Error("That code doesn't look right. Copy it again from PostPilot → Settings → Browser extension.");
  const pp = { port: +m[1], token: m[2] };
  await ppFetch("GET", "/api/status", undefined, pp); // verify before saving
  await chrome.storage.local.set({ pp });
  return pp;
}

async function ppFetch(method, path, body, conn) {
  const c = conn || (await getConn());
  if (!c) throw new Error("NOT_PAIRED");
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${c.port}${path}`, {
      method,
      headers: { "X-PP-Token": c.token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error("APP_OFFLINE");
  }
  if (r.status === 401) throw new Error("BAD_CODE");
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `Error ${r.status}`);
  return data;
}

// Read title/description from the current tab (only when the user clicks, via activeTab).
async function readPage(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const meta = n => (document.querySelector(`meta[property="${n}"],meta[name="${n}"]`) || {}).content || "";
        return {
          title: meta("og:title") || document.title || "",
          desc: (meta("og:description") || meta("description")).slice(0, 300),
          selection: String(window.getSelection() || "").slice(0, 2500),
        };
      },
    });
    return res.result || {};
  } catch (e) {
    return {}; // chrome:// pages etc.
  }
}

async function savePage(tab, note) {
  const page = await readPage(tab.id);
  let link = { url: tab.url, title: page.title || tab.title || tab.url, desc: page.desc || "" };
  try { // let the app fetch the preview image so the card has a thumbnail
    const p = await ppFetch("POST", "/api/link-preview", { url: tab.url });
    link = { url: tab.url, title: link.title || p.title, desc: link.desc || p.desc, thumb: p.thumb };
  } catch (e) { /* keep what we have */ }
  return ppFetch("POST", "/api/posts", { text: note || "", link, source: "extension", topic: link.title });
}
