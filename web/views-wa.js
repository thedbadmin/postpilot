/* WhatsApp agent tab: the bot answers routine questions on the company number and sends urgent ones to the boss. */
IC.wa = '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.3Z"/><path d="M9 8.5c0 3.6 2.9 6.5 6.5 6.5l1-1.6-2.2-1-1 .9a4.5 4.5 0 0 1-2.2-2.2l.9-1-1-2.2Z"/>';
IC.bot = '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5"/>';

const WA_NAV = [["", "home", "Overview"], ["inbox", "wa", "Inbox"], ["bot", "bot", "Bot knowledge"], ["settings", "gear", "Settings"]];
const WA_STATUS = { bot: ["published", "Bot replying"], escalated: ["failed", "Needs the boss"], human: ["scheduled", "Boss handling"] };
const WHO = { customer: "Customer", bot: "Bot", boss: "Team" };
const waBadge = st => { const [cls, label] = WA_STATUS[st] || ["draft", st]; return `<span class="badge ${cls}">${esc(t(label))}</span>`; };
const waNum = c => (/^\d+$/.test(c) ? "+" : "") + c;
const waSub = () => location.hash.split("/")[2] || "";

// ---------- shell (core.js calls these while the WhatsApp tab is open) ----------
function renderWaNav() {
  const sub = waSub();
  $("#nav").innerHTML = WA_NAV.map(([r, ic, label]) => {
    const n = r === "inbox" && S.wa && S.wa.counts.open ? `<span class="count alert">${S.wa.counts.open}</span>` : "";
    return `<a href="#/wa${r ? "/" + r : ""}" class="${sub === r ? "active" : ""}">${icon(ic)}<span>${esc(t(label))}</span>${n}</a>`;
  }).join("") + tabLinks();
}
function waAgentInfo() {
  const g = S.wa;
  if (!g) return { cls: "", title: "…", sub: "" };
  if (!g.account.connected) return { cls: "warn", title: t("WhatsApp not connected"), sub: t("Add your Kapso key in Settings"), state: "noacct" };
  if (g.agent.paused) return { cls: "warn", title: t("Bot paused"), sub: t("Nobody gets auto-replies"), state: "paused" };
  if (g.agent.last_error) return { cls: "err", title: t("Needs attention"), sub: snippet(g.agent.last_error, 40), state: "error" };
  return { cls: "ok", title: t("Bot running"), sub: g.agent.last_tick ? t("Checked {v}", { v: rel(g.agent.last_tick) }) : t("Starting…"), state: "ok" };
}
function renderWaSidebar() {
  renderWaNav();
  document.title = "PostPilot · WhatsApp";
  const a = waAgentInfo(), acc = S.wa && S.wa.account;
  $("#agentPill").innerHTML = `<i class="dot ${a.cls}"></i><div><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></div>`;
  $("#me").innerHTML = acc && acc.connected
    ? `<div class="li-av wa" style="width:32px;height:32px">${icon("wa")}</div><div class="who"><b>${esc(acc.name || acc.number)}</b><small>${esc(acc.number)}</small></div>`
    : `<a class="btn sm" href="#/wa/settings" style="width:100%">${icon("wa")}${esc(t("Connect WhatsApp"))}</a>`;
  $$("#lang button").forEach(b => b.classList.toggle("on", b.dataset.l === lang()));
}

// ---------- pieces ----------
function waBanners() {
  const g = S.wa, s = g.settings, out = [];
  if (!g.account.connected) out.push(["warn", "wa", t("Connect the company WhatsApp"), t("One-time setup through Kapso (free plan); the boss keeps using the Business app."), `<a class="btn primary sm" href="#/wa/settings">${esc(t("Connect"))}</a>`]);
  if (!s.wa_knowledge.trim()) out.push(["warn", "bot", t("The bot knows nothing yet"), t("Add your courses, fees, batches and timings, or it will pass every question to the boss."), `<a class="btn sm" href="#/wa/bot">${esc(t("Add"))}</a>`]);
  if (!s.wa_boss.trim()) out.push(["err", "user", t("No number to alert"), t("Add the boss's WhatsApp number so urgent chats reach him."), `<a class="btn sm" href="#/wa/settings">${esc(t("Settings"))}</a>`]);
  if (g.agent.note) out.push(["info", "info", g.agent.note, "", ""]);
  if (g.counts.open) out.push(["err", "alert", t("{n} chat(s) waiting for the boss", { n: g.counts.open }), t("The bot told them a person will reply."), `<a class="btn sm" href="#/wa/inbox">${esc(t("Open"))}</a>`]);
  return out.map(([k, ic, title, sub, act]) => `<div class="banner ${k}">${icon(ic)}<div class="grow"><b>${esc(title)}</b>${sub ? `<span class="muted">${esc(sub)}</span>` : ""}</div>${act}</div>`).join("");
}
function waAgentCard() {
  const g = S.wa, a = waAgentInfo(), paused = g.agent.paused;
  const desc = a.state === "noacct" ? t("Connect the company number in Settings to start.")
    : paused ? t("Messages still arrive in the Business app; the bot just doesn't answer.")
    : a.state === "error" ? g.agent.last_error
    : t("Answers routine questions within seconds and sends urgent chats to the boss.");
  const dot = a.state === "error" ? "down" : paused || a.state === "noacct" ? "paused" : "";
  return `<div class="big-dot ${dot}">${icon(paused ? "pause" : a.state === "ok" ? "check" : "alert")}</div>
    <div class="grow"><h3>${esc(a.title)}${a.state === "ok" ? ` <span class="faint" style="font-weight:400;font-size:13px">· ${esc(a.sub)}</span>` : ""}</h3><p>${esc(desc)}</p></div>
    ${g.account.connected ? `<button class="btn" id="wCheck">${icon("refresh")}${esc(t("Check now"))}</button><button class="btn" id="wPause">${icon(paused ? "play" : "pause")}${esc(t(paused ? "Resume" : "Pause"))}</button>`
      : `<a class="btn primary" href="#/wa/settings">${icon("wa")}${esc(t("Connect WhatsApp"))}</a>`}`;
}
function waStats() {
  const c = S.wa.counts;
  return [["wa/inbox", "wa", "Chats today", c.chats_today, ""], ["wa/inbox", "bot", "Bot replies today", c.replies_today, ""],
    ["wa/inbox", "alert", "Sent to the boss today", c.escalated_today, ""], ["wa/inbox", "clock", "Waiting for the boss", c.open, c.open ? "alert" : ""]]
    .map(([href, ic, k, v, cls]) => `<a class="card stat ${cls}" href="#/${href}"><span class="k">${icon(ic)}${esc(t(k))}</span><span class="v">${v}</span></a>`).join("");
}
function waChatList(rows, cur) {
  if (!rows.length) return `<div class="empty" style="padding:16px">${esc(t("No chats yet."))}</div>`;
  return rows.map(c => `<a class="wa-row ${c.contact === cur ? "on" : ""}" href="#/wa/inbox/${encodeURIComponent(c.contact)}">
    <div class="li-av wa">${esc(initials(c.name || "?"))}</div>
    <div class="grow" style="min-width:0"><div class="row" style="gap:8px"><b class="wa-name">${esc(c.name || waNum(c.contact))}</b>${waBadge(c.status)}<time class="faint">${esc(rel(c.updated_at))}</time></div>
      <div class="muted wa-last">${c.last_sender && c.last_sender !== "customer" ? `${esc(t(WHO[c.last_sender]))}: ` : ""}${esc(snippet(c.last_text, 70))}</div>
      ${c.status === "escalated" && c.summary ? `<div class="q-err">${esc(c.summary)}</div>` : ""}</div></a>`).join("");
}
function waHowCard() {
  return `<div class="card card-pad"><h2>${icon("info")}${esc(t("How it works"))}</h2><ol class="steps">
    <li>${esc(t("Someone messages the company WhatsApp. Within seconds the bot answers from Bot knowledge, in English, Hindi or Hinglish."))}</li>
    <li>${esc(t("Payments, complaints, access problems, “I want to talk to the owner”, or anything the bot doesn't know: it tells them a person will reply and alerts the boss on his own WhatsApp."))}</li>
    <li>${esc(t("Once the boss replies in a chat (Business app), the bot stays out of it for {h} hours.", { h: S.wa.limits.human_hours }))}</li></ol>
    <p class="hint" style="margin-bottom:0">${esc(t("Every reply also shows up in the boss's Business app, so nothing is hidden from him."))}</p></div>`;
}
function waSimCard() {
  const sent = S.wa.demo_sent.filter(m => m.to === (S.wa.settings.wa_boss || "").replace(/\D/g, ""));
  return `<div class="card card-pad"><h2>${icon("spark")}${esc(t("Try it (demo mode)"))}</h2>
    <p class="muted" style="margin-top:0">${esc(t("Pretend a customer messages the company number. Demo mode never talks to WhatsApp. Words like “refund”, “payment” or “urgent” go to the boss."))}</p>
    ${S.wa.account.connected ? `<div class="two"><div class="field"><label for="simName">${esc(t("Customer name"))}</label><input class="input" id="simName" value="Rahul"></div>
      <div class="field"><label for="simNum">${esc(t("Their number"))}</label><input class="input" id="simNum" value="+91 98111 22233"></div></div>
    <div class="field"><label for="simText">${esc(t("Message"))}</label><input class="input" id="simText" value="Hi, next batch kab start hoga?"></div>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" id="simGo">${icon("send")}${esc(t("Customer sends"))}</button>
      <button class="btn" id="simBoss">${icon("user")}${esc(t("Boss replies from the app"))}</button></div>
    ${sent.length ? `<h3 style="margin:16px 0 6px;font-size:14px">${esc(t("Alerts the boss got"))}</h3>${sent.slice(0, 3).map(m => `<div class="wa-alert">${esc(m.text)}</div>`).join("")}` : ""}`
    : `<div class="empty" style="padding:12px">${esc(t("Connect first (any text of 16+ characters works in demo mode)."))}</div>`}</div>`;
}

// ---------- view ----------
VIEWS.wa = {
  async render(main) {
    S.wa = await api("GET", "/api/wa/status");
    renderSidebar();
    this.sub = ["inbox", "bot", "settings"].includes(waSub()) ? waSub() : "";
    main.onclick = main.onchange = main.onsubmit = null;
    await this[this.sub || "overview"](main);
  },
  async overview(main) {
    const rows = await api("GET", "/api/wa/chats?limit=8");
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("WhatsApp agent"))}</h1><p>${esc(t("Routine questions get answered automatically; only urgent chats reach the boss."))}${S.wa.mock ? ` <span class="badge publishing">${esc(t("DEMO MODE"))}</span>` : ""}</p></div>
        <div class="actions"><a class="btn primary" href="#/wa/bot">${icon("bot")}${esc(t("Bot knowledge"))}</a></div></div>
      <div id="wBanners">${waBanners()}</div>
      <div class="card agent-card" id="wAgent">${waAgentCard()}</div>
      <div class="stats" id="wStats">${waStats()}</div>
      <div class="dash-cols">
        <div class="card card-pad"><h2>${icon("wa")}${esc(t("Latest chats"))}<a class="sub" href="#/wa/inbox">${esc(t("View all"))}</a></h2><div id="wChats">${waChatList(rows)}</div></div>
        <div id="wSide">${S.wa.mock ? waSimCard() : waHowCard()}</div>
      </div></div>`;
    main.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "wCheck") { await run(b, () => api("POST", "/api/wa/check"), "Checking for new messages…"); setTimeout(refreshStatus, 2500); }
      if (b.id === "wPause") {
        const paused = !S.wa.agent.paused;
        await run(b, () => api("POST", "/api/wa/pause", { paused }), paused ? "Bot paused" : "Bot resumed");
        await refreshStatus();
      }
      if (b.id === "simGo" || b.id === "simBoss") {
        const boss = b.id === "simBoss";
        await run(b, () => api("POST", "/api/wa/simulate", { name: $("#simName").value, contact: $("#simNum").value, as_boss: boss,
          text: boss ? "Hi Rahul, I'll call you in 10 minutes." : $("#simText").value }), boss ? "The boss replied. The bot steps back." : "Message sent. The bot answers in about 10 seconds.");
        setTimeout(refreshStatus, 2000); setTimeout(refreshStatus, 12000);
      }
    };
  },
  async inbox(main) {
    const cur = decodeURIComponent(location.hash.split("/")[3] || "");
    this.filter = this.filter || "";
    const [rows, ch] = await Promise.all([api("GET", `/api/wa/chats?status=${this.filter}`), cur ? api("GET", `/api/wa/chats/${encodeURIComponent(cur)}`).catch(() => null) : null]);
    this.sig = JSON.stringify(rows.map(r => r.contact + r.updated_at + r.status)) + (ch ? ch.messages.length + ch.status : "");
    const tabs = [["", "All"], ["escalated", "Needs the boss"], ["human", "Boss handling"], ["bot", "Bot replying"]];
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Inbox"))}</h1><p>${esc(t("Every chat on the company number and who is handling it."))}</p></div>
        <div class="seg" id="wFilter">${tabs.map(([k, l]) => `<button data-f="${k}" class="${this.filter === k ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div></div>
      <div class="wa-inbox ${ch ? "open" : ""}"><div class="card wa-list">${waChatList(rows, cur)}</div>
        <div class="card wa-thread">${ch ? this.thread(ch) : `<div class="empty">${icon("wa")}<div>${esc(t("Pick a chat to read it."))}</div></div>`}</div></div></div>`;
    const box = $(".wa-msgs", main); if (box) box.scrollTop = box.scrollHeight;
    main.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.f !== undefined) { this.filter = b.dataset.f; return this.inbox(main); }
      if (b.dataset.st) {
        await run(b, () => api("POST", `/api/wa/chats/${encodeURIComponent(cur)}/status`, { status: b.dataset.st }), b.dataset.st === "bot" ? "The bot answers this chat again" : "The bot stays out of this chat");
        refreshStatus(); this.inbox(main);
      }
    };
    main.onsubmit = async e => {
      e.preventDefault();
      const inp = $("#wSend"), text = inp.value.trim(); if (!text) return;
      try { await run($("#wSendBtn"), () => api("POST", `/api/wa/chats/${encodeURIComponent(cur)}/send`, { text }), "Sent"); } catch (_) { return; }
      this.inbox(main);
    };
  },
  thread(ch) {
    const act = ch.status === "bot"
      ? `<button class="btn sm" data-st="human">${icon("user")}${esc(t("Take over"))}</button>`
      : `<button class="btn sm primary" data-st="bot">${icon("bot")}${esc(t(ch.status === "escalated" ? "Resolved: back to bot" : "Hand back to bot"))}</button>`;
    return `<div class="wa-head"><a class="btn sm icon ghost wa-back" href="#/wa/inbox" title="${esc(t("Back"))}">${icon("x")}</a>
        <div class="li-av wa">${esc(initials(ch.name || "?"))}</div>
        <div class="grow"><b>${esc(ch.name || waNum(ch.contact))}</b><div class="faint">${esc(waNum(ch.contact))} ${waBadge(ch.status)}</div></div>${act}</div>
      ${ch.status === "escalated" ? `<div class="banner err" style="margin:0 14px">${icon("alert")}<div class="grow"><b>${esc(ch.summary || t("Needs the boss"))}</b><span class="muted">${esc([ch.reason, ch.alert].filter(Boolean).join(" · "))}</span></div></div>` : ""}
      ${ch.error ? `<div class="banner warn" style="margin:8px 14px 0">${icon("alert")}<div class="grow">${esc(ch.error)}</div></div>` : ""}
      <div class="wa-msgs">${ch.messages.map(m => `<div class="wa-msg ${m.sender}"><div>${esc(m.text)}</div><small>${esc(t(WHO[m.sender] || m.sender))} · ${esc(fmtTime(m.created_at))}</small></div>`).join("")}</div>
      <form class="wa-compose"><input class="input grow" id="wSend" placeholder="${esc(t("Reply as the team (the bot then stays out)…"))}" autocomplete="off"><button class="btn primary" id="wSendBtn">${icon("send")}</button></form>`;
  },
  async bot(main) {
    const s = S.wa.settings;
    this.test = this.test || [];
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("Bot knowledge"))}</h1><p>${esc(t("The bot only uses what you write here. Anything else goes to the boss."))}</p></div></div>
      <div class="dash-cols">
        <section class="card card-pad">
          <div class="field"><label for="wBiz">${esc(t("Company name"))}</label><input class="input" id="wBiz" value="${esc(s.wa_business)}" placeholder="TheDBAdmin Training"></div>
          <div class="field"><label for="wKnow">${esc(t("Facts and FAQ"))}</label><textarea class="input" id="wKnow" rows="16" placeholder="${esc(S.wa.example_knowledge)}">${esc(s.wa_knowledge)}</textarea>
            <span class="hint">${esc(t("Courses, fees, next batches, timings, demo class, how to enrol, links, office hours. Plain sentences are fine."))} <a href="#" id="wEx">${esc(t("Start from an example"))}</a></span></div>
          <div class="field"><label for="wRules">${esc(t("Also always send to the boss (optional)"))}</label><textarea class="input" id="wRules" rows="3" placeholder="${esc(t("e.g. discount requests, job or internship enquiries, anyone from a company asking for team training"))}">${esc(s.wa_rules)}</textarea>
            <span class="hint">${esc(t("Already built in: payments and refunds, complaints, access or class problems, certificate issues, asking for the owner or a call, legal threats, and anything the facts don't answer."))}</span></div>
          <button class="btn primary" id="wSave">${icon("save")}${esc(t("Save"))}</button>
        </section>
        <section class="card card-pad"><h2>${icon("bot")}${esc(t("Try the bot"))}</h2>
          <p class="muted" style="margin-top:0">${esc(t("Write as a customer. Nothing is sent to anyone. Save first so it uses your latest facts."))}</p>
          <div class="wa-msgs test" id="wTest">${this.testHtml()}</div>
          <form class="wa-compose" id="wTestForm"><input class="input grow" id="wTestIn" placeholder="${esc(t("e.g. Fees kitni hai DBA course ki?"))}" autocomplete="off"><button class="btn primary" id="wTestBtn">${icon("send")}</button></form>
          <button class="btn sm ghost" id="wTestClear" style="margin-top:8px">${esc(t("Start over"))}</button>
        </section></div></div>`;
    $("#wEx").onclick = e => { e.preventDefault(); if (!$("#wKnow").value.trim()) $("#wKnow").value = S.wa.example_knowledge; $("#wKnow").focus(); };
    main.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "wSave") {
        const values = { wa_business: $("#wBiz").value, wa_knowledge: $("#wKnow").value, wa_rules: $("#wRules").value };
        try { const r = await run(b, () => api("PUT", "/api/wa/settings", { values }), "Saved"); Object.assign(S.wa.settings, r); } catch (_) { /* toast shown */ }
      }
      if (b.id === "wTestClear") { this.test = []; $("#wTest").innerHTML = this.testHtml(); }
    };
    main.onsubmit = async e => {
      e.preventDefault();
      const text = $("#wTestIn").value.trim(); if (!text) return;
      this.test.push({ sender: "customer", text }); $("#wTestIn").value = ""; $("#wTest").innerHTML = this.testHtml();
      try {
        const d = await run($("#wTestBtn"), () => api("POST", "/api/wa/test", { messages: this.test.map(({ sender, text }) => ({ sender, text })) }));
        this.test.push({ sender: "bot", text: d.reply, d });
      } catch (_) { this.test.pop(); }
      $("#wTest").innerHTML = this.testHtml(); const box = $("#wTest"); box.scrollTop = box.scrollHeight;
    };
  },
  testHtml() {
    if (!this.test.length) return `<div class="empty" style="padding:12px">${esc(t("Your test chat appears here."))}</div>`;
    return this.test.map(m => `<div class="wa-msg ${m.sender}"><div>${esc(m.text)}</div>${m.d && m.d.action === "escalate"
      ? `<small class="wa-esc">${icon("alert")}${esc(t("Sent to the boss"))}: ${esc(m.d.summary || m.d.reason)}</small>` : ""}</div>`).join("");
  },
  async settings(main) {
    const g = S.wa, acc = g.account, s = g.settings;
    const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span></span></label>`;
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t("WhatsApp settings"))}</h1></div></div>
      <section class="card set-sec"><h2>${icon("wa")} ${esc(t("Company WhatsApp number"))}</h2>
        ${acc.connected ? `<div class="acct"><div class="li-av wa">${icon("wa")}</div>
            <div class="grow"><b>${esc(acc.name)}</b><div class="muted">${esc(acc.number)}${acc.coexistence ? " · " + esc(t("Business app still works on the phone")) : ""}</div></div>
            <button class="btn ghost danger" id="wDisc">${esc(t("Disconnect"))}</button></div>`
          : `<p class="muted">${esc(t("Kapso is an official Meta partner. It connects the Business app number to WhatsApp's API while the boss keeps using the app (“coexistence”). Free plan: 2,000 messages a month."))}</p>
            <ol class="steps"><li>${esc(t("Sign up at app.kapso.ai → Connected numbers → Connect new number → WhatsApp Business App."))}</li>
              <li>${esc(t("Enter the company number, then scan the QR code with the Business app on the boss's phone (WhatsApp Business app must be up to date)."))}</li>
              <li>${esc(t("In Kapso: Integrations → API keys → create a key, and paste it here."))}</li></ol>
            <div class="row" style="margin-top:12px;flex-wrap:wrap"><input class="input mono grow" type="password" id="wKey" placeholder="${esc(t("Kapso API key"))}" autocomplete="off">
              <input class="input mono" id="wPnid" placeholder="${esc(t("Phone number ID (only if several)"))}" style="width:240px"><button class="btn primary" id="wConnect" data-busy="Checking…">${icon("link")}${esc(t("Connect"))}</button></div>
            ${g.mock ? `<span class="hint">${esc(t("Demo mode: any text of 16+ characters works."))}</span>` : ""}`}
      </section>
      <section class="card set-sec"><h2>${icon("user")} ${esc(t("Urgent alerts to the boss"))}</h2>
        <div class="field"><label for="wBoss">${esc(t("Boss's personal WhatsApp number"))}</label><input class="input" id="wBoss" value="${esc(s.wa_boss)}" placeholder="+91 98765 43210">
          <span class="hint">${esc(t("Must be a different number from the company one. With country code."))}</span></div>
        <p class="muted">${esc(t("WhatsApp only allows a free message if the boss wrote to the company number in the last 24 hours. Otherwise PostPilot sends an approved template (Meta charges a small fee for each one). Create it once in WhatsApp Manager → Message templates:"))}</p>
        <div class="wa-tpl"><div><b>${esc(t("Category"))}:</b> Utility · <b>${esc(t("Language"))}:</b> English</div>
          <div><b>${esc(t("Body"))}:</b> <span class="mono">Urgent customer message from {{1}}: {{2}}. Please reply to them from the company WhatsApp.</span></div></div>
        <div class="two"><div class="field"><label for="wTpl">${esc(t("Template name"))}</label><input class="input mono" id="wTpl" value="${esc(s.wa_template)}"></div>
          <div class="field"><label for="wLang">${esc(t("Template language code"))}</label><input class="input mono" id="wLang" value="${esc(s.wa_template_lang)}"></div></div>
        <div class="row" style="gap:8px"><button class="btn primary" id="wSaveBoss">${icon("save")}${esc(t("Save"))}</button><button class="btn" id="wTestAlert" ${acc.connected ? "" : "disabled"}>${icon("send")}${esc(t("Send a test alert"))}</button></div>
      </section>
      <section class="card set-sec"><h2>${esc(t("Bot"))}</h2>
        <div class="set-row"><div class="grow"><b>${esc(t("Pause the bot"))}</b><small>${esc(t("Messages still arrive in the Business app; nobody gets auto-replies."))}</small></div>${sw("wPauseSw", g.agent.paused)}</div>
        <div class="set-row"><div class="grow"><b>${esc(t("Safety limits"))}</b><small>${esc(t("At most {c} bot replies per chat an hour (then the boss is asked) and {h} in total. The bot stays out of a chat for {b} h after the boss writes there; unanswered urgent chats return to the bot after {e} h.", { c: g.limits.per_chat, h: g.limits.per_hour, b: g.limits.human_hours, e: g.limits.escalated_hours }))}</small></div></div>
      </section></div>`;
    main.onclick = async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "wConnect") {
        const api_key = $("#wKey").value.trim(); if (!api_key) return toast(t("Paste the API key first."), "err");
        try { await run(b, () => api("POST", "/api/wa/connect", { api_key, phone_number_id: $("#wPnid").value }), "WhatsApp connected"); } catch (_) { return; }
        this.render(main);
      }
      if (b.id === "wDisc" && await confirmBox(t("Disconnect WhatsApp? The bot stops answering until you connect again. The Business app keeps working."), "Disconnect", true)) {
        await api("POST", "/api/wa/disconnect"); toast(t("Disconnected")); this.render(main);
      }
      if (b.id === "wSaveBoss") {
        const values = { wa_boss: $("#wBoss").value, wa_template: $("#wTpl").value, wa_template_lang: $("#wLang").value };
        try { const r = await run(b, () => api("PUT", "/api/wa/settings", { values }), "Saved"); Object.assign(S.wa.settings, r); } catch (_) { /* toast shown */ }
      }
      if (b.id === "wTestAlert") { try { const r = await run(b, () => api("POST", "/api/wa/test-alert")); toast(t(r.result)); } catch (_) { /* toast shown */ } }
    };
    main.onchange = async e => {
      if (e.target.id !== "wPauseSw") return;
      await api("POST", "/api/wa/pause", { paused: e.target.checked });
      toast(t(e.target.checked ? "Bot paused" : "Bot resumed")); refreshStatus();
    };
  },
  async tick() {
    if (this.sub === "" && $("#wStats")) {
      $("#wStats").innerHTML = waStats(); $("#wAgent").innerHTML = waAgentCard(); $("#wBanners").innerHTML = waBanners();
      const rows = await api("GET", "/api/wa/chats?limit=8"), el = $("#wChats");
      if (el) el.innerHTML = waChatList(rows);
      if (S.wa.mock && $("#wSide") && !$("#wSide").contains(document.activeElement)) $("#wSide").innerHTML = waSimCard();
    } else if (this.sub === "inbox" && $(".wa-inbox") && !($("#wSend") && $("#wSend").value)) {
      const cur = decodeURIComponent(location.hash.split("/")[3] || "");
      const [rows, ch] = await Promise.all([api("GET", `/api/wa/chats?status=${this.filter}`), cur ? api("GET", `/api/wa/chats/${encodeURIComponent(cur)}`).catch(() => null) : null]);
      if (JSON.stringify(rows.map(r => r.contact + r.updated_at + r.status)) + (ch ? ch.messages.length + ch.status : "") !== this.sig) this.inbox($("#main"));
    }
  },
};
