/* Dashboard, Queue, Calendar, AI Batch, Activity views. */

// ---------- generic popup menu ----------
document.addEventListener("click", e => {
  const tog = e.target.closest("[data-menu]");
  $$(".menu.open").forEach(m => { if (!tog || m !== tog.parentElement) m.classList.remove("open"); });
  if (tog) tog.parentElement.classList.toggle("open");
});

// ---------- shared post actions ----------
async function postAction(action, id, btn) {
  const go = (m, p, b, ok) => run(btn, () => api(m, p, b), ok);
  if (action === "schedule") await go("POST", `/api/posts/${id}/schedule`, { when: "next_slot" }, "Scheduled in your next free slot");
  else if (action === "now") {
    if (!(await confirmBox(t("Publish this post to LinkedIn right now?"), "Post now"))) return false;
    await go("POST", `/api/posts/${id}/schedule`, { when: "now" }, "Publishing now…");
  }
  else if (action === "unschedule") await go("POST", `/api/posts/${id}/unschedule`, undefined, "Moved back to drafts");
  else if (action === "duplicate") await go("POST", `/api/posts/${id}/duplicate`, undefined, "Copied to drafts");
  else if (action === "delete") {
    if (!(await confirmBox(t("Delete this post? This can't be undone."), "Delete", true))) return false;
    await go("DELETE", `/api/posts/${id}`, undefined, "Deleted");
  }
  else if (action === "preview") { openPreviewModal(await api("GET", `/api/posts/${id}`)); return false; }
  else if (action === "edit") { location.hash = `#/compose/${id}`; return false; }
  refreshStatus();
  return true;
}
function bindPostActions(root, after) {
  root.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    e.preventDefault();
    try { if (await postAction(b.dataset.act, b.dataset.id, b.tagName === "BUTTON" ? b : null) && after) after(); } catch (_) { }
  });
}

// ---------- Dashboard ----------
function dashBanners() {
  const st = S.status, out = [];
  if (!st.account.connected) out.push(["warn", "link", t("Connect your LinkedIn account"), t("PostPilot needs permission to publish on your behalf."), `<a class="btn primary sm" href="#/settings/account">${esc(t("Connect"))}</a>`]);
  else if (st.account.days_left !== null && st.account.days_left < 7) out.push(["warn", "clock", t("LinkedIn session expires in {n} days", { n: Math.max(0, Math.floor(st.account.days_left)) }), t("LinkedIn requires signing in again every 60 days. Reconnect so scheduled posts don't fail."), `<a class="btn sm" href="#/settings/account">${esc(t("Reconnect"))}</a>`]);
  if (!st.settings.has_ai_key) out.push(["info", "spark", t("Add an AI key to write posts with AI"), t("Groq keys are free and need no card."), `<a class="btn sm" href="#/settings/ai">${esc(t("Add key"))}</a>`]);
  const bad = st.counts.failed + st.counts.missed;
  if (bad) out.push(["err", "alert", t("{n} post(s) need your attention", { n: bad }), t("Open them to see what went wrong, then retry or reschedule."), `<a class="btn sm" href="#/queue/attention">${esc(t("Review"))}</a>`]);
  return out.map(([k, ic, title, sub, act]) => `<div class="banner ${k}">${icon(ic)}<div class="grow"><b>${esc(title)}</b><span class="muted">${esc(sub)}</span></div>${act}</div>`).join("");
}
function agentCardHtml() {
  const a = agentInfo(), st = S.status, paused = st.settings.agent_paused;
  const cls = a.state === "down" ? "down" : paused ? "paused" : "";
  const desc = a.state === "down" ? t("The background agent stopped responding. Quit and reopen PostPilot.")
    : paused ? t("Scheduled posts will wait until you resume.")
    : t("Keeps running in the tray, even when this window is closed. Checks the queue every 15 seconds.");
  return `<div class="big-dot ${cls}">${icon(paused ? "pause" : a.state === "down" ? "alert" : "check")}</div>
    <div class="grow"><h3>${esc(a.title)}${a.state === "ok" ? ` <span class="faint" style="font-weight:400;font-size:13px">· ${esc(a.sub)}</span>` : ""}</h3><p>${esc(desc)}</p></div>
    <button class="btn" id="pauseBtn">${icon(paused ? "play" : "pause")}${esc(t(paused ? "Resume" : "Pause"))}</button>`;
}
VIEWS.dashboard = {
  async render(main) {
    const [upcoming, act] = await Promise.all([api("GET", "/api/posts?status=scheduled,publishing"), api("GET", "/api/activity?limit=10")]);
    upcoming.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const st = S.status, c = st.counts, nxt = upcoming[0];
    const hour = +fmt(new Date().toISOString(), { hour: "numeric", hourCycle: "h23" });
    const greet = hour < 12 ? t("Good morning") : hour < 17 ? t("Good afternoon") : t("Good evening");
    const first = (st.account.name || "").split(" ")[0];
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(greet)}${first ? `, ${esc(first)}` : ""}</h1><p>${esc(t("Here's what your LinkedIn agent is doing."))} <span class="badge ${st.usage.today >= st.usage.per_day ? "failed" : "scheduled"}" id="dUsage" title="${esc(t("Change in Settings → Posting schedule"))}">${esc(t("Today: {a} of {b} posts", { a: st.usage.today, b: st.usage.per_day }))}</span></p></div>
        <div class="actions"><a class="btn" href="#/batch">${icon("spark")}${esc(t("AI Batch"))}</a><a class="btn primary" href="#/compose">${icon("plus")}${esc(t("New post"))}</a></div></div>
      <div id="dBanners">${dashBanners()}</div>
      <div class="card agent-card" id="dAgent">${agentCardHtml()}</div>
      <div class="stats" id="dStats"></div>
      <div class="dash-cols">
        <div class="grid">
          <div class="card card-pad"><h2>${icon("clock")}${esc(t("Up next"))}</h2><div id="dNext"></div></div>
          <div class="card card-pad"><h2>${icon("cal")}${esc(t("Upcoming"))}<span class="sub">${esc(t("{n} scheduled", { n: upcoming.length }))}</span></h2>
            <div class="timeline" id="dUpcoming">${upcoming.slice(1, 9).map(p => `<div class="tl-item" data-act="preview" data-id="${p.id}"><div class="tl-when"><b>${esc(fmtDay(p.scheduled_at))}</b>${esc(fmtTime(p.scheduled_at))}</div><div class="tl-text">${esc(p.text)}</div></div>`).join("")
              || `<div class="empty" style="padding:16px">${esc(t(upcoming.length ? "Nothing else queued after the next post." : "Your queue is empty."))}</div>`}</div></div>
        </div>
        <div class="card card-pad"><h2>${icon("pulse")}${esc(t("Recent activity"))}<a class="sub" href="#/activity">${esc(t("View all"))}</a></h2><div id="dAct">${actList(act)}</div></div>
      </div></div>`;
    this.stats(); this.next(nxt);
    this.nextPost = nxt;
    bindPostActions(main, () => route());
    main.addEventListener("click", async e => {
      if (e.target.closest("#pauseBtn")) {
        const paused = !S.status.settings.agent_paused;
        await run(e.target.closest("#pauseBtn"), () => api("PUT", "/api/settings", { values: { agent_paused: paused } }), paused ? "Agent paused" : "Agent resumed");
        await refreshStatus();
      }
    });
  },
  stats() {
    const c = S.status.counts, bad = c.failed + c.missed;
    $("#dStats").innerHTML = [
      ["queue/scheduled", "clock", "Scheduled", c.scheduled + c.publishing, ""],
      ["queue/published", "check", "Published", c.published, ""],
      ["queue/draft", "edit", "Drafts", c.draft, ""],
      ["queue/attention", "alert", "Needs attention", bad, bad ? "alert" : ""],
    ].map(([href, ic, k, v, cls]) => `<a class="card stat ${cls}" href="#/${href}"><span class="k">${icon(ic)}${esc(t(k))}</span><span class="v">${v}</span></a>`).join("");
  },
  next(p) {
    const el = $("#dNext");
    if (!p) { el.innerHTML = `<div class="empty">${icon("send")}<div>${esc(t("Nothing scheduled yet."))}</div><div style="margin-top:12px"><a class="btn primary sm" href="#/compose">${esc(t("Write a post"))}</a></div></div>`; return; }
    el.innerHTML = `<div class="row" style="align-items:flex-start;gap:16px">
      <div style="min-width:150px"><div class="faint" style="font-size:12.5px">${esc(fmtFull(p.scheduled_at))}</div>
        <div class="countdown" style="font-size:24px" id="dCount">${countdown(p.scheduled_at)}</div>
        <div class="row" style="margin-top:10px;gap:6px"><button class="btn sm" data-act="preview" data-id="${p.id}">${icon("eye")}${esc(t("Preview"))}</button><button class="btn sm ghost" data-act="edit" data-id="${p.id}">${icon("edit")}</button></div></div>
      <div class="grow" style="white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden">${esc(p.text)}</div></div>`;
  },
  tick() {
    if (!$("#dStats")) return;
    this.stats();
    const u = S.status.usage, ub = $("#dUsage");
    if (ub) { ub.textContent = t("Today: {a} of {b} posts", { a: u.today, b: u.per_day }); ub.className = `badge ${u.today >= u.per_day ? "failed" : "scheduled"}`; }
    $("#dAgent").innerHTML = agentCardHtml();
    $("#dBanners").innerHTML = dashBanners();
    api("GET", "/api/activity?limit=10").then(a => { const el = $("#dAct"); if (el) el.innerHTML = actList(a); });
    const n = S.status.next;
    if ((n && n.id) !== (this.nextPost && this.nextPost.id)) route();
  },
  second() { const el = $("#dCount"); if (el && this.nextPost) el.textContent = countdown(this.nextPost.scheduled_at); },
};
const ACT_ICON = { success: "check", error: "x", warn: "alert", info: "info" };
function actList(rows) {
  if (!rows.length) return `<div class="empty" style="padding:16px">${esc(t("No activity yet."))}</div>`;
  return rows.map(a => `<div class="act"><span class="ic ${a.level}">${icon(ACT_ICON[a.level] || "info")}</span>
    <div class="grow">${esc(t(a.message))}${a.post_id ? ` <a href="#" data-act="preview" data-id="${a.post_id}">#${a.post_id}</a>` : ""}</div><time title="${esc(fmtFull(a.ts))}">${esc(rel(a.ts))}</time></div>`).join("");
}

// ---------- Queue ----------
const QTABS = [["all", "All", null], ["draft", "Drafts", "draft"], ["scheduled", "Scheduled", "scheduled,publishing"], ["published", "Published", "published"], ["attention", "Needs attention", "failed,missed"]];
function qItem(p, selectable) {
  const when = p.status === "published" ? p.published_at : p.scheduled_at;
  const media = p.media.length ? `<span>${icon("image")}${p.media.length}</span>` : "";
  const link = p.link ? `<span>${icon("link")}${esc(snippet(p.link.title || p.link.url, 40))}</span>` : "";
  const src = p.source !== "manual" ? `<span>${icon("spark")}${esc(t(p.source === "extension" ? "From browser" : "AI draft"))}</span>` : "";
  const A = (act, ic, label, cls = "btn sm") => `<button class="${cls}" data-act="${act}" data-id="${p.id}" title="${esc(t(label))}">${icon(ic)}${cls.includes("icon") ? "" : esc(t(label))}</button>`;
  const M = (act, ic, label, danger) => `<button data-act="${act}" data-id="${p.id}" ${danger ? 'style="color:var(--err)"' : ""}>${icon(ic)}${esc(t(label))}</button>`;
  let main = "", more = [];
  switch (p.status) {
    case "draft": main = A("schedule", "clock", "Schedule", "btn sm primary") + A("edit", "edit", "Edit", "btn sm icon ghost");
      more = [M("now", "send", "Post now"), M("preview", "eye", "Preview"), M("duplicate", "copy", "Duplicate"), M("delete", "trash", "Delete", 1)]; break;
    case "scheduled": main = A("preview", "eye", "Preview") + A("edit", "edit", "Edit", "btn sm icon ghost");
      more = [M("now", "send", "Post now"), M("unschedule", "undo", "Move to drafts"), M("duplicate", "copy", "Duplicate"), M("delete", "trash", "Delete", 1)]; break;
    case "publishing": main = `<span class="badge publishing"><span class="spinner" style="width:11px;height:11px"></span>${esc(t("Publishing"))}</span>`; break;
    case "published": main = (p.url ? `<a class="btn sm" href="${esc(p.url)}" target="_blank">${icon("ext")}${esc(t("View"))}</a>` : "") + A("preview", "eye", "Preview", "btn sm icon ghost");
      more = [M("duplicate", "copy", "Duplicate"), M("delete", "trash", "Remove from app", 1)]; break;
    default: main = A("now", "refresh", "Retry now", "btn sm primary") + A("edit", "edit", "Edit", "btn sm icon ghost");
      more = [M("schedule", "clock", "Next free slot"), M("unschedule", "undo", "Move to drafts"), M("delete", "trash", "Delete", 1)];
  }
  return `<div class="card q-item">
    ${selectable ? `<input type="checkbox" data-sel="${p.id}" aria-label="Select">` : "<span></span>"}
    <div class="q-when">${badge(p.status)}${when ? `<div><b>${esc(fmtDay(when))}</b><br>${esc(fmtTime(when))}</div>` : `<span class="faint">${esc(t("Not scheduled"))}</span>`}</div>
    <div class="q-body"><div class="q-text" data-act="preview" data-id="${p.id}">${esc(p.text) || `<i class="faint">${esc(t("(no text)"))}</i>`}</div>
      <div class="q-meta"><span>${esc(t("{n} chars", { n: p.text.length }))}</span>${media}${link}${src}${p.attempts && p.status === "scheduled" ? `<span style="color:var(--warn)">${icon("refresh")}${esc(t("Retrying ({n})", { n: p.attempts }))}</span>` : ""}</div>
      ${p.error && p.status !== "published" ? `<div class="q-err">${esc(t(p.error))}</div>` : ""}</div>
    <div class="q-actions">${main}${more.length ? `<div class="menu"><button class="btn sm icon ghost" data-menu title="${esc(t("More"))}">⋯</button><div class="menu-list" style="left:auto;right:0">${more.join("")}</div></div>` : ""}</div>
  </div>`;
}
VIEWS.queue = {
  tab: "all",
  async render(main, arg) {
    if (arg && QTABS.some(x => x[0] === arg)) this.tab = arg;
    const all = await api("GET", "/api/posts");
    const tabDef = QTABS.find(x => x[0] === this.tab);
    const posts = tabDef[2] ? all.filter(p => tabDef[2].split(",").includes(p.status)) : all;
    if (this.tab === "scheduled") posts.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const count = k => { const d = QTABS.find(x => x[0] === k); return d[2] ? all.filter(p => d[2].split(",").includes(p.status)).length : all.length; };
    const selectable = ["draft", "attention"].includes(this.tab);
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Queue"))}</h1><p>${esc(t("Every post in one place. Drafts are never published until you schedule them."))}</p></div>
        <div class="actions"><a class="btn primary" href="#/compose">${icon("plus")}${esc(t("New post"))}</a></div></div>
      <div class="tabs">${QTABS.map(([k, l]) => `<button class="${this.tab === k ? "on" : ""}" data-tab="${k}">${esc(t(l))}<span class="n">${count(k)}</span></button>`).join("")}</div>
      ${selectable && posts.length ? `<div class="bulkbar"><label class="row" style="gap:8px"><input type="checkbox" id="selAll">${esc(t("Select all"))}</label><span class="grow faint" id="selN"></span>
        <button class="btn sm primary" id="bulkSched" disabled>${icon("clock")}${esc(t("Schedule selected into next slots"))}</button><button class="btn sm danger" id="bulkDel" disabled>${icon("trash")}${esc(t("Delete"))}</button></div>` : ""}
      <div class="q-list">${posts.map(p => qItem(p, selectable)).join("") || `<div class="card empty">${icon("list")}<div>${esc(t("No posts here."))}</div></div>`}</div></div>`;
    $$("[data-tab]", main).forEach(b => b.onclick = () => { this.tab = b.dataset.tab; history.replaceState(null, "", `#/queue/${this.tab}`); this.render(main); });
    bindPostActions(main, () => this.render(main));
    const sel = () => $$("[data-sel]:checked", main).map(x => +x.dataset.sel);
    const upd = () => { const n = sel().length; if ($("#selN")) { $("#selN").textContent = n ? t("{n} selected", { n }) : ""; $("#bulkSched").disabled = $("#bulkDel").disabled = !n; } };
    main.addEventListener("change", e => {
      if (e.target.id === "selAll") $$("[data-sel]", main).forEach(x => x.checked = e.target.checked);
      upd();
    });
    const bs = $("#bulkSched");
    if (bs) {
      bs.onclick = async () => {
        const r = await run(bs, () => api("POST", "/api/posts/bulk-schedule", { ids: sel() }));
        toast(t("Scheduled {n} post(s)", { n: r.scheduled.length }));
        r.errors.forEach(x => toast(x, "err"));
        refreshStatus(); this.render(main);
      };
      $("#bulkDel").onclick = async () => {
        const ids = sel();
        if (!(await confirmBox(t("Delete {n} post(s)? This can't be undone.", { n: ids.length }), "Delete", true))) return;
        for (const id of ids) await api("DELETE", `/api/posts/${id}`);
        toast(t("Deleted")); refreshStatus(); this.render(main);
      };
    }
    this.sig = all.map(p => p.id + p.status).join();
  },
  async tick() {
    if (!$(".q-list")) return;
    const all = await api("GET", "/api/posts");
    if (all.map(p => p.id + p.status).join() !== this.sig && !$$("[data-sel]:checked").length && !$(".menu.open")) this.render($("#main"));
  },
};

// ---------- Calendar ----------
VIEWS.calendar = {
  offset: 0,
  async render(main) {
    const posts = (await api("GET", "/api/posts")).filter(p => p.scheduled_at || p.published_at);
    const now = localParts(new Date().toISOString());
    const base = new Date(Date.UTC(now.y, now.m - 1 + this.offset, 1));
    const Y = base.getUTCFullYear(), M = base.getUTCMonth();
    const first = new Date(Date.UTC(Y, M, 1)), startDow = (first.getUTCDay() + 6) % 7; // Monday first
    const days = [];
    for (let i = 0; i < 42; i++) days.push(new Date(Date.UTC(Y, M, 1 - startDow + i)));
    const byDay = {};
    posts.forEach(p => { const k = localParts(p.status === "published" && p.published_at ? p.published_at : p.scheduled_at).key; (byDay[k] = byDay[k] || []).push(p); });
    const slotDays = (S.settings.slots && S.settings.slots.days) || [];
    const title = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
    const dows = [0, 1, 2, 3, 4, 5, 6].map(i => new Intl.DateTimeFormat(locale(), { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))));
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Calendar"))}</h1><p>${esc(t("Blue bar = your posting days. Click a post to preview it."))}</p></div>
        <div class="actions"><button class="btn icon" id="calPrev" aria-label="Previous">${icon("left")}</button><button class="btn" id="calToday">${esc(t("Today"))}</button><button class="btn icon" id="calNext" aria-label="Next">${icon("right")}</button></div></div>
      <div class="row" style="margin-bottom:12px"><h2 style="margin:0;font-size:18px" class="grow">${esc(title)}</h2>
        <div class="legend"><span><i style="background:var(--primary)"></i>${esc(t("Scheduled"))}</span><span><i style="background:var(--ok)"></i>${esc(t("Published"))}</span><span><i style="background:var(--err)"></i>${esc(t("Needs attention"))}</span></div></div>
      <div class="card" style="overflow:hidden"><div class="cal">${dows.map(d => `<div class="dow">${esc(d)}</div>`).join("")}
      ${days.map((d, i) => {
        const key = d.toISOString().slice(0, 10), inMonth = d.getUTCMonth() === M, list = (byDay[key] || []).sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""));
        const isSlot = slotDays.includes(i % 7);
        return `<div class="day ${inMonth ? "" : "out"} ${key === now.key ? "today" : ""} ${isSlot ? "slot" : ""}"><div class="dn"><span>${d.getUTCDate()}</span></div>
          ${list.map(p => `<div class="ev ${p.status}" data-act="preview" data-id="${p.id}" title="${esc(snippet(p.text, 200))}">${esc(fmtTime(p.status === "published" && p.published_at ? p.published_at : p.scheduled_at))} ${esc(snippet(p.text, 40))}</div>`).join("")}</div>`;
      }).join("")}</div></div></div>`;
    $("#calPrev").onclick = () => { this.offset--; this.render(main); };
    $("#calNext").onclick = () => { this.offset++; this.render(main); };
    $("#calToday").onclick = () => { this.offset = 0; this.render(main); };
    bindPostActions(main, () => this.render(main));
  },
};

// ---------- AI Batch ----------
VIEWS.batch = {
  job: null,
  async render(main) {
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("AI Batch"))}</h1><p>${esc(t("Write one topic per line. AI drafts a post for each; you review, edit and schedule them."))}</p></div></div>
      ${S.settings.has_ai_key ? "" : `<div class="banner info">${icon("spark")}<div class="grow"><b>${esc(t("Add an AI key to write posts with AI"))}</b><span class="muted">${esc(t("Groq keys are free and need no card."))}</span></div><a class="btn sm" href="#/settings/ai">${esc(t("Add key"))}</a></div>`}
      <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.7fr);align-items:start">
        <div class="card card-pad">
          <div class="field"><label for="bTopics">${esc(t("Topics"))}</label>
            <textarea class="input" id="bTopics" rows="10" placeholder="${esc(t("e.g.\nWhy PostgreSQL VACUUM matters\n3 lessons from my first client project\nAnnouncing our new batch starting Monday"))}"></textarea>
            <span class="hint" id="bCount">${esc(t("Up to 30 topics at a time."))}</span></div>
          <button class="btn primary" id="bGo" style="width:100%">${icon("spark")}${esc(t("Generate drafts"))}</button>
          <div id="bProg" style="margin-top:14px"></div>
        </div>
        <div class="card card-pad"><h2>${icon("edit")}${esc(t("Drafts from this batch"))}<span class="sub" id="bSub"></span></h2><div id="bOut"><div class="empty" style="padding:24px">${esc(t("Generated drafts appear here. They're also saved in Queue → Drafts."))}</div></div></div>
      </div></div>`;
    const ta = $("#bTopics");
    ta.oninput = () => { const n = ta.value.split("\n").filter(x => x.trim()).length; $("#bCount").textContent = t("{n} topic(s) · up to 30 at a time", { n }); };
    $("#bGo").onclick = async () => {
      const topics = ta.value.split("\n").map(x => x.trim()).filter(Boolean);
      if (!topics.length) return toast(t("Add at least one topic."), "err");
      this.job = await run($("#bGo"), () => api("POST", "/api/ai/batch", { topics }));
      this.poll();
    };
    bindPostActions(main, () => this.showResults());
    if (this.job) this.poll();
  },
  async poll() {
    if (!$("#bProg")) return;
    const j = this.job = await api("GET", `/api/jobs/${this.job.id}`);
    $("#bProg").innerHTML = `<div class="row" style="margin-bottom:6px"><span class="grow">${esc(t(j.finished ? "Done" : "Writing drafts…"))}</span><b>${j.done}/${j.total}</b></div><div class="progress"><div style="width:${(100 * j.done / j.total).toFixed(0)}%"></div></div>
      ${j.errors.map(e => `<div class="q-err">${esc(e)}</div>`).join("")}`;
    $("#bGo").disabled = !j.finished;
    await this.showResults();
    if (!j.finished) setTimeout(() => this.poll(), 1200);
  },
  async showResults() {
    const j = this.job, out = $("#bOut"); if (!j || !out) return;
    const posts = (await Promise.all(j.post_ids.map(id => api("GET", `/api/posts/${id}`).catch(() => null)))).filter(Boolean);
    const drafts = posts.filter(p => p.status === "draft");
    $("#bSub").innerHTML = drafts.length ? `<button class="btn sm primary" id="bAll">${icon("clock")}${esc(t("Schedule all {n} into next slots", { n: drafts.length }))}</button>` : "";
    out.innerHTML = posts.map(p => qItem(p, false)).join("") || `<div class="empty" style="padding:24px"><span class="spinner"></span></div>`;
    out.className = "q-list";
    const all = $("#bAll");
    if (all) all.onclick = async () => {
      const r = await run(all, () => api("POST", "/api/posts/bulk-schedule", { ids: drafts.map(p => p.id) }));
      toast(t("Scheduled {n} post(s)", { n: r.scheduled.length })); refreshStatus(); this.showResults();
    };
  },
};

// ---------- Activity ----------
VIEWS.activity = {
  level: "",
  async render(main) {
    const rows = (await api("GET", "/api/activity?limit=300")).filter(r => !this.level || r.level === this.level);
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Activity"))}</h1><p>${esc(t("Everything the agent did, newest first."))}</p></div>
        <div class="actions"><div class="seg" id="lvl">${[["", "All"], ["success", "Published"], ["error", "Errors"], ["warn", "Warnings"], ["info", "Info"]].map(([k, l]) => `<button data-l="${k}" class="${this.level === k ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div></div></div>
      <div class="card">${rows.length ? `<table class="log-table">${rows.map(a => `<tr><td class="t">${esc(fmtFull(a.ts))}</td><td style="width:28px"><span class="act" style="padding:0;border:0"><span class="ic ${a.level}">${icon(ACT_ICON[a.level] || "info")}</span></span></td>
        <td>${esc(t(a.message))}${a.post_id ? ` <a href="#" data-act="preview" data-id="${a.post_id}">#${a.post_id}</a>` : ""}</td></tr>`).join("")}</table>` : `<div class="empty">${esc(t("No activity yet."))}</div>`}</div></div>`;
    $$("#lvl button").forEach(b => b.onclick = () => { this.level = b.dataset.l; this.render(main); });
    bindPostActions(main);
  },
};
