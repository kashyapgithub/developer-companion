/**
 * xray.js — background side of X-ray mode (see xray/xray.js for the page UI).
 *
 *   toggleXray(tab)      inject (or switch off) X-ray on a page
 *   handleXraySend(...)  the page sends its selected elements; we screenshot
 *                        once, crop each element, then deliver them to the
 *                        canvas editor or to the agent through the local server
 */

import { captureTab } from "./tab-capture.js";
import { cropToElement } from "./element-picker.js";
import { logSender } from "./log-sender.js";

const WEB_URL = /^https?:\/\//;

// ---- switching on / off ------------------------------------------------------

/** True while X-ray is running on the tab. */
async function isActive(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => !!self.__dcXray });
  return !!res?.result;
}

/**
 * Toggles X-ray on `tab`. Returns { ok, active } or { ok:false, error }.
 * Injecting xray.js while it is running switches it off, so the same call serves both directions.
 */
export async function toggleXray(tab) {
  if (!tab?.id || !WEB_URL.test(tab.url || "")) return { ok: false, error: "Open a normal web page first (Chrome doesn't allow X-ray on its own pages)." };
  try {
    const wasActive = await isActive(tab.id);
    if (!wasActive) {
      // The page-world helper reads React/Vue component names; it must run in the page's own world.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["xray/xray-main.js"], world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker/describe.js"] });
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["xray/xray.js"] });
    return { ok: true, active: !wasActive };
  } catch {
    return { ok: false, error: "Chrome doesn't allow X-ray on this page, or page access hasn't been granted yet." };
  }
}

// ---- delivering a selection -----------------------------------------------------

/**
 * @param {{target:"canvas"|"agent", elements:object[]}} message  elements as described by picker/describe.js
 * @param {chrome.tabs.Tab} senderTab  the page X-ray is running on
 * @returns {Promise<{ok:boolean, message?:string, error?:string}>}
 */
export async function handleXraySend({ target, elements }, senderTab) {
  const shot = await captureTab({ tabId: senderTab.id, hideOverlay: true });
  const items = [];
  for (const element of elements) {
    let crop = null;
    if (shot.ok) crop = await cropToElement(shot.dataUrl, element.rect, element.viewport).catch(() => null);
    items.push({ element, cropDataUrl: crop });
  }
  return target === "canvas" ? sendToCanvas(items, senderTab) : sendToAgent(items, senderTab);
}

/**
 * Delivers to ONE editor so nothing is added twice: the full-tab editor if one is open, otherwise
 * the floating editor inside the page X-ray is running on.
 */
async function sendToCanvas(items, senderTab) {
  const editorTabs = await chrome.tabs.query({ url: chrome.runtime.getURL("editor/editor.html") + "*" });
  const fullTab = editorTabs.find((t) => !t.url.includes("embedded=1"));
  try {
    const res = await chrome.tabs.sendMessage((fullTab || senderTab).id, { type: "XRAY_TO_CANVAS", items });
    return res?.ok ? { ok: true, message: `Added ${items.length} element${items.length > 1 ? "s" : ""} to the canvas.` } : { ok: false, error: "The editor couldn't add them." };
  } catch {
    return { ok: false, error: "Open the Developer Companion editor first (or turn on “Hover over tabs”), then try again." };
  }
}

/** POSTs the selection to the local server; the agent reads it with get_selected_elements. */
async function sendToAgent(items, senderTab) {
  const serverUrl = await logSender.getEffectiveServerUrl();
  const body = {
    url: senderTab.url,
    title: senderTab.title,
    sentAt: new Date().toISOString(),
    elements: items.map(({ element, cropDataUrl }) => ({ ...element, screenshot: cropDataUrl })),
  };
  try {
    const res = await fetch(`${serverUrl}/xray`, { method: "POST", headers: await logSender.getRequestHeaders(), body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, error: res.status === 401 ? "Wrong or missing access code." : `The agent server said ${res.status}.` };
    return { ok: true, message: `Sent ${items.length} element${items.length > 1 ? "s" : ""}. Ask your agent to check the selected elements.` };
  } catch {
    return { ok: false, error: "Can't reach the agent server. Is it running?" };
  }
}
