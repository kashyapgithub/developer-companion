/**
 * tab-capture.js — screenshot a web tab (service worker side).
 *
 * Used by:  "Capture this tab" in the editor (item 1), element picking
 * (item 2), and the agent's capture_tab tool (item 3).
 *
 * chrome.tabs.captureVisibleTab only sees the ACTIVE tab of a window, so for
 * the full-tab editor we briefly switch to the page, grab it, and switch
 * back. For the floating hover window we hide the overlay for a moment so it
 * isn't in its own screenshot.
 */

const WEB_URL = /^https?:\/\//;
const SETTLE_MS = 250;   // let a freshly activated tab paint before capturing
const HIDE_MS = 120;     // let the hover overlay disappear before capturing

/** windowId -> tabId of the last web page the user looked at. */
const lastWebTab = new Map();

/** Call once from background.js: remembers the last normal web tab per window. */
export function trackWebTabs() {
  chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && WEB_URL.test(tab.url)) lastWebTab.set(windowId, tabId);
    } catch { /* tab closed */ }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [windowId, id] of lastWebTab) if (id === tabId) lastWebTab.delete(windowId);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Which tab to capture. Floating window: the page it floats on. Editor tab:
 * the last web page in that window (or any web tab as a fallback).
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
export async function resolveTargetTab(senderTab) {
  if (senderTab?.url && WEB_URL.test(senderTab.url)) return senderTab;
  const windowId = senderTab?.windowId;
  const remembered = windowId !== undefined ? lastWebTab.get(windowId) : undefined;   // same window first
  if (remembered !== undefined) {
    try { return await chrome.tabs.get(remembered); } catch { /* gone */ }
  }
  const sameWindow = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"], windowId });
  const inWindow = sameWindow.find((t) => t.active) || sameWindow[0];
  return inWindow || (await newestWebTabAnywhere());
}

/**
 * Fallback when the editor lives in its own window (no web page beside it): the web tab
 * the user looked at most recently in ANY window, preferring tabs that are showing.
 */
async function newestWebTabAnywhere() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  const recent = (t) => t.lastAccessed || 0;
  return [...tabs].sort((a, b) => (Number(b.active) - Number(a.active)) || (recent(b) - recent(a)))[0] || null;
}

/** True when the extension may read the tab's pixels (hover mode grants this). */
async function hasPageAccess() {
  return chrome.permissions.contains({ origins: ["http://*/*", "https://*/*"] });
}

/**
 * Captures one tab.
 * @param {{senderTab?:chrome.tabs.Tab, tabId?:number, hideOverlay?:boolean, maxWidth?:number, format?:"png"|"jpeg", quality?:number}} opts
 * @returns {Promise<{ok:true, dataUrl:string, url:string, title:string, tabId:number}|{ok:false, error:string}>}
 */
export async function captureTab(opts = {}) {
  if (!(await hasPageAccess())) {
    return { ok: false, error: "Allow access to web pages first (turn on “Hover over tabs” once to grant it)." };
  }
  const target = opts.tabId !== undefined ? await chrome.tabs.get(opts.tabId).catch(() => null) : await resolveTargetTab(opts.senderTab);
  if (!target) return { ok: false, error: "No web page is open to capture." };

  const sender = opts.senderTab;
  const inPageOverlay = sender?.id === target.id;            // the editor is the floating window on this very tab
  const needSwitch = !target.active;
  let hidden = false;

  try {
    if (needSwitch) {
      await chrome.tabs.update(target.id, { active: true });
      await sleep(SETTLE_MS);
    }
    if (inPageOverlay || opts.hideOverlay) {
      hidden = await chrome.tabs.sendMessage(target.id, { type: "HOVER_SET_VISIBLE", visible: false }).then(() => true, () => false);
      if (hidden) await sleep(HIDE_MS);
    }

    const format = opts.format === "jpeg" ? "jpeg" : "png";
    let dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, { format, quality: opts.quality ?? 90 });
    if (opts.maxWidth) dataUrl = await downscaleDataUrl(dataUrl, opts.maxWidth, format, opts.quality);
    return { ok: true, dataUrl, url: target.url || "", title: target.title || "", tabId: target.id };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  } finally {
    if (hidden) chrome.tabs.sendMessage(target.id, { type: "HOVER_SET_VISIBLE", visible: true }).catch(() => {});
    if (needSwitch && sender?.id !== undefined && sender.id !== target.id) {
      chrome.tabs.update(sender.id, { active: true }).catch(() => {});
    }
  }
}

function friendlyError(err) {
  const text = String(err?.message || err);
  if (/cannot access|extensions gallery|chrome:\/\//i.test(text)) return "Chrome doesn't allow capturing that kind of page (chrome:// pages and the Web Store).";
  if (/permission|activeTab/i.test(text)) return "Chrome blocked the capture — allow access to web pages first.";
  return text;
}

/** Shrinks an image data URL so its width is at most `maxWidth` (keeps it small for the agent). */
export async function downscaleDataUrl(dataUrl, maxWidth, format = "png", quality = 85) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width <= maxWidth) { bitmap.close?.(); return dataUrl; }
  const k = maxWidth / bitmap.width;
  const canvas = new OffscreenCanvas(maxWidth, Math.round(bitmap.height * k));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const out = await canvas.convertToBlob({ type: `image/${format}`, quality: quality / 100 });
  return blobToDataUrl(out);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}


/**
 * Screenshot of a tab WITHOUT activating it, via the Chrome DevTools Protocol.
 * Used when the agent asks (capture_tab): it must never yank the user to another
 * tab. Needs the debugger attached, which allowlisted tabs already have.
 * @returns {Promise<{dataUrl:string,width:number,height:number}>}
 */
export async function captureViaDebugger(tabId, { maxWidth = 1280, format = "jpeg", quality = 80 } = {}) {
  const target = { tabId };
  const metrics = await chrome.debugger.sendCommand(target, "Page.getLayoutMetrics");
  const view = metrics.cssVisualViewport || metrics.visualViewport;
  const scale = Math.min(1, maxWidth / view.clientWidth);
  const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
    format,
    ...(format === "jpeg" ? { quality } : {}),
    clip: { x: view.pageX, y: view.pageY, width: view.clientWidth, height: view.clientHeight, scale },
  });
  return {
    dataUrl: `data:image/${format};base64,${shot.data}`,
    width: Math.round(view.clientWidth * scale),
    height: Math.round(view.clientHeight * scale),
  };
}
