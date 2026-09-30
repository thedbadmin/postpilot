/* Settings + first-run onboarding. */
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MODEL_HINTS = { groq: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"], openai: ["gpt-5-mini", "gpt-5"], anthropic: ["claude-sonnet-5", "claude-haiku-5"] };

async function saveSettings(values, secrets, quiet) {
  const s = await api("PUT", "/api/settings", { values: values || {}, secrets: secrets || {} });
  S.settings = s; if (S.status) S.status.settings = s;
  if (!quiet) toast(t("Saved"));
  refreshStatus();
  return s;
}

async function startLogin(btn, onDone) {
  await run(btn, () => api("POST", "/api/account/login"));
  toast(t("Complete the sign-in in your browser…"));
  const started = Date.now();
  const poll = async () => {
    const st = await api("GET", "/api/status");
    S.status = st;
    if (st.login.status === "waiting" && st.login.url) { location.href = st.login.url; return; } // server install: sign in in this tab
    if (st.login.status === "done") { toast(t("LinkedIn connected")); await refreshStatus(); onDone && onDone(); return; }
    if (st.login.status === "error") { toast(t(st.login.error || "Login failed"), "err"); onDone && onDone(); return; }
    if (Date.now() - started < 310e3) setTimeout(poll, 1500);
  };
  poll();
}

function accountBox() {
  const a = S.status.account;
  if (!a.connected) return `<div class="acct"><div class="li-av" style="background:var(--surface-2);color:var(--faint)">${icon("user")}</div>
    <div class="grow"><b>${esc(t("Not connected"))}</b><div class="muted">${esc(t("Sign in with LinkedIn so PostPilot can publish your approved posts."))}</div></div>
    <button class="btn primary" id="sLogin" data-busy="Waiting…">${icon("link")}${esc(t("Connect LinkedIn"))}</button></div>`;
  const low = a.days_left < 7;
  return `<div class="acct"><div class="li-av">${a.picture ? `<img src="${esc(a.picture)}" alt="">` : esc(initials(a.name))}</div>
    <div class="grow"><b>${esc(a.name)}</b><div class="${low ? "" : "muted"}" style="${low ? "color:var(--warn)" : ""}">${esc(t("Session valid for {n} more days", { n: Math.max(0, Math.floor(a.days_left)) }))} · ${esc(t("LinkedIn asks you to sign in again every 60 days"))}</div></div>
    <button class="btn" id="sLogin" data-busy="Waiting…">${icon("refresh")}${esc(t("Reconnect"))}</button><button class="btn ghost danger" id="sLogout">${esc(t("Disconnect"))}</button></div>`;
}

function slotEditor(slots) {
  return `<div class="field"><label>${esc(t("Posting days"))}</label><div class="days" id="sDays">${DOW.map((d, i) => `<button type="button" data-d="${i}" class="${slots.days.includes(i) ? "on" : ""}">${esc(t(d))}</button>`).join("")}</div></div>
    <div class="field"><label>${esc(t("Posting times"))}</label><div class="row wrap" id="sTimes">${slots.times.map(x => `<span class="chip">${esc(x)}<button type="button" data-rmt="${esc(x)}" aria-label="Remove">${icon("x")}</button></span>`).join("")}
      <input type="time" class="input" id="sNewTime" style="width:130px"><button type="button" class="btn sm" id="sAddTime">${icon("plus")}${esc(t("Add time"))}</button></div>
      <span class="hint">${esc(t("“Next free slot” and bulk scheduling fill these slots in order, one post per slot."))}</span></div>`;
}
function bindSlotEditor(root, getSlots, onChange) {
  $$("#sDays button", root).forEach(b => b.onclick = () => {
    const s = getSlots(), d = +b.dataset.d;
    s.days = s.days.includes(d) ? s.days.filter(x => x !== d) : [...s.days, d].sort();
    onChange(s);
  });
  $$("[data-rmt]", root).forEach(b => b.onclick = () => { const s = getSlots(); s.times = s.times.filter(x => x !== b.dataset.rmt); onChange(s); });
  $("#sAddTime", root).onclick = () => {
    const v = $("#sNewTime", root).value; if (!v) return;
    const s = getSlots(); if (!s.times.includes(v)) s.times = [...s.times, v].sort(); onChange(s);
  };
}

VIEWS.settings = {
  async render(main, section) {
    const s = S.settings = await api("GET", "/api/settings");
    let zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []);
    if (!zones.includes(s.timezone)) zones = [s.timezone, ...zones];  // e.g. browsers list "Asia/Calcutta" for "Asia/Kolkata"
    const sw = (id, on, dis) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""} ${dis ? "disabled" : ""}><span></span></label>`;
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Settings"))}</h1><p>${esc(t("Changes save automatically."))}</p></div></div>
      <div class="settings">
        <nav class="settings-nav">${[["account", "LinkedIn account"], ["ai", "AI writing"], ["schedule", "Posting schedule"], ["app", "App & startup"], ["extension", "Browser extension"]].map(([k, l]) => `<a href="#" data-go="${k}">${esc(t(l))}</a>`).join("")}</nav>
        <div>
          <section class="card set-sec" id="sec-account"><h2>${esc(t("LinkedIn account"))}</h2><p class="muted">${esc(t("PostPilot only uses LinkedIn's official API. It never likes, comments or messages on your behalf."))}</p>
            <div id="sAcct">${accountBox()}</div>
            <div class="field"><label for="sHead">${esc(t("Your headline (for the preview only)"))}</label><input class="input" id="sHead" value="${esc(s.profile_headline)}" placeholder="${esc(t("e.g. Founder, TheDBAdmin · PostgreSQL trainer"))}"></div>
            <details class="adv"><summary>${esc(t("Advanced: LinkedIn app credentials"))}</summary>
              <div class="field"><label>${esc(t("Sign-in method"))}</label><div class="seg" id="sMode"><button data-v="direct" class="${s.auth_mode === "direct" ? "on" : ""}">${esc(t("My own LinkedIn app"))}</button><button data-v="broker" class="${s.auth_mode === "broker" ? "on" : ""}">${esc(t("PostPilot login server"))}</button></div>
                <span class="hint">${esc(t("For public release, use the login server so the Client Secret never ships inside the app."))}</span></div>
              <div id="sDirect" style="${s.auth_mode === "direct" ? "" : "display:none"}"><div class="two">
                <div class="field"><label>Client ID</label><input class="input mono" id="sCid" value="${esc(s.client_id)}"></div>
                <div class="field"><label>Client Secret</label><input class="input mono" type="password" id="sSecret" placeholder="${esc(s.has_client_secret ? t("Saved — type to replace") : "")}"></div></div>
                <div class="field"><label>${esc(t("Redirect URL"))}</label><input class="input mono" id="sRedir" value="${esc(s.redirect_uri)}"><span class="hint">${esc(t("Must match the redirect URL in your LinkedIn developer app exactly."))}</span></div></div>
              <div id="sBroker" style="${s.auth_mode === "broker" ? "" : "display:none"}"><div class="field"><label>${esc(t("Login server URL"))}</label><input class="input mono" id="sBurl" value="${esc(s.broker_url)}" placeholder="https://login.yourdomain.com"></div></div>
              <div class="field"><label>${esc(t("LinkedIn API version"))}</label><input class="input mono" id="sVer" value="${esc(s.li_version)}" style="max-width:140px"><span class="hint">${esc(t("YYYYMM. Update when LinkedIn retires the current version."))}</span></div>
            </details></section>

          <section class="card set-sec" id="sec-ai"><h2>${esc(t("AI writing"))}</h2><p class="muted">${esc(t("AI only writes drafts. Nothing is published until you schedule it."))}</p>
            <div class="two"><div class="field"><label>${esc(t("Provider"))}</label><select class="input" id="sProv">${[["groq", "Groq (free tier)"], ["openai", "OpenAI"], ["anthropic", "Anthropic Claude"]].map(([k, l]) => `<option value="${k}" ${s.ai_provider === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
              <div class="field"><label>${esc(t("Model"))}</label><input class="input mono" id="sModel" list="sModels" value="${esc(s.ai_model)}"><datalist id="sModels">${(MODEL_HINTS[s.ai_provider] || []).map(m => `<option value="${m}">`).join("")}</datalist></div></div>
            <div class="field"><label>${esc(t("API key"))}</label><div class="row"><input class="input mono grow" type="password" id="sKey" placeholder="${esc(s.has_ai_key ? t("Saved — type to replace") : t("Paste your key"))}"><button class="btn" id="sTestAI" data-busy="Testing…">${esc(t("Test"))}</button></div>
              <span class="hint">${s.ai_provider === "groq" ? `${esc(t("Free key, no card:"))} <a href="https://console.groq.com/keys" target="_blank">console.groq.com/keys</a>` : esc(t("Stored in Windows Credential Manager, never in plain files."))}</span></div>
            <div class="field"><label for="sVoice">${esc(t("Your voice"))}</label><textarea class="input" id="sVoice" rows="3">${esc(s.brand_voice)}</textarea><span class="hint">${esc(t("Describe how you write: tone, audience, words you use or avoid."))}</span></div>
            <div class="field"><label>${esc(t("Post length"))}</label><div class="seg" id="sLen">${[["short", "Short"], ["medium", "Medium"], ["long", "Long"]].map(([k, l]) => `<button data-v="${k}" class="${s.post_length === k ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div></div>
            <details class="adv"><summary>${esc(t("Advanced: custom endpoint"))}</summary><div class="field"><label>${esc(t("OpenAI-compatible URL (optional)"))}</label><input class="input mono" id="sBase" value="${esc(s.ai_base_url)}" placeholder="https://…/v1/chat/completions"></div></details></section>

          <section class="card set-sec" id="sec-schedule"><h2>${esc(t("Posting schedule"))}</h2><p class="muted">${esc(t("Your regular posting slots. Add posts one by one and PostPilot fills the next free slot."))}</p>
            <div id="sSlots">${slotEditor(s.slots)}</div>
            <div class="two"><div class="field"><label>${esc(t("Time zone"))}</label><select class="input" id="sTz">${zones.map(z => `<option ${z === s.timezone ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></div>
              <div class="field"><label>${esc(t("If the computer was off at post time"))}</label><select class="input" id="sGrace">${[[60, "Post if less than 1 hour late"], [360, "Post if less than 6 hours late"], [1440, "Post if less than 24 hours late"], [1000000, "Always post, however late"], [0, "Never post late — ask me"]].map(([v, l]) => `<option value="${v}" ${+s.missed_grace_minutes === v ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div></div>
            <h3 style="margin:10px 0 4px;font-size:14px">${esc(t("Posting limits"))}</h3>
            <p class="hint" style="margin:0 0 12px">${esc(t("Posting too often hurts reach and can look like spam to LinkedIn. These limits apply to scheduling, bulk scheduling and “Post now”."))}</p>
            <div class="two" style="grid-template-columns:1fr 1fr 1fr">
              <div class="field"><label>${esc(t("Max posts per day"))}</label><select class="input" id="sPerDay">${[1, 2, 3, 4, 5].filter(n => n <= S.status.usage.hard.per_day).map(n => `<option value="${n}" ${+s.max_posts_per_day === n ? "selected" : ""}>${n}</option>`).join("")}</select></div>
              <div class="field"><label>${esc(t("Minimum gap between posts"))}</label><select class="input" id="sGap">${[60, 120, 180, 240, 360, 720, 1440].map(m => `<option value="${m}" ${+s.min_gap_minutes === m ? "selected" : ""}>${m < 1440 ? t("{n} hours", { n: m / 60 }) : t("1 day")}</option>`).join("")}</select></div>
              <div class="field"><label>${esc(t("Max posts in queue"))}</label><input class="input" type="number" id="sQueue" min="1" max="${S.status.usage.hard.max_queue}" value="${esc(s.max_queue)}"></div>
            </div>
            <p class="hint" style="margin:0">${esc(t("Upper limits in this version: {d} posts/day, {g} min gap, {q} queued posts.", { d: S.status.usage.hard.per_day, g: S.status.usage.hard.gap_min, q: S.status.usage.hard.max_queue }))}</p></section>

          <section class="card set-sec" id="sec-app"><h2>${esc(t("App & startup"))}</h2><p class="muted">${esc(t("PostPilot must be running (in the tray is enough) to publish on time."))}</p>
            <div class="set-row"><div class="grow"><b>${esc(t("Start with Windows"))}</b><small>${esc(s.autostart_supported ? t("Starts quietly in the tray when you sign in to Windows.") : t("Available in the Windows app."))}</small></div>${sw("sAuto", s.autostart, !s.autostart_supported)}</div>
            <div class="set-row"><div class="grow"><b>${esc(t("Desktop notifications"))}</b><small>${esc(t("When a post is published, fails or needs attention."))}</small></div>${sw("sNotif", s.notifications)}</div>
            <div class="set-row"><div class="grow"><b>${esc(t("Pause the agent"))}</b><small>${esc(t("Stops publishing until you resume. Nothing is lost."))}</small></div>${sw("sPause", s.agent_paused)}</div>
            <div class="set-row"><div class="grow"><b>${esc(t("Language"))}</b></div><div class="seg" id="sLang"><button data-v="en" class="${s.language === "en" ? "on" : ""}">English</button><button data-v="hi" class="${s.language === "hi" ? "on" : ""}">Hinglish</button></div></div>
            <div class="set-row"><div class="grow"><b>${esc(t("Theme"))}</b></div><div class="seg" id="sTheme">${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<button data-v="${k}" class="${s.theme === k ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div></div>
            <div class="set-row"><div class="grow"><b>${esc(t("Setup guide"))}</b><small>${esc(t("Run the first-time setup again."))}</small></div><button class="btn sm" id="sWizard">${esc(t("Open"))}</button></div>
            <p class="faint" style="margin:12px 0 0;font-size:12.5px">PostPilot ${esc(S.status.version)}${S.status.mock ? " · DEMO MODE (no real posts)" : ""}</p></section>

          <section class="card set-sec" id="sec-extension"><h2>${icon("puzzle")} ${esc(t("Browser extension"))}</h2><p class="muted">${esc(t("Save any web page or idea to PostPilot from Chrome or Edge, and see your queue at a glance. Publishing still happens here in the app."))}</p>
            <ol class="steps"><li>${esc(t("Open chrome://extensions (or edge://extensions) and turn on Developer mode."))}</li><li>${esc(t("Click “Load unpacked” and choose the “extension” folder inside PostPilot."))}</li><li>${esc(t("Click the PostPilot icon in the toolbar and paste the connection code below."))}</li></ol>
            <div class="row" style="margin-top:14px"><button class="btn primary" id="sPair">${icon("puzzle")}${esc(t("Create connection code"))}</button><span class="hint">${esc(t("Creating a new code disconnects any previously paired browser."))}</span></div>
            <div id="sCode" style="margin-top:12px"></div></section>
        </div></div></div>`;
    if (section) setTimeout(() => { const el = $(`#sec-${section}`); if (el) el.scrollIntoView({ block: "start" }); }, 30);
    $$("[data-go]", main).forEach(a => a.onclick = e => { e.preventDefault(); $(`#sec-${a.dataset.go}`).scrollIntoView({ behavior: "smooth" }); });
    this.bind(main);
  },
  bind(main) {
    const s = S.settings;
    const bindAcct = () => {
      const b = $("#sLogin"); if (b) b.onclick = () => startLogin(b, () => { $("#sAcct").innerHTML = accountBox(); bindAcct(); });
      const o = $("#sLogout"); if (o) o.onclick = async () => {
        if (!(await confirmBox(t("Disconnect LinkedIn? Scheduled posts will fail until you reconnect."), "Disconnect", true))) return;
        await api("POST", "/api/account/logout"); await refreshStatus(); $("#sAcct").innerHTML = accountBox(); bindAcct();
      };
    };
    bindAcct();
    const onChange = (sel, fn) => { const el = $(sel, main); if (el) el.onchange = () => fn(el); };
    onChange("#sHead", el => saveSettings({ profile_headline: el.value.trim() }));
    $$("#sMode button", main).forEach(b => b.onclick = () => {
      $$("#sMode button").forEach(x => x.classList.toggle("on", x === b));
      $("#sDirect").style.display = b.dataset.v === "direct" ? "" : "none";
      $("#sBroker").style.display = b.dataset.v === "broker" ? "" : "none";
      saveSettings({ auth_mode: b.dataset.v });
    });
    onChange("#sCid", el => saveSettings({ client_id: el.value.trim() }));
    onChange("#sSecret", el => { if (el.value.trim()) saveSettings({}, { li_client_secret: el.value.trim() }).then(() => { el.value = ""; el.placeholder = t("Saved — type to replace"); }); });
    onChange("#sRedir", el => saveSettings({ redirect_uri: el.value.trim() }));
    onChange("#sBurl", el => saveSettings({ broker_url: el.value.trim() }));
    onChange("#sVer", el => saveSettings({ li_version: el.value.trim() }));
    onChange("#sProv", el => {
      const model = (MODEL_HINTS[el.value] || [""])[0];
      saveSettings({ ai_provider: el.value, ai_model: model }).then(() => this.render(main, "ai"));
    });
    onChange("#sModel", el => saveSettings({ ai_model: el.value.trim() }));
    onChange("#sKey", el => { if (el.value.trim()) saveSettings({}, { ai_api_key: el.value.trim() }).then(() => { el.value = ""; el.placeholder = t("Saved — type to replace"); }); });
    $("#sTestAI").onclick = async () => {
      const k = $("#sKey"); if (k.value.trim()) { await saveSettings({}, { ai_api_key: k.value.trim() }, true); k.value = ""; }
      const r = await run($("#sTestAI"), () => api("POST", "/api/ai/rewrite", { text: "Hello LinkedIn, this is a test.", action: "fix" }));
      toast(t("AI is working") + ": " + snippet(r.text, 50));
    };
    onChange("#sVoice", el => saveSettings({ brand_voice: el.value.trim() }));
    $$("#sLen button", main).forEach(b => b.onclick = () => { $$("#sLen button").forEach(x => x.classList.toggle("on", x === b)); saveSettings({ post_length: b.dataset.v }); });
    onChange("#sBase", el => saveSettings({ ai_base_url: el.value.trim() }));
    const redrawSlots = slots => saveSettings({ slots }).then(() => { $("#sSlots").innerHTML = slotEditor(slots); bindSlotEditor($("#sSlots"), () => JSON.parse(JSON.stringify(S.settings.slots)), redrawSlots); });
    bindSlotEditor($("#sSlots"), () => JSON.parse(JSON.stringify(S.settings.slots)), redrawSlots);
    onChange("#sTz", el => saveSettings({ timezone: el.value }));
    onChange("#sGrace", el => saveSettings({ missed_grace_minutes: +el.value }));
    onChange("#sPerDay", el => saveSettings({ max_posts_per_day: +el.value }));
    onChange("#sGap", el => saveSettings({ min_gap_minutes: +el.value }));
    onChange("#sQueue", el => saveSettings({ max_queue: +el.value }).catch(e => toast(e.message, "err")));
    onChange("#sAuto", el => saveSettings({ autostart: el.checked }));
    onChange("#sNotif", el => saveSettings({ notifications: el.checked }));
    onChange("#sPause", el => saveSettings({ agent_paused: el.checked }));
    $$("#sLang button", main).forEach(b => b.onclick = async () => { await saveSettings({ language: b.dataset.v }, null, true); this.render(main, "app"); renderSidebar(); });
    $$("#sTheme button", main).forEach(b => b.onclick = async () => { await saveSettings({ theme: b.dataset.v }, null, true); applyTheme(); $$("#sTheme button").forEach(x => x.classList.toggle("on", x === b)); });
    $("#sWizard").onclick = () => openOnboarding(true);
    $("#sPair").onclick = async () => {
      const r = await run($("#sPair"), () => api("POST", "/api/extension/pair"));
      const code = `${location.port}:${r.code}`;
      $("#sCode").innerHTML = `<div class="code-box"><code id="sCodeTxt">${esc(code)}</code><button class="btn sm" id="sCopy">${icon("copy")}${esc(t("Copy"))}</button></div>`;
      $("#sCopy").onclick = () => { navigator.clipboard.writeText(code); toast(t("Copied")); };
    };
  },
};

// ---------- onboarding wizard ----------
function openOnboarding(force) {
  let step = 0;
  const slots = JSON.parse(JSON.stringify(S.settings.slots || { days: [0, 2, 4], times: ["10:00"] }));
  const m = modal({ body: `<div class="wiz" id="wz"></div>`, onClose: () => { if (!force) saveSettings({ onboarded: true }, null, true); } });
  m.el.querySelector(".modal").classList.add("wiz");
  const draw = () => {
    const st = S.status, s = S.settings, box = $("#wz", m.el);
    const dots = `<div class="steps-dots" style="margin-bottom:18px">${[0, 1, 2, 3, 4].map(i => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>`;
    const nav = (next = "Continue", skip = true) => `<div class="row" style="margin-top:22px">${step ? `<button class="btn ghost" id="wBack">${icon("left")}${esc(t("Back"))}</button>` : ""}<span class="grow"></span>${skip ? `<button class="btn ghost" id="wSkip">${esc(t("Skip for now"))}</button>` : ""}<button class="btn primary" id="wNext">${esc(t(next))}</button></div>`;
    let html = "";
    if (step === 0) html = `<h2>${esc(t("Welcome to PostPilot"))}</h2><p class="muted">${esc(t("Plan a week of LinkedIn posts in one sitting, then let the agent publish them on time."))}</p>
      <div class="feature-list">${[["edit", "Write posts yourself or let AI draft them in your voice"], ["eye", "See exactly how each post will look before it goes live"], ["cal", "Queue posts into your regular posting slots"], ["check", "You approve everything — nothing is posted without your click"]].map(([ic, x]) => `<div>${icon(ic)}<span>${esc(t(x))}</span></div>`).join("")}</div>
      <div class="field" style="margin-top:18px"><label>${esc(t("Language"))}</label><div class="seg" id="wLang"><button data-v="en" class="${s.language === "en" ? "on" : ""}">English</button><button data-v="hi" class="${s.language === "hi" ? "on" : ""}">Hinglish</button></div></div>${nav("Get started", false)}`;
    if (step === 1) html = `<h2>${esc(t("Connect LinkedIn"))}</h2><p class="muted">${esc(t("A LinkedIn sign-in page opens in your browser. Approve it and come back here."))}</p>
      ${s.auth_mode === "direct" && (!s.client_id || !s.has_client_secret) ? `<div class="two"><div class="field"><label>Client ID</label><input class="input mono" id="wCid" value="${esc(s.client_id)}"></div><div class="field"><label>Client Secret</label><input class="input mono" type="password" id="wSec"></div></div>` : ""}
      <div id="wAcct">${st.account.connected ? `<div class="banner info">${icon("check")}<div class="grow"><b>${esc(t("Connected as {n}", { n: st.account.name }))}</b></div></div>` : `<button class="btn primary" id="wLogin" data-busy="Waiting…">${icon("link")}${esc(t("Connect LinkedIn"))}</button>`}</div>${nav()}`;
    if (step === 2) html = `<h2>${esc(t("AI writing (optional)"))}</h2><p class="muted">${esc(t("Paste a free Groq API key to let AI draft posts. You can change the provider later."))}</p>
      <div class="field"><label>${esc(t("Groq API key"))}</label><input class="input mono" type="password" id="wKey" placeholder="${esc(s.has_ai_key ? t("Saved — type to replace") : "gsk_…")}"><span class="hint"><a href="https://console.groq.com/keys" target="_blank">console.groq.com/keys</a> · ${esc(t("free, no card"))}</span></div>
      <div class="field"><label>${esc(t("Your voice"))}</label><textarea class="input" id="wVoice" rows="3">${esc(s.brand_voice)}</textarea></div>${nav()}`;
    if (step === 3) html = `<h2>${esc(t("When do you like to post?"))}</h2><p class="muted">${esc(t("Pick your usual days and times. You can always choose a specific time per post."))}</p><div id="wSlots">${slotEditor(slots)}</div>${nav()}`;
    if (step === 4) html = `<h2>${esc(t("You're all set"))}</h2><p class="muted">${esc(t("Keep PostPilot running in the tray and it will publish your scheduled posts on time."))}</p>
      <div class="set-row"><div class="grow"><b>${esc(t("Start with Windows"))}</b><small>${esc(t("Recommended, so posts go out even after a restart."))}</small></div><label class="switch"><input type="checkbox" id="wAuto" ${s.autostart ? "checked" : ""} ${s.autostart_supported ? "" : "disabled"}><span></span></label></div>
      <div class="row" style="margin-top:22px"><button class="btn ghost" id="wBack">${icon("left")}${esc(t("Back"))}</button><span class="grow"></span><button class="btn primary" id="wDone">${icon("edit")}${esc(t("Write my first post"))}</button></div>`;
    box.innerHTML = dots + html;
    const go = d => { step += d; draw(); };
    const back = $("#wBack", box); if (back) back.onclick = () => go(-1);
    const skip = $("#wSkip", box); if (skip) skip.onclick = () => go(1);
    $$("#wLang button", box).forEach(b => b.onclick = async () => { await saveSettings({ language: b.dataset.v }, null, true); renderSidebar(); draw(); });
    const login = $("#wLogin", box);
    if (login) login.onclick = async () => {
      const cid = $("#wCid", box), sec = $("#wSec", box);
      if (cid && cid.value.trim()) await saveSettings({ client_id: cid.value.trim() }, sec && sec.value.trim() ? { li_client_secret: sec.value.trim() } : {}, true);
      startLogin(login, () => draw());
    };
    if (step === 3) { const redraw = sl => { Object.assign(slots, sl); $("#wSlots", box).innerHTML = slotEditor(slots); bindSlotEditor($("#wSlots", box), () => slots, redraw); }; bindSlotEditor($("#wSlots", box), () => slots, redraw); }
    const next = $("#wNext", box);
    if (next) next.onclick = async () => {
      if (step === 2) { const k = $("#wKey", box).value.trim(); await saveSettings({ brand_voice: $("#wVoice", box).value.trim() }, k ? { ai_api_key: k } : {}, true); }
      if (step === 3) await saveSettings({ slots }, null, true);
      go(1);
    };
    const done = $("#wDone", box);
    if (done) done.onclick = async () => {
      const a = $("#wAuto", box);
      await saveSettings({ onboarded: true, autostart: a ? a.checked : false }, null, true);
      force = true; m.close(); location.hash = "#/compose";
    };
  };
  draw();
}
