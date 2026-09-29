const app = document.getElementById("app");
const stateEl = document.getElementById("state");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function msg(text, kind) {
  let el = document.getElementById("msg");
  if (!el) { el = document.createElement("div"); el.id = "msg"; app.append(el); }
  el.className = `msg ${kind || ""}`; el.textContent = text;
}

function pairView(error) {
  stateEl.innerHTML = `<i class="dot"></i>Not connected`;
  app.innerHTML = `
    <p class="muted">Connect this browser to the PostPilot app on your computer.</p>
    <ol><li>Open PostPilot → Settings → Browser extension</li><li>Click “Create connection code” and copy it</li><li>Paste it here</li></ol>
    <label for="code">Connection code</label><input id="code" placeholder="47821:pp_…" autocomplete="off">
    <button class="primary" id="pair">Connect</button>`;
  if (error) msg(error, "err");
  document.getElementById("pair").onclick = async () => {
    try { await setConn(document.getElementById("code").value); render(); }
    catch (e) { msg(e.message === "APP_OFFLINE" ? "PostPilot isn't running. Start the app and try again." : e.message === "BAD_CODE" ? "That code was rejected. Create a new one in the app." : e.message, "err"); }
  };
}

function offlineView() {
  stateEl.innerHTML = `<i class="dot err"></i>App offline`;
  app.innerHTML = `<p class="muted"><b>PostPilot isn't running on this computer.</b><br>Start it from the Start menu or tray. Scheduled posts only go out while the app is running.</p>
    <button id="retry">Try again</button><button id="unpair">Use a different code</button>`;
  document.getElementById("retry").onclick = render;
  document.getElementById("unpair").onclick = async () => { await chrome.storage.local.remove("pp"); render(); };
}

async function render() {
  let st;
  try { st = await ppFetch("GET", "/api/status"); }
  catch (e) {
    if (e.message === "NOT_PAIRED") return pairView();
    if (e.message === "BAD_CODE") { await chrome.storage.local.remove("pp"); return pairView("This browser was disconnected. Create a new code in the app."); }
    return offlineView();
  }
  const c = st.counts, bad = c.failed + c.missed;
  const paused = st.settings.agent_paused;
  const dot = !st.agent.healthy ? "err" : paused || !st.account.connected ? "warn" : "ok";
  stateEl.innerHTML = `<i class="dot ${dot}"></i>${!st.agent.healthy ? "Agent stopped" : paused ? "Paused" : !st.account.connected ? "LinkedIn not connected" : "Agent running"}`;
  const n = st.next;
  const when = n ? new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: st.settings.timezone }).format(new Date(n.scheduled_at)) : "";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const canShare = tab && /^https?:/.test(tab.url || "");
  app.innerHTML = `
    <div class="stats"><div><b>${c.scheduled}</b><span>Scheduled</span></div><div><b>${c.draft}</b><span>Drafts</span></div><div class="${bad ? "bad" : ""}"><b>${bad}</b><span>Need attention</span></div></div>
    ${n ? `<div class="next"><small>Up next · ${esc(when)}</small><p>${esc(n.text)}</p></div>` : `<p class="muted">Nothing scheduled yet.</p>`}
    <label for="note">Quick draft</label>
    <textarea id="note" placeholder="Jot an idea or write your post…"></textarea>
    <div class="row"><button id="saveNote">Save as draft</button>${canShare ? `<button class="primary" id="share">Share this page</button>` : ""}</div>
    <button id="open">Open PostPilot</button>`;
  document.getElementById("saveNote").onclick = async e => {
    const text = document.getElementById("note").value.trim();
    if (!text) return msg("Write something first.", "err");
    e.target.disabled = true;
    try { await ppFetch("POST", "/api/posts", { text, source: "extension" }); document.getElementById("note").value = ""; msg("Saved to Drafts in PostPilot.", "ok"); }
    catch (err) { msg(err.message, "err"); }
    e.target.disabled = false;
  };
  const share = document.getElementById("share");
  if (share) share.onclick = async () => {
    share.disabled = true; share.textContent = "Saving…";
    try { await savePage(tab, document.getElementById("note").value.trim()); document.getElementById("note").value = ""; msg("Page saved as a draft with a link card. Review and schedule it in PostPilot.", "ok"); }
    catch (err) { msg(err.message, "err"); }
    share.disabled = false; share.textContent = "Share this page";
  };
  document.getElementById("open").onclick = async () => { try { await ppFetch("POST", "/api/show"); window.close(); } catch (e) { msg("Couldn't open the app window.", "err"); } };
}

render();
