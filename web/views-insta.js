/* Instagram agent tab: people comment a keyword and get your link in DMs. Opened from the sidebar in its own tab. */
IC.insta = '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>';

const IG_NAV = [["", "home", "Overview"], ["automations", "spark", "Automations"], ["activity", "pulse", "Activity"], ["settings", "gear", "Settings"]];
const IG_STATUS = {
  sent: ["published", "Link sent"], awaiting: ["scheduled", "Waiting for reply"], gave_up: ["draft", "Didn't follow"],
  expired: ["draft", "No reply"], duplicate: ["draft", "Already sent"], failed: ["failed", "Failed"], new: ["publishing", "Sending…"],
};
const IG_FIELDS = ["name", "media_id", "media_caption", "media_thumb", "media_permalink", "keywords", "require_follow", "link",
  "dm_text", "gate_text", "nofollow_text", "public_replies", "active"];
const igBadge = st => { const [cls, label] = IG_STATUS[st] || ["draft", st]; return `<span class="badge ${cls}">${esc(t(label))}</span>`; };
const igThumb = m => m.thumbnail_url || (m.media_type === "VIDEO" ? "" : m.media_url) || "";
const igImg = (src, cls = "ig-thumb") => src
  ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
  : `<span class="${cls}">${icon("insta")}</span>`;

// ---------- shell (core.js calls these while the Instagram tab is open) ----------
function renderIgNav() {
  const sub = location.hash.split("/")[2] || "";
  $("#nav").innerHTML = IG_NAV.map(([r, ic, label]) => `<a href="#/insta${r ? "/" + r : ""}" class="${sub === r ? "active" : ""}">${icon(ic)}<span>${esc(t(label))}</span></a>`).join("")
    + `<a href="/#/dashboard" target="_blank" rel="noopener" class="nav-ext">${icon("link")}<span>${esc(t("LinkedIn tab"))}</span>${icon("ext")}</a>`;
}
function igAgentInfo() {
  const g = S.ig;
  if (!g) return { cls: "", title: "…", sub: "" };
  if (!g.account.connected) return { cls: "warn", title: t("Instagram not connected"), sub: t("Add your token in Settings"), state: "noacct" };
  if (g.agent.paused) return { cls: "warn", title: t("Agent paused"), sub: t("Comments will wait"), state: "paused" };
  if (g.agent.last_error) return { cls: "err", title: t("Needs attention"), sub: snippet(g.agent.last_error, 40), state: "error" };
  return { cls: "ok", title: t("Agent running"), sub: g.agent.last_tick ? t("Checked {v}", { v: rel(g.agent.last_tick) }) : t("Starting…"), state: "ok" };
}
function renderIgSidebar() {
  document.title = "PostPilot · Instagram";
  const a = igAgentInfo(), acc = S.ig && S.ig.account;
  $("#agentPill").innerHTML = `<i class="dot ${a.cls}"></i><div><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></div>`;
  $("#me").innerHTML = acc && acc.connected
    ? `<div class="li-av ig" style="width:32px;height:32px;font-size:13px">${acc.picture ? `<img src="${esc(acc.picture)}" alt="">` : esc(initials(acc.username))}</div><div class="who"><b>@${esc(acc.username)}</b><small>${esc(t("Instagram connected"))}</small></div>`
    : `<a class="btn sm" href="#/insta/settings" style="width:100%">${icon("insta")}${esc(t("Connect Instagram"))}</a>`;
  $$("#lang button").forEach(b => b.classList.toggle("on", b.dataset.l === lang()));
}

// ---------- pieces ----------
function igBanners() {
  const g = S.ig, out = [];
  if (!g.account.connected) out.push(["warn", "insta", t("Connect your Instagram account"), t("Paste the access token from your Meta app once. PostPilot renews it automatically."), `<a class="btn primary sm" href="#/insta/settings">${esc(t("Connect"))}</a>`]);
  else if (g.account.days_left < 10) out.push(["warn", "clock", t("Instagram token expires in {n} days", { n: Math.max(0, Math.floor(g.account.days_left)) }), t("Automatic renewal hasn't worked. Paste a new token in Settings."), `<a class="btn sm" href="#/insta/settings">${esc(t("Settings"))}</a>`]);
  if (g.agent.note) out.push(["info", "info", g.agent.note, "", ""]);
  if (g.account.connected && !g.counts.automations) out.push(["info", "spark", t("No active automations"), t("Create one to start answering comments."), `<a class="btn sm" href="#/insta/automations">${esc(t("Create"))}</a>`]);
  if (g.counts.failed) out.push(["err", "alert", t("{n} DM(s) failed", { n: g.counts.failed }), t("Open Activity to see why."), `<a class="btn sm" href="#/insta/activity">${esc(t("Review"))}</a>`]);
  return out.map(([k, ic, title, sub, act]) => `<div class="banner ${k}">${icon(ic)}<div class="grow"><b>${esc(title)}</b>${sub ? `<span class="muted">${esc(sub)}</span>` : ""}</div>${act}</div>`).join("");
}
function igAgentCard() {
  const g = S.ig, a = igAgentInfo(), paused = g.agent.paused;
  const desc = a.state === "noacct" ? t("Connect your Instagram account in Settings to start.")
    : paused ? t("New comments wait until you resume. Instagram allows answering them for 7 days.")
    : a.state === "error" ? g.agent.last_error
    : t("Checks your posts for new comments every minute and answers in DMs.");
  const dot = a.state === "error" ? "down" : paused || a.state === "noacct" ? "paused" : "";
  return `<div class="big-dot ${dot}">${icon(paused ? "pause" : a.state === "ok" ? "check" : "alert")}</div>
    <div class="grow"><h3>${esc(a.title)}${a.state === "ok" ? ` <span class="faint" style="font-weight:400;font-size:13px">· ${esc(a.sub)}</span>` : ""}</h3><p>${esc(desc)}</p></div>
    ${g.account.connected ? `<button class="btn" id="iCheck">${icon("refresh")}${esc(t("Check now"))}</button><button class="btn" id="iPause">${icon(paused ? "play" : "pause")}${esc(t(paused ? "Resume" : "Pause"))}</button>`
      : `<a class="btn primary" href="#/insta/settings">${icon("insta")}${esc(t("Connect Instagram"))}</a>`}`;
}
function igStats() {
  const c = S.ig.counts;
  return [["insta/activity", "send", "Links sent today", c.sent_today], ["insta/activity", "check", "Links sent (all time)", c.sent],
    ["insta/activity", "clock", "Waiting for a reply", c.awaiting], ["insta/automations", "spark", "Active automations", c.automations]]
    .map(([href, ic, k, v]) => `<a class="card stat" href="#/${href}"><span class="k">${icon(ic)}${esc(t(k))}</span><span class="v">${v}</span></a>`).join("");
}
function igEventList(rows) {
  if (!rows.length) return `<div class="empty" style="padding:16px">${esc(t("No comments answered yet."))}</div>`;
  const look = { sent: ["success", "check"], failed: ["error", "x"], awaiting: ["info", "clock"] };
  return rows.map(e => { const [cls, ic] = look[e.status] || ["warn", "info"];
    return `<div class="act"><span class="ic ${cls}">${icon(ic)}</span><div class="grow"><b>@${esc(e.username)}</b> <span class="muted">“${esc(snippet(e.text, 60))}”</span> ${igBadge(e.status)}${e.error ? `<div class="q-err">${esc(e.error)}</div>` : ""}</div><time title="${esc(fmtFull(e.updated_at))}">${esc(rel(e.updated_at))}</time></div>`; }).join("");
}
async function igSimCard() {
  const media = S.ig.account.connected ? await api("GET", "/api/insta/media").catch(() => []) : [];
  return `<div class="card card-pad"><h2>${icon("spark")}${esc(t("Try it (demo mode)"))}</h2>
    <p class="muted" style="margin-top:0">${esc(t("Pretend someone commented on one of your posts. Demo mode never talks to Instagram."))}</p>
    ${media.length ? `<div class="field"><label for="simMedia">${esc(t("Post"))}</label><select class="input" id="simMedia">${media.map(m => `<option value="${esc(m.id)}">${esc(snippet(m.caption, 60))}</option>`).join("")}</select></div>
    <div class="two"><div class="field"><label for="simUser">${esc(t("Their username"))}</label><input class="input" id="simUser" value="test_follower"></div>
      <div class="field"><label for="simText">${esc(t("Comment"))}</label><input class="input" id="simText" value="HANDBOOK"></div></div>
    <label class="row" style="gap:8px;margin-bottom:12px"><input type="checkbox" id="simFollows" checked>${esc(t("They follow you"))}</label>
    <button class="btn primary" id="simGo">${icon("send")}${esc(t("Simulate comment"))}</button>`
    : `<div class="empty" style="padding:12px">${esc(t("Connect first (any text of 20+ characters works in demo mode)."))}</div>`}</div>`;
}
function igHowCard() {
  return `<div class="card card-pad"><h2>${icon("info")}${esc(t("How it works"))}</h2><ol class="steps">
    <li>${esc(t("Someone comments your keyword (e.g. HANDBOOK) on your post."))}</li>
    <li>${esc(t("Within a minute PostPilot sends them a DM with your link, or first asks them to follow if the automation is “Only for followers”."))}</li>
    <li>${esc(t("Once they follow and reply, they get the link. Every step shows up in Activity."))}</li></ol>
    <p class="hint" style="margin-bottom:0">${esc(t("Instagram's rules: one DM per comment, within 7 days of it; further messages only after the person replies."))}</p></div>`;
}

// ---------- automation editor ----------
async function igEditor(a, onSaved) {
  const D = S.ig.defaults;
  const v = a ? { ...a } : { name: "", media_id: "", media_caption: "", media_thumb: "", media_permalink: "", keywords: "", require_follow: false,
    link: "", dm_text: D.dm_text, gate_text: D.gate_text, nofollow_text: D.nofollow_text, public_replies: "", active: true };
  v.gate_text = v.gate_text || D.gate_text; v.nofollow_text = v.nofollow_text || D.nofollow_text;
  const m = modal({ title: esc(t(a ? "Edit automation" : "New automation")), wide: true, body: `<div class="empty"><span class="spinner"></span></div>`,
    foot: `<button class="btn" data-close>${esc(t("Cancel"))}</button><button class="btn primary" id="aeSave">${icon("save")}${esc(t("Save"))}</button>` });
  let media = [];
  try { media = await api("GET", "/api/insta/media"); } catch (e) { toast(e.message, "err"); }
  if (v.media_id && !media.some(x => x.id === v.media_id)) media.unshift({ id: v.media_id, caption: v.media_caption, thumbnail_url: v.media_thumb, permalink: v.media_permalink });
  const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span></span></label>`;
  const tile = x => `<button type="button" class="ig-pick ${v.media_id === x.id ? "on" : ""}" data-mid="${esc(x.id)}" title="${esc(snippet(x.caption, 120))}">${igImg(igThumb(x), "")}</button>`;
  $(".modal-body", m.el).innerHTML = `
    <div class="field"><label>${esc(t("Which post?"))}</label>
      <div class="ig-picks"><button type="button" class="ig-pick ${v.media_id ? "" : "on"}" data-mid=""><span class="any">${icon("insta")}<b>${esc(t("Any post"))}</b></span></button>${media.map(tile).join("")}</div>
      <span class="hint" id="aeCap"></span></div>
    <div class="two"><div class="field"><label for="aeKw">${esc(t("Keywords"))}</label><input class="input" id="aeKw" value="${esc(v.keywords)}" placeholder="HANDBOOK, GUIDE">
        <span class="hint">${esc(t("Comma-separated, any capitalisation. Empty = answer every comment."))}</span></div>
      <div class="field"><label for="aeLink">${esc(t("Link to send"))}</label><input class="input mono" id="aeLink" value="${esc(v.link)}" placeholder="https://lms.thedbadmin.com/…">
        <span class="hint">${esc(t("Must be public (Drive, your site…): people open it on their phone."))}</span></div></div>
    <div class="field"><label for="aeDm">${esc(t("DM with the link"))}</label><textarea class="input" id="aeDm" rows="3">${esc(v.dm_text)}</textarea>
      <span class="hint">${esc(t("{name} = their @username · {link} = your link · {account} = your @username"))}</span></div>
    <div class="set-row"><div class="grow"><b>${esc(t("Only for followers"))}</b><small>${esc(t("Ask people to follow first; the link goes out once they follow and reply. Use sparingly: Instagram discourages trading content for follows."))}</small></div>${sw("aeFollow", v.require_follow)}</div>
    <div id="aeGate" style="${v.require_follow ? "" : "display:none"}">
      <div class="field"><label for="aeGateTxt">${esc(t("First DM: ask them to follow"))}</label><textarea class="input" id="aeGateTxt" rows="3">${esc(v.gate_text)}</textarea></div>
      <div class="field"><label for="aeNoTxt">${esc(t("If they reply but still don't follow"))}</label><textarea class="input" id="aeNoTxt" rows="2">${esc(v.nofollow_text)}</textarea>
        <span class="hint">${esc(t("Sent at most {n} times, then PostPilot stops.", { n: S.ig.limits.follow_tries - 1 }))}</span></div></div>
    <div class="field"><label for="aePub">${esc(t("Public reply under the comment (optional)"))}</label><textarea class="input" id="aePub" rows="2" placeholder="${esc(t("Sent! Check your DMs 📩"))}">${esc(v.public_replies)}</textarea>
      <span class="hint">${esc(t("One per line. A random one is used so replies don't look copy-pasted."))}</span></div>
    <div class="two"><div class="field"><label for="aeName">${esc(t("Name (optional)"))}</label><input class="input" id="aeName" value="${esc(v.name)}" placeholder="${esc(t("e.g. Upgrade handbook"))}"></div>
      <div class="set-row" style="border:0"><div class="grow"><b>${esc(t("Active"))}</b><small>${esc(t("Only comments made while it's active are answered."))}</small></div>${sw("aeActive", v.active)}</div></div>`;
  const showCap = () => { $("#aeCap", m.el).textContent = v.media_id ? snippet(v.media_caption, 140) : t("Watches your 10 newest posts."); };
  showCap();
  $$(".ig-pick", m.el).forEach(b => b.onclick = () => {
    const x = media.find(y => y.id === b.dataset.mid) || {};
    Object.assign(v, { media_id: x.id || "", media_caption: x.caption || "", media_thumb: igThumb(x), media_permalink: x.permalink || "" });
    $$(".ig-pick", m.el).forEach(y => y.classList.toggle("on", y === b)); showCap();
  });
  $("#aeFollow", m.el).onchange = e => { $("#aeGate", m.el).style.display = e.target.checked ? "" : "none"; };
  $("#aeSave", m.el).onclick = async () => {
    const body = { ...Object.fromEntries(IG_FIELDS.map(k => [k, v[k]])), name: $("#aeName").value, keywords: $("#aeKw").value, link: $("#aeLink").value,
      dm_text: $("#aeDm").value, require_follow: $("#aeFollow").checked, gate_text: $("#aeGateTxt").value, nofollow_text: $("#aeNoTxt").value,
      public_replies: $("#aePub").value, active: $("#aeActive").checked };
    if (!body.keywords.trim() && !(await confirmBox(t("No keywords: PostPilot will DM everyone who comments on this post. Continue?"), "Continue"))) return;
    try { await run($("#aeSave"), () => api(a ? "PUT" : "POST", a ? `/api/insta/automations/${a.id}` : "/api/insta/automations", body), "Saved"); }
    catch (_) { return; }
    m.close(); onSaved();
  };
}
function igAutoItem(a) {
  const kws = (a.keywords || "").split(",").map(k => k.trim()).filter(Boolean);
  return `<div class="card ig-auto ${a.active ? "" : "off"}">
    ${a.media_id ? igImg(a.media_thumb) : `<span class="ig-thumb">${icon("insta")}</span>`}
    <div class="grow" style="min-width:0"><b>${esc(a.name || (a.media_id ? snippet(a.media_caption, 50) : t("Any post")))}</b>
      <div class="q-meta"><span>${icon("insta")}${esc(a.media_id ? snippet(a.media_caption, 40) || t("One post") : t("Any of your 10 newest posts"))}</span>
        <span>${kws.length ? kws.map(k => `<span class="chip">${esc(k)}</span>`).join(" ") : esc(t("Every comment"))}</span>
        ${a.require_follow ? `<span>${icon("user")}${esc(t("Only for followers"))}</span>` : ""}
        <span>${icon("send")}${esc(t("{n} sent", { n: a.sent }))}</span></div>
      ${a.link ? `<div class="faint mono ig-link">${esc(a.link)}</div>` : ""}</div>
    <label class="switch" title="${esc(t("Active"))}"><input type="checkbox" data-ig-toggle="${a.id}" ${a.active ? "checked" : ""}><span></span></label>
    <button class="btn sm" data-ig-edit="${a.id}">${icon("edit")}${esc(t("Edit"))}</button>
    <button class="btn sm icon ghost danger" data-ig-del="${a.id}" title="${esc(t("Delete"))}">${icon("trash")}</button></div>`;
}

// ---------- view ----------
VIEWS.insta = {
  async render(main, sub) {
    S.ig = await api("GET", "/api/insta/status");
    renderSidebar();
    this.sub = ["automations", "activity", "settings"].includes(sub) ? sub : "";
    main.onclick = main.onchange = null;
    await this[this.sub || "overview"](main);
  },
  async overview(main) {
    const ev = await api("GET", "/api/insta/events?limit=8");
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Instagram agent"))}</h1><p>${esc(t("People comment a keyword on your post and get your link in their DMs, automatically."))}${S.ig.mock ? ` <span class="badge publishing">${esc(t("DEMO MODE"))}</span>` : ""}</p></div>
        <div class="actions"><a class="btn primary" href="#/insta/automations">${icon("plus")}${esc(t("New automation"))}</a></div></div>
      <div id="iBanners">${igBanners()}</div>
      <div class="card agent-card" id="iAgent">${igAgentCard()}</div>
      <div class="stats" id="iStats">${igStats()}</div>
      <div class="dash-cols">
        <div class="card card-pad"><h2>${icon("pulse")}${esc(t("Recent activity"))}<a class="sub" href="#/insta/activity">${esc(t("View all"))}</a></h2><div id="iAct">${igEventList(ev)}</div></div>
        ${S.ig.mock ? await igSimCard() : igHowCard()}
      </div></div>`;
    main.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "iCheck") { await run(b, () => api("POST", "/api/insta/check"), "Checking for new comments…"); setTimeout(refreshStatus, 2500); }
      if (b.id === "iPause") {
        const paused = !S.ig.agent.paused;
        await run(b, () => api("POST", "/api/insta/pause", { paused }), paused ? "Agent paused" : "Agent resumed");
        await refreshStatus();
      }
      if (b.id === "simGo") {
        await run(b, () => api("POST", "/api/insta/simulate", { media_id: $("#simMedia").value, username: $("#simUser").value, text: $("#simText").value, follows: $("#simFollows").checked }), "Comment added. Watch Recent activity.");
        setTimeout(refreshStatus, 2500);
      }
    };
  },
  async automations(main) {
    const list = await api("GET", "/api/insta/automations");
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Automations"))}</h1><p>${esc(t("Each automation watches a post for keywords and sends your link in DMs."))}</p></div>
        <div class="actions"><button class="btn primary" id="iNew" ${S.ig.account.connected ? "" : "disabled"}>${icon("plus")}${esc(t("New automation"))}</button></div></div>
      ${S.ig.account.connected ? "" : igBanners()}
      <div class="q-list">${list.map(igAutoItem).join("") || `<div class="card empty">${icon("spark")}<div>${esc(t("No automations yet."))}</div></div>`}</div></div>`;
    const again = () => this.automations(main);
    main.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      const a = list.find(x => String(x.id) === (b.dataset.igEdit || b.dataset.igDel));
      if (b.id === "iNew") igEditor(null, again);
      else if (b.dataset.igEdit) igEditor(a, again);
      else if (b.dataset.igDel && await confirmBox(t("Delete this automation? People already waiting for a reply won't get the link."), "Delete", true)) {
        await run(b, () => api("DELETE", `/api/insta/automations/${a.id}`), "Deleted"); again();
      }
    };
    main.onchange = async e => {
      const id = e.target.dataset.igToggle; if (!id) return;
      const a = list.find(x => String(x.id) === id);
      try { await api("PUT", `/api/insta/automations/${id}`, { ...Object.fromEntries(IG_FIELDS.map(k => [k, a[k]])), active: e.target.checked }); toast(t(e.target.checked ? "Automation on" : "Automation off")); }
      catch (err) { toast(err.message, "err"); }
      again();
    };
  },
  async activity(main) {
    const rows = await api("GET", "/api/insta/events?limit=300");
    this.sig = rows.map(e => e.comment_id + e.status + e.attempts).join();
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Activity"))}</h1><p>${esc(t("Every comment the agent answered, newest first."))}</p></div></div>
      <div class="card">${rows.length ? `<table class="log-table">${rows.map(e => `<tr><td class="t">${esc(fmtFull(e.updated_at))}</td>
        <td><b>@${esc(e.username)}</b> <span class="muted">“${esc(snippet(e.text, 80))}”</span>${e.error ? `<div class="q-err">${esc(e.error)}</div>` : ""}</td>
        <td class="faint">${esc(e.automation || "")}</td>
        <td>${igBadge(e.status)}${e.attempts ? `<div class="faint" style="font-size:12px">${esc(t("Reminded {n}×", { n: Math.min(e.attempts, S.ig.limits.follow_tries - 1) }))}</div>` : ""}</td></tr>`).join("")}</table>`
        : `<div class="empty">${icon("pulse")}<div>${esc(t("No comments answered yet."))}</div></div>`}</div></div>`;
  },
  async settings(main) {
    const g = S.ig, acc = g.account;
    const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span></span></label>`;
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Instagram settings"))}</h1><p>${esc(t("Changes save automatically."))}</p></div></div>
      <section class="card set-sec"><h2>${icon("insta")} ${esc(t("Instagram account"))}</h2>
        <p class="muted">${esc(t("PostPilot uses Instagram's official API. It only answers comments on your posts, with the messages you write."))}</p>
        ${acc.connected ? `<div class="acct"><div class="li-av ig">${acc.picture ? `<img src="${esc(acc.picture)}" alt="">` : esc(initials(acc.username))}</div>
            <div class="grow"><b>@${esc(acc.username)}</b><div class="muted">${acc.followers != null ? esc(t("{n} followers", { n: acc.followers })) + " · " : ""}${esc(t("Token valid for {n} more days, renewed automatically", { n: Math.max(0, Math.floor(acc.days_left)) }))}</div></div>
            <button class="btn ghost danger" id="iDisc">${esc(t("Disconnect"))}</button></div>`
          : `<ol class="steps"><li>${esc(t("Open developers.facebook.com → your app → Instagram → API setup with Instagram login."))}</li>
              <li>${esc(t("In step 2 “Generate access tokens”, click Generate token on your account's row and copy it."))}</li>
              <li>${esc(t("Paste it here. PostPilot renews it automatically, so you only do this once."))}</li></ol>
            <div class="row" style="margin-top:12px"><input class="input mono grow" type="password" id="iTok" placeholder="IGAA…" autocomplete="off"><button class="btn primary" id="iConnect" data-busy="Checking…">${icon("link")}${esc(t("Connect"))}</button></div>
            ${g.mock ? `<span class="hint">${esc(t("Demo mode: any text of 20+ characters works."))}</span>` : ""}`}
      </section>
      <section class="card set-sec"><h2>${esc(t("Agent"))}</h2>
        <div class="set-row"><div class="grow"><b>${esc(t("Pause the agent"))}</b><small>${esc(t("New comments wait until you resume. Instagram allows answering them for 7 days."))}</small></div>${sw("iPauseSw", g.agent.paused)}</div>
        <div class="set-row"><div class="grow"><b>${esc(t("Safety limits"))}</b><small>${esc(t("At most {d} DMs an hour · {f} follow checks per person · comments older than {w} days are skipped (Instagram's rule).", { d: g.limits.dms_per_hour, f: g.limits.follow_tries, w: g.limits.window_days }))}</small></div></div>
      </section></div>`;
    main.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "iConnect") {
        const token = $("#iTok").value.trim(); if (!token) return toast(t("Paste your token first."), "err");
        try { await run(b, () => api("POST", "/api/insta/connect", { token }), "Instagram connected"); } catch (_) { return; }
        this.render(main);
      }
      if (b.id === "iDisc" && await confirmBox(t("Disconnect Instagram? The agent stops answering comments until you connect again."), "Disconnect", true)) {
        await api("POST", "/api/insta/disconnect"); toast(t("Disconnected")); this.render(main);
      }
    };
    main.onchange = async e => {
      if (e.target.id !== "iPauseSw") return;
      await api("POST", "/api/insta/pause", { paused: e.target.checked });
      toast(t(e.target.checked ? "Agent paused" : "Agent resumed")); refreshStatus();
    };
  },
  async tick() {
    if (this.sub === "" && $("#iStats")) {
      $("#iStats").innerHTML = igStats(); $("#iAgent").innerHTML = igAgentCard(); $("#iBanners").innerHTML = igBanners();
      const ev = await api("GET", "/api/insta/events?limit=8"), el = $("#iAct");
      if (el) el.innerHTML = igEventList(ev);
    } else if (this.sub === "activity" && $(".page")) {
      const rows = await api("GET", "/api/insta/events?limit=300");
      if (rows.map(e => e.comment_id + e.status + e.attempts).join() !== this.sig) this.activity($("#main"));
    }
  },
};
