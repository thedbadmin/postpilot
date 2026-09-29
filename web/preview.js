/* LinkedIn-style feed preview. Shows the post as it will appear in the feed, including
   the ~3-line "…more" cut, image grid layouts and the link card. */
const PV = { device: "desktop", theme: "light" };

function formatPostText(text) {
  let h = esc(text);
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<span class="url">$1</span>');
  h = h.replace(/(^|[\s(])#([\p{L}\p{N}_]+)/gu, '$1<span class="tag">#$2</span>');
  return h;
}

const LI_ICONS = {
  globe: '<svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm4.9 6h-2A10.7 10.7 0 0 0 9.8 2.3 5.5 5.5 0 0 1 12.9 7ZM8 13.4A9.3 9.3 0 0 1 6.6 9h2.8A9.3 9.3 0 0 1 8 13.4ZM6.6 7A9.3 9.3 0 0 1 8 2.6 9.3 9.3 0 0 1 9.4 7ZM6.2 2.3A10.7 10.7 0 0 0 5.1 7h-2a5.5 5.5 0 0 1 3.1-4.7ZM3.1 9h2a10.7 10.7 0 0 0 1.1 4.7A5.5 5.5 0 0 1 3.1 9Zm6.7 4.7A10.7 10.7 0 0 0 10.9 9h2a5.5 5.5 0 0 1-3.1 4.7Z"/></svg>',
  like: '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9Zm0 0 4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7"/></svg>',
  comment: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
  repost: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
};

function renderPreview(post, opts = {}) {
  const device = opts.device || PV.device, theme = opts.theme || PV.theme;
  const acc = (S.status && S.status.account) || {};
  const name = acc.name || t("Your Name");
  const headline = (S.settings && S.settings.profile_headline) || t("Your headline");
  const av = acc.picture ? `<img src="${esc(acc.picture)}" alt="">` : esc(initials(name));
  const when = post.status === "published" && post.published_at ? rel(post.published_at).replace(/ ago$/, "")
    : post.scheduled_at ? t("Now") : t("Now");
  const text = (post.text || "").trim();
  const media = post.media || [];
  let mediaHtml = "";
  if (media.length) {
    const n = Math.min(media.length, 5), cls = `n${n}`;
    const shown = media.slice(0, n);
    mediaHtml = `<div class="li-media ${cls}">${shown.map((id, i) => {
      const extra = i === n - 1 && media.length > n ? `<div class="plus">+${media.length - n}</div>` : "";
      return n === 1 ? `<img src="${mediaUrl(id)}" alt="">` : `<div style="position:relative"><img src="${mediaUrl(id)}" alt="">${extra}</div>`;
    }).join("")}</div>`;
  } else if (post.link && post.link.url) {
    const L = post.link;
    let domain = ""; try { domain = new URL(L.url).hostname.replace(/^www\./, ""); } catch (e) { domain = L.url; }
    mediaHtml = L.thumb
      ? `<div class="li-link"><img src="${mediaUrl(L.thumb)}" alt=""><div class="meta"><div class="t">${esc(L.title || L.url)}</div><div class="d">${esc(domain)}</div></div></div>`
      : `<div class="li-link row"><div class="ph">${icon("link")}</div><div class="meta"><div class="t">${esc(L.title || L.url)}</div><div class="d">${esc(domain)}</div></div></div>`;
  }
  return `<div class="li ${device === "mobile" ? "mobile" : ""} ${theme === "dark" ? "dark" : ""}">
    <div class="li-head"><div class="li-av">${av}</div>
      <div class="grow"><div class="li-name">${esc(name)} <span>• ${esc(t("You"))}</span></div>
        <div class="li-sub">${esc(headline)}</div>
        <div class="li-sub">${esc(when)} • ${LI_ICONS.globe}</div></div></div>
    <div class="li-text"><div class="body clamp">${text ? formatPostText(text) : `<span class="empty-text">${esc(t("Start writing to see your post here…"))}</span>`}</div><button class="more hidden" type="button">…${esc(t("more"))}</button></div>
    ${mediaHtml}
    <div class="li-stats"><span>👍 ❤️ 12</span><span>3 ${esc(t("comments"))}</span></div>
    <div class="li-actions"><span>${LI_ICONS.like}${esc(t("Like"))}</span><span>${LI_ICONS.comment}${esc(t("Comment"))}</span><span>${LI_ICONS.repost}${esc(t("Repost"))}</span><span>${LI_ICONS.send}${esc(t("Send"))}</span></div>
  </div>`;
}

function bindPreview(root) {
  $$(".li-text", root).forEach(box => {
    const body = $(".body", box), more = $(".more", box);
    requestAnimationFrame(() => {
      const cut = body.scrollHeight > body.clientHeight + 1;
      more.classList.toggle("hidden", !cut);
      more.onclick = () => { body.classList.remove("clamp"); more.classList.add("hidden"); };
    });
  });
}

function previewToolbar() {
  return `<div class="seg" data-pv="device"><button data-v="desktop" class="${PV.device === "desktop" ? "on" : ""}">${icon("monitor")}${esc(t("Desktop"))}</button><button data-v="mobile" class="${PV.device === "mobile" ? "on" : ""}">${icon("phone")}${esc(t("Mobile"))}</button></div>
    <div class="seg" data-pv="theme"><button data-v="light" class="${PV.theme === "light" ? "on" : ""}" title="${esc(t("Light"))}">${icon("sun")}</button><button data-v="dark" class="${PV.theme === "dark" ? "on" : ""}" title="${esc(t("Dark"))}">${icon("moon")}</button></div>`;
}
function bindPreviewToolbar(root, rerender) {
  $$("[data-pv] button", root).forEach(b => b.onclick = () => {
    PV[b.parentElement.dataset.pv] = b.dataset.v;
    $$("button", b.parentElement).forEach(x => x.classList.toggle("on", x === b));
    rerender();
  });
}

function openPreviewModal(post) {
  const m = modal({
    title: esc(t("Post preview")), wide: true,
    body: `<div class="preview-head">${previewToolbar()}<span class="grow"></span>${badge(post.status)}</div>
      <div class="preview-stage ${PV.theme === "dark" ? "dark" : ""}" id="pvStage"></div>
      ${post.scheduled_at ? `<p class="muted" style="margin:12px 0 0">${icon("clock")} ${esc(fmtFull(post.scheduled_at))}</p>` : ""}`,
    foot: `${post.url ? `<a class="btn" href="${esc(post.url)}" target="_blank">${icon("ext")}${esc(t("View on LinkedIn"))}</a>` : ""}
      ${!["published", "publishing"].includes(post.status) ? `<a class="btn primary" href="#/compose/${post.id}" data-close>${icon("edit")}${esc(t("Edit"))}</a>` : ""}`,
  });
  const draw = () => {
    const st = $("#pvStage", m.el);
    st.classList.toggle("dark", PV.theme === "dark");
    st.innerHTML = renderPreview(post); bindPreview(st);
  };
  bindPreviewToolbar(m.el, draw); draw();
}
