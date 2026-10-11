/**
 * sketch-overlay.js — puts the sketch on top of a live page (service worker side).
 *
 * The editor renders the sketch to a transparent PNG and sends it here; we
 * inject sketch-overlay/overlay.js into the page you were just on and tell it
 * to show the image. Needs the same http(s) page access as Hover mode.
 */

import { resolveTargetTab } from "./tab-capture.js";

const SCRIPT = "sketch-overlay/overlay.js";

/**
 * Shows the overlay on the target page.
 * @param {{senderTab?:chrome.tabs.Tab, dataUrl:string, opacity?:number, pixelRatio?:number}} opts
 */
export async function showSketchOverlay({ senderTab, dataUrl, opacity = 0.5, pixelRatio = 1 }) {
  const tab = await resolveTargetTab(senderTab);
  if (!tab) return { ok: false, error: "Open the page you want to compare against first." };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [SCRIPT] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (cfg) => window.__dcSketchOverlay.show(cfg),
      args: [{ dataUrl, opacity, pixelRatio }],
    });
    return { ok: true, url: tab.url };
  } catch (err) {
    return { ok: false, error: "Couldn't show the overlay on that page (Chrome blocks some pages)." };
  }
}

/** Removes the overlay from the target page. */
export async function hideSketchOverlay({ senderTab } = {}) {
  const tab = await resolveTargetTab(senderTab);
  if (!tab) return { ok: true };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__dcSketchOverlay?.hide() });
  } catch { /* page gone */ }
  return { ok: true };
}
