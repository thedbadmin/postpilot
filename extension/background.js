importScripts("api.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "pp-page", title: "Save this page to PostPilot", contexts: ["page", "link"] });
  chrome.contextMenus.create({ id: "pp-sel", title: "Save selection as a PostPilot draft", contexts: ["selection"] });
  chrome.alarms.create("pp-badge", { periodInMinutes: 1 });
  updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.alarms.onAlarm.addListener(a => { if (a.name === "pp-badge") updateBadge(); });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "pp-sel") {
      await ppFetch("POST", "/api/posts", { text: info.selectionText || "", source: "extension", topic: tab && tab.title });
    } else if (info.linkUrl) {
      await ppFetch("POST", "/api/posts", { text: "", link: { url: info.linkUrl, title: info.linkUrl }, source: "extension" });
    } else {
      await savePage(tab, "");
    }
    flash("✓", "#057642");
  } catch (e) {
    flash("!", "#b42318");
  }
  updateBadge();
});

function flash(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(updateBadge, 2500);
}

async function updateBadge() {
  try {
    const st = await ppFetch("GET", "/api/status");
    const bad = st.counts.failed + st.counts.missed;
    chrome.action.setBadgeBackgroundColor({ color: bad ? "#b42318" : "#0a66c2" });
    chrome.action.setBadgeText({ text: bad ? "!" : st.counts.scheduled ? String(st.counts.scheduled) : "" });
    chrome.action.setTitle({ title: bad ? `PostPilot: ${bad} post(s) need attention` : `PostPilot: ${st.counts.scheduled} scheduled` });
  } catch (e) {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: e.message === "NOT_PAIRED" ? "PostPilot: click to connect" : "PostPilot app is not running" });
  }
}
