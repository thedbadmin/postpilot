/* PostPilot UI core: API client, icons, helpers, shell, router. */
const S = { token: null, status: null, settings: null, route: "", timer: null, dirty: false };

// ---------- auth token (passed by the desktop shell in the URL fragment) ----------
(function () {
  const m = location.hash.match(/t=([\w-]+)(?:&r=([\w/]+))?/);  // &r= opens a given screen, e.g. the Instagram tab
  // localStorage so a server install stays signed in across tabs; the desktop window re-sends it each launch
  if (m) { localStorage.setItem("pp_token", m[1]); history.replaceState(null, "", `#/${m[2] || "dashboard"}`); }
  S.token = localStorage.getItem("pp_token");
})();

async function api(method, path, body, isForm) {
  const opt = { method, headers: { "X-PP-Token": S.token || "" } };
  if (body !== undefined) {
    if (isForm) opt.body = body;
    else { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  }
  let r;
  try { r = await fetch(path, opt); }
  catch (e) { throw new Error(t("The PostPilot agent is not responding. Is the app still running?")); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = data.detail;
    throw new Error(typeof d === "string" ? t(d) : Array.isArray(d) ? d.map(x => x.msg).join("; ") : `Error ${r.status}`);
  }
  return data;
}
const mediaUrl = id => `/media/${id}?t=${encodeURIComponent(S.token || "")}`;

// ---------- icons (simple line icons, 24px grid) ----------
const IC = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  cal: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  spark: '<path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  ext: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M6 4l14 8-14 8Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  puzzle: '<path d="M14 4a2 2 0 1 0-4 0v2H6v4h2a2 2 0 1 1 0 4H6v4h4v-2a2 2 0 1 1 4 0v2h4v-4h-2a2 2 0 1 1 0-4h2V6h-4Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  wand: '<path d="m15 4 5 5L9 20l-5-5Z"/><path d="M15 4l1-2M20 9l2-1M18 3l1.5-1.5"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
};
const icon = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ""}</svg>`;

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tz = () => (S.settings && S.settings.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone;
const locale = () => (S.settings && S.settings.language === "hi") ? "en-IN" : "en-US";

function fmt(iso, opts) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale(), { timeZone: tz(), ...opts }).format(new Date(iso));
}
const fmtDay = iso => fmt(iso, { weekday: "short", day: "numeric", month: "short" });
const fmtTime = iso => fmt(iso, { hour: "numeric", minute: "2-digit" });
const fmtFull = iso => fmt(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function rel(iso) {
  if (!iso) return "";
  const s = Math.round((new Date(iso) - Date.now()) / 1000), a = Math.abs(s);
  if (a < 5) return t("just now");  // also absorbs small clock differences between server and browser
  const u =a < 60 ? [a, "s"] : a < 3600 ? [Math.round(a / 60), "m"] : a < 86400 ? [Math.round(a / 3600), "h"] : [Math.round(a / 86400), "d"];
  const v = `${u[0]}${u[1]}`;
  return s >= 0 ? t("in {v}", { v }) : t("{v} ago", { v });
}
function countdown(iso) {
  let s = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  return (d ? `${d}d ` : "") + `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function tzOffsetMs(ts, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ts)).filter(x => x.type !== "literal").map(x => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}
function zonedToUtc(local, zone = tz()) {           // "2026-10-01T10:00" in zone -> ISO UTC
  const [d, tm] = local.split("T"); const [Y, M, D] = d.split("-").map(Number); const [h, m] = tm.split(":").map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m);
  let ts = guess - tzOffsetMs(guess, zone);
  const off2 = tzOffsetMs(ts, zone); ts = guess - off2;
  return new Date(ts).toISOString();
}
function utcToLocalInput(iso, zone = tz()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(iso)).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}
function localParts(iso, zone = tz()) {  // {y,m,d,wd} in zone
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
    .formatToParts(new Date(iso)).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, key: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` };
}
const snippet = (s, n = 80) => { const x = String(s || "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n) + "…" : x; };
const STATUS_LABEL = { draft: "Draft", scheduled: "Scheduled", publishing: "Publishing", published: "Published", failed: "Failed", missed: "Missed" };
const badge = st => `<span class="badge ${st}">${esc(t(STATUS_LABEL[st] || st))}</span>`;
function initials(name) { return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(""); }

function toast(msg, kind = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "err" ? "alert" : "check")}<span>${esc(msg)}</span>`;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), kind === "err" ? 6000 : 3200);
}
async function run(btn, fn, okMsg) {             // button busy state + error toast
  const old = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>${btn.dataset.busy ? esc(t(btn.dataset.busy)) : ""}`; }
  try { const r = await fn(); if (okMsg) toast(t(okMsg)); return r; }
  catch (e) { toast(e.message, "err"); throw e; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}

function modal({ title, body, foot, wide, onClose }) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
    ${title ? `<div class="modal-head"><h3>${title}</h3><button class="btn ghost icon" data-close style="margin-left:auto" aria-label="Close">${icon("x")}</button></div>` : ""}
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div>`;
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === "Escape") close(); };
  back.addEventListener("click", e => { if (e.target === back || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(back);
  return { el: back, close };
}
function confirmBox(message, okLabel = "Confirm", danger = false) {
  return new Promise(res => {
    const m = modal({
      title: esc(t("Are you sure?")), body: `<p style="margin:0">${esc(message)}</p>`,
      foot: `<button class="btn" data-close>${esc(t("Cancel"))}</button><button class="btn primary" id="cfOk" ${danger ? 'style="background:var(--err);border-color:var(--err)"' : ""}>${esc(t(okLabel))}</button>`,
      onClose: () => res(false),
    });
    $("#cfOk", m.el).onclick = () => { res(true); m.el.remove(); };
  });
}

// ---------- shell ----------
const NAV = [
  ["dashboard", "home", "Dashboard"], ["compose", "edit", "Compose"], ["queue", "list", "Queue"],
  ["calendar", "cal", "Calendar"], ["batch", "spark", "AI Batch"], ["activity", "pulse", "Activity"], ["settings", "gear", "Settings"],
];
const igMode = () => location.hash.startsWith("#/insta");  // the Instagram agent runs in its own tab (views-insta.js)
function renderNav() {
  if (igMode()) return renderIgNav();
  const c = S.status ? S.status.counts : {};
  const attention = (c.failed || 0) + (c.missed || 0);
  $("#nav").innerHTML = NAV.map(([r, ic, label]) => {
    let count = "";
    if (r === "queue") count = attention ? `<span class="count alert">${attention}</span>` : c.scheduled ? `<span class="count">${c.scheduled}</span>` : "";
    return `<a href="#/${r}" class="${S.route === r ? "active" : ""}">${icon(ic)}<span>${esc(t(label))}</span>${count}</a>`;
  }).join("") + `<a href="${S.token ? `/#t=${S.token}&r=insta` : "/#/insta"}" target="_blank" rel="noopener" class="nav-ext">${icon("insta")}<span>${esc(t("Instagram agent"))}</span>${icon("ext")}</a>`;
}
function agentInfo() {
  const st = S.status;
  if (!st) return { cls: "", title: "…", sub: "" };
  const a = st.agent, paused = st.settings.agent_paused;
  if (!a.healthy) return { cls: "err", title: t("Agent not responding"), sub: t("Restart PostPilot"), state: "down" };
  if (paused) return { cls: "warn", title: t("Agent paused"), sub: t("Posts will wait"), state: "paused" };
  if (!st.account.connected) return { cls: "warn", title: t("Agent running"), sub: t("LinkedIn not connected"), state: "noacct" };
  return { cls: "ok", title: t("Agent running"), sub: t("Checked {v}", { v: rel(a.last_tick) }), state: "ok" };
}
function renderSidebar() {
  renderNav();
  if (igMode()) return renderIgSidebar();
  document.title = "PostPilot";
  const a = agentInfo();
  $("#agentPill").innerHTML = `<i class="dot ${a.cls}"></i><div><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></div>`;
  const acc = S.status ? S.status.account : {};
  $("#me").innerHTML = acc.connected
    ? `<div class="li-av" style="width:32px;height:32px;font-size:13px">${acc.picture ? `<img src="${esc(acc.picture)}" alt="">` : esc(initials(acc.name))}</div><div class="who"><b>${esc(acc.name)}</b><small>${esc(t("LinkedIn connected"))}</small></div>`
    : `<a class="btn sm" href="#/settings" style="width:100%">${icon("link")}${esc(t("Connect LinkedIn"))}</a>`;
  $$("#lang button").forEach(b => b.classList.toggle("on", b.dataset.l === lang()));
}
function applyTheme() {
  const th = S.settings && S.settings.theme;
  if (th === "light" || th === "dark") document.documentElement.dataset.theme = th;
  else delete document.documentElement.dataset.theme;
}

async function refreshStatus() {
  try {
    S.status = await api("GET", "/api/status");
    S.settings = S.status.settings;
    if (igMode()) S.ig = await api("GET", "/api/insta/status").catch(() => S.ig);
    renderSidebar();
    if (VIEWS[S.route] && VIEWS[S.route].tick) VIEWS[S.route].tick();
  } catch (e) {
    S.status = S.status ? { ...S.status, agent: { ...S.status.agent, healthy: false } } : null;
    if (S.status) renderSidebar();
  }
}

const VIEWS = {};
async function route() {
  if (S.dirty && !(await confirmBox(t("You have unsaved changes in the editor. Leave anyway?"), "Leave"))) {
    history.replaceState(null, "", `#/${S.route}`); return;
  }
  S.dirty = false;
  const [r, arg] = (location.hash.replace(/^#\/?/, "") || "dashboard").split("/");
  S.route = VIEWS[r] ? r : "dashboard";
  if (S.status) renderSidebar(); else renderNav();
  const main = $("#main");
  main.scrollTop = 0;
  try { await VIEWS[S.route].render(main, arg); }
  catch (e) { main.innerHTML = `<div class="page"><div class="banner err">${icon("alert")}<div class="grow">${esc(e.message)}</div></div></div>`; }
}

async function boot() {
  $("#brandMark").innerHTML = '<img src="/static/icon.png" alt="">';
  $("#lang").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    await api("PUT", "/api/settings", { values: { language: b.dataset.l } });
    S.settings.language = b.dataset.l; await refreshStatus(); route();
  });
  if (!S.token && !(await fetch("/api/status").then(r => r.ok, () => false))) { // no key needed on a no-auth server
    $("#main").innerHTML = `<div class="page"><div class="banner err">${icon("alert")}<div class="grow"><b>Open PostPilot from its desktop window or tray icon.</b>This page needs the app's session key.</div></div></div>`;
    return;
  }
  await refreshStatus();
  applyTheme();
  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
  await route();
  if (S.settings && !S.settings.onboarded && !igMode()) openOnboarding();
  S.timer = setInterval(refreshStatus, 5000);
  setInterval(() => { if (VIEWS[S.route] && VIEWS[S.route].second) VIEWS[S.route].second(); }, 1000);
}
