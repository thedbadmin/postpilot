/* Compose / edit a post with a live LinkedIn-style preview. */
const REWRITES = [["improve", "wand", "Improve writing"], ["hook", "spark", "Stronger first line"], ["shorten", "down", "Make shorter"],
  ["hashtags", "plus", "Suggest hashtags"], ["fix", "check", "Fix grammar only"], ["professional", "user", "More professional"], ["casual", "info", "More casual"]];

VIEWS.compose = {
  async render(main, id) {
    let p = { id: null, text: "", media: [], alt: "", link: null, status: "draft", scheduled_at: null };
    if (id) p = await api("GET", `/api/posts/${id}`);
    if (["published", "publishing"].includes(p.status)) { openPreviewModal(p); location.hash = "#/queue"; return; }
    this.p = p;
    this.mode = p.media.length ? "images" : p.link ? "link" : "none";
    this.when = p.status === "scheduled" ? "keep" : "slot";
    const acc = S.status.account;
    main.innerHTML = `<div class="page">
      <div class="page-head"><div><h1>${esc(t(p.id ? "Edit post" : "New post"))}</h1><p>${p.id ? `${badge(p.status)} ${p.scheduled_at ? esc(fmtFull(p.scheduled_at)) : ""}` : esc(t("Write, preview exactly how it will look, then schedule."))}</p></div></div>
      ${acc.connected ? "" : `<div class="banner warn">${icon("link")}<div class="grow"><b>${esc(t("Connect your LinkedIn account"))}</b><span class="muted">${esc(t("You can write and save drafts now, and schedule once connected."))}</span></div><a class="btn sm" href="#/settings/account">${esc(t("Connect"))}</a></div>`}
      ${p.error ? `<div class="banner err">${icon("alert")}<div class="grow"><b>${esc(t("Last attempt failed"))}</b><span>${esc(t(p.error))}</span></div></div>` : ""}
      <div class="compose">
        <div class="grid">
          <div class="card editor">
            <div class="ai-row"><input class="input" id="cTopic" placeholder="${esc(t("What should this post be about? AI will write a draft…"))}" value="${esc(p.topic || "")}">
              <button class="btn primary" id="cWrite" data-busy="Writing…">${icon("spark")}${esc(t("Write with AI"))}</button></div>
            <textarea id="cText" placeholder="${esc(t("What do you want to talk about?"))}" maxlength="3000">${esc(p.text)}</textarea>
            <div class="editor-bar">
              <div class="menu"><button class="btn sm" data-menu id="cRewriteBtn">${icon("wand")}${esc(t("Rewrite with AI"))}</button>
                <div class="menu-list up">${REWRITES.map(([k, ic, l]) => `<button data-rw="${k}">${icon(ic)}${esc(t(l))}</button>`).join("")}</div></div>
              <button class="btn sm ghost" id="cUndo" style="display:none">${icon("undo")}${esc(t("Undo AI"))}</button>
              <button class="btn sm ghost" data-mode="images">${icon("image")}${esc(t("Images"))}</button>
              <button class="btn sm ghost" data-mode="link">${icon("link")}${esc(t("Link"))}</button>
              <span class="counter" id="cCount"></span>
            </div>
          </div>
          <div class="card card-pad" id="cAttach"></div>
          <div class="card card-pad">
            <p class="section-title">${esc(t("When to publish"))}</p>
            <div class="when-opts" id="cWhen"></div>
            <div class="row" style="margin-top:16px;justify-content:flex-end">
              <button class="btn" id="cSave" data-busy="Saving…">${icon("save")}${esc(t(p.status === "scheduled" ? "Save & move to drafts" : "Save draft"))}</button>
              <button class="btn primary" id="cGo" data-busy="Saving…"></button>
            </div>
          </div>
        </div>
        <div class="sticky">
          <div class="preview-head"><b class="grow">${esc(t("Live preview"))}</b>${previewToolbar()}</div>
          <div class="preview-stage" id="cStage"></div>
          <div class="preview-note">${icon("info")}<span>${esc(t("In the feed, people see about 3 lines before “…more”. Put your hook there. Click “…more” to expand."))}</span></div>
        </div>
      </div></div>`;
    this.drawAttach(); this.drawWhen(); this.drawPreview(); this.count();
    bindPreviewToolbar(main, () => this.drawPreview());
    const ta = $("#cText");
    ta.oninput = () => { p.text = ta.value; S.dirty = true; this.count(); this.debounced(); };
    ta.addEventListener("paste", e => {
      const files = [...(e.clipboardData.files || [])].filter(f => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); this.mode = "images"; this.upload(files); }
    });
    $("#cWrite").onclick = () => this.aiWrite();
    $("#cTopic").onkeydown = e => { if (e.key === "Enter") this.aiWrite(); };
    $$("[data-rw]", main).forEach(b => b.onclick = () => this.aiRewrite(b.dataset.rw));
    $("#cUndo").onclick = () => { if (this.undo != null) { p.text = ta.value = this.undo; this.undo = null; $("#cUndo").style.display = "none"; this.count(); this.drawPreview(); } };
    $$("[data-mode]", main).forEach(b => b.onclick = () => { this.mode = b.dataset.mode; this.drawAttach(); $("#cAttach").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
    $("#cSave").onclick = () => this.save(false);
    $("#cGo").onclick = () => this.save(true);
  },
  debounced() { clearTimeout(this._t); this._t = setTimeout(() => this.drawPreview(), 120); },
  count() {
    const n = this.p.text.length, el = $("#cCount");
    el.textContent = `${n.toLocaleString()} / 3,000`;
    el.classList.toggle("over", n > 3000);
  },
  drawPreview() {
    const st = $("#cStage"); if (!st) return;
    st.classList.toggle("dark", PV.theme === "dark");
    st.innerHTML = renderPreview(this.p); bindPreview(st);
  },
  drawAttach() {
    const p = this.p, box = $("#cAttach");
    const seg = `<div class="row" style="margin-bottom:14px"><p class="section-title grow" style="margin:0">${esc(t("Attachment"))}</p>
      <div class="seg" id="cSeg">${[["none", "None"], ["images", "Images"], ["link", "Link card"]].map(([k, l]) => `<button data-m="${k}" class="${this.mode === k ? "on" : ""}">${esc(t(l))}</button>`).join("")}</div></div>`;
    let body = "";
    if (this.mode === "none") body = `<p class="hint" style="margin:0">${esc(t("Text-only post. Add images (up to 20, shown as a grid) or one link preview card."))}</p>`;
    if (this.mode === "images") {
      body = `<div class="thumbs">${p.media.map((id, i) => `<div class="thumb"><img src="${mediaUrl(id)}" alt=""><span class="n">${i + 1}</span>
          <button class="x" data-rm="${i}" title="${esc(t("Remove"))}">${icon("x")}</button>
          <div class="mv">${i > 0 ? `<button data-mv="${i}" data-d="-1" title="${esc(t("Move left"))}">${icon("left")}</button>` : ""}${i < p.media.length - 1 ? `<button data-mv="${i}" data-d="1" title="${esc(t("Move right"))}">${icon("right")}</button>` : ""}</div></div>`).join("")}
        ${p.media.length < 20 ? `<label class="drop" id="cDrop">${icon("plus")}<span>${esc(t("Add images"))}</span><small class="faint">JPG · PNG · GIF</small><input type="file" accept="image/jpeg,image/png,image/gif" multiple hidden id="cFile"></label>` : ""}</div>
        ${p.media.length ? `<div class="field" style="margin:14px 0 0"><label for="cAlt">${esc(t("Alt text (for screen readers)"))}</label><input class="input" id="cAlt" value="${esc(p.alt)}" placeholder="${esc(t("Describe the image in a few words"))}"></div>` : ""}
        ${p.media.length && p.link ? "" : ""}`;
    }
    if (this.mode === "link") {
      const L = p.link || {};
      body = `<div class="row"><input class="input grow" id="cUrl" placeholder="https://…" value="${esc(L.url || "")}"><button class="btn" id="cFetch" data-busy="Fetching…">${icon("refresh")}${esc(t("Fetch details"))}</button></div>
        ${L.url ? `<div class="two" style="margin-top:14px"><div class="field"><label>${esc(t("Card title"))}</label><input class="input" id="cLTitle" value="${esc(L.title || "")}"></div>
          <div class="field"><label>${esc(t("Description (optional)"))}</label><input class="input" id="cLDesc" value="${esc(L.desc || "")}"></div></div>
          <div class="row">${L.thumb ? `<div class="thumb" style="width:120px;aspect-ratio:1.91"><img src="${mediaUrl(L.thumb)}" alt=""><button class="x" id="cLThumbRm">${icon("x")}</button></div>` : ""}
            <label class="btn sm">${icon("image")}${esc(t(L.thumb ? "Change thumbnail" : "Add thumbnail"))}<input type="file" accept="image/jpeg,image/png,image/gif" hidden id="cLThumb"></label></div>` : `<p class="hint">${esc(t("LinkedIn doesn't read the page itself, so PostPilot fetches the title and image for you. You can edit them."))}</p>`}`;
    }
    box.innerHTML = seg + body;
    $$("#cSeg button").forEach(b => b.onclick = async () => {
      const m = b.dataset.m;
      if (m !== "images" && p.media.length && !(await confirmBox(t("Remove the attached images?"), "Remove"))) return;
      if (m !== "link" && p.link && !(await confirmBox(t("Remove the link card?"), "Remove"))) return;
      if (m !== "images") p.media = [];
      if (m !== "link") p.link = null;
      this.mode = m; S.dirty = true; this.drawAttach(); this.drawPreview();
    });
    const f = $("#cFile");
    if (f) {
      f.onchange = () => this.upload([...f.files]);
      const d = $("#cDrop");
      d.ondragover = e => { e.preventDefault(); d.classList.add("over"); };
      d.ondragleave = () => d.classList.remove("over");
      d.ondrop = e => { e.preventDefault(); d.classList.remove("over"); this.upload([...e.dataTransfer.files]); };
    }
    $$("[data-rm]", box).forEach(b => b.onclick = () => { p.media.splice(+b.dataset.rm, 1); S.dirty = true; this.drawAttach(); this.drawPreview(); });
    $$("[data-mv]", box).forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.d;[p.media[i], p.media[j]] = [p.media[j], p.media[i]]; S.dirty = true; this.drawAttach(); this.drawPreview(); });
    const alt = $("#cAlt"); if (alt) alt.oninput = () => { p.alt = alt.value; S.dirty = true; };
    const fetchBtn = $("#cFetch");
    if (fetchBtn) {
      const go = async () => {
        const url = $("#cUrl").value.trim(); if (!url) return;
        const r = await run(fetchBtn, () => api("POST", "/api/link-preview", { url }));
        p.link = { url: r.url, title: r.title, desc: r.desc, thumb: r.thumb };
        if (!r.title) toast(t("Couldn't read that page's title — please type one."), "err");
        S.dirty = true; this.drawAttach(); this.drawPreview();
      };
      fetchBtn.onclick = go;
      $("#cUrl").onkeydown = e => { if (e.key === "Enter") go(); };
      $("#cUrl").onchange = () => { if (p.link && p.link.url !== $("#cUrl").value.trim()) go(); };
    }
    [["#cLTitle", "title"], ["#cLDesc", "desc"]].forEach(([sel, k]) => { const el = $(sel); if (el) el.oninput = () => { p.link[k] = el.value; S.dirty = true; this.debounced(); }; });
    const lt = $("#cLThumb");
    if (lt) lt.onchange = async () => { const r = await this.uploadOne(lt.files[0]); if (r) { p.link.thumb = r.id; S.dirty = true; this.drawAttach(); this.drawPreview(); } };
    const ltr = $("#cLThumbRm"); if (ltr) ltr.onclick = () => { p.link.thumb = null; this.drawAttach(); this.drawPreview(); };
  },
  async uploadOne(file) {
    if (!file) return null;
    const fd = new FormData(); fd.append("file", file);
    try { return await api("POST", "/api/media", fd, true); } catch (e) { toast(`${file.name}: ${e.message}`, "err"); return null; }
  },
  async upload(files) {
    const room = 20 - this.p.media.length;
    if (files.length > room) toast(t("LinkedIn allows up to 20 images per post."), "err");
    for (const f of files.slice(0, room)) {
      const r = await this.uploadOne(f);
      if (r) { this.p.media.push(r.id); this.p.link = null; }
    }
    this.mode = "images"; S.dirty = true; this.drawAttach(); this.drawPreview();
  },
  async drawWhen() {
    const p = this.p, box = $("#cWhen");
    const slot = S.status.next_slot;
    const opts = [];
    if (p.status === "scheduled") opts.push(["keep", "clock", t("Keep current time"), fmtFull(p.scheduled_at)]);
    opts.push(["slot", "cal", t("Next free slot"), slot ? `${fmtFull(slot)} · ${rel(slot)}` : t("No posting days set — add them in Settings")]);
    opts.push(["custom", "clock", t("Pick a date & time"), `${t("Time zone")}: ${tz()}`]);
    opts.push(["now", "send", t("Post now"), t("Publishes within a few seconds")]);
    box.innerHTML = opts.map(([k, ic, title, sub]) => `<label class="opt ${this.when === k ? "on" : ""}"><input type="radio" name="when" value="${k}" ${this.when === k ? "checked" : ""}>
      <div class="grow"><b>${esc(title)}</b><small>${esc(sub)}</small>
      ${k === "custom" && this.when === "custom" ? `<input type="datetime-local" class="input" id="cDT" style="margin-top:8px;max-width:260px" value="${esc(this.dt || utcToLocalInput(p.scheduled_at || slot || new Date(Date.now() + 3600e3).toISOString()))}">` : ""}</div></label>`).join("");
    $$("input[name=when]", box).forEach(r => r.onchange = () => { this.when = r.value; this.drawWhen(); });
    const dt = $("#cDT"); if (dt) { this.dt = dt.value; dt.onchange = () => { this.dt = dt.value; }; }
    const label = { keep: "Save changes", slot: "Schedule", custom: "Schedule", now: "Post now" }[this.when];
    $("#cGo").innerHTML = `${icon(this.when === "now" ? "send" : "clock")}${esc(t(label))}`;
  },
  async aiWrite() {
    const topic = $("#cTopic").value.trim();
    if (!topic) { $("#cTopic").focus(); return toast(t("Type a topic first."), "err"); }
    if (this.p.text.trim() && !(await confirmBox(t("Replace your current text with a new AI draft?"), "Replace"))) return;
    const r = await run($("#cWrite"), () => api("POST", "/api/ai/draft", { topic }));
    this.undo = this.p.text; $("#cUndo").style.display = this.undo ? "" : "none";
    this.p.text = $("#cText").value = r.text; this.p.topic = topic; S.dirty = true;
    this.count(); this.drawPreview();
  },
  async aiRewrite(action) {
    if (!this.p.text.trim()) return toast(t("Write or generate some text first."), "err");
    $$(".menu.open").forEach(m => m.classList.remove("open"));
    const r = await run($("#cRewriteBtn"), () => api("POST", "/api/ai/rewrite", { text: this.p.text, action }));
    this.undo = this.p.text; $("#cUndo").style.display = "";
    this.p.text = $("#cText").value = r.text; S.dirty = true;
    this.count(); this.drawPreview();
  },
  async save(andSchedule) {
    const p = this.p, btn = andSchedule ? $("#cGo") : $("#cSave");
    if (p.link) { p.link.title = (p.link.title || "").trim(); if (!p.link.url) p.link = null; }
    if (p.link && !p.link.title) return toast(t("Give the link card a title."), "err");
    let when = null;
    if (andSchedule) {
      if (this.when === "custom") {
        if (!this.dt) return toast(t("Pick a date and time."), "err");
        when = zonedToUtc(this.dt);
        if (new Date(when) < Date.now()) return toast(t("That time is in the past."), "err");
      } else when = this.when === "slot" ? "next_slot" : this.when;
      if (when === "now" && !(await confirmBox(t("Publish this post to LinkedIn right now?"), "Post now"))) return;
    }
    const body = { text: p.text, media: p.media, alt: p.alt, link: p.link, topic: p.topic || null };
    try {
      await run(btn, async () => {
        let saved = p.id ? await api("PUT", `/api/posts/${p.id}`, body) : await api("POST", "/api/posts", body);
        p.id = saved.id; p.status = saved.status;   // so a failed schedule step doesn't create a duplicate on retry
        if (!andSchedule && saved.status === "scheduled") saved = await api("POST", `/api/posts/${saved.id}/unschedule`);
        if (andSchedule && when !== "keep") saved = await api("POST", `/api/posts/${saved.id}/schedule`, { when });
        S.dirty = false;
        this.p = saved;
        toast(!andSchedule ? t("Saved to drafts") : when === "now" ? t("Publishing now…") : when === "keep" ? t("Changes saved") : t("Scheduled for {v}", { v: fmtFull(saved.scheduled_at) }));
      });
      await refreshStatus();
      location.hash = andSchedule ? "#/queue/scheduled" : "#/queue/draft";
    } catch (_) { /* toast already shown */ }
  },
};
