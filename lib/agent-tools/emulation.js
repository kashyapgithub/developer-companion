/**
 * emulation.js — look at the app the way other people's devices see it.
 *
 *   capture_responsive   screenshots at phone / tablet / desktop widths, plus a
 *                        check for sideways scrolling (the classic mobile bug)
 *   set_network_throttle slow 3G / fast 3G / offline / normal, to see loading
 *                        and error states
 *
 * Uses the Chrome DevTools Protocol on an allowed tab. Screen-size emulation is
 * switched on only while capturing and always switched back.
 */

import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger } from "../debugger-capture.js";
import { noTab } from "./index-helpers.js";

const DEFAULT_WIDTHS = [375, 768, 1280];
const MAX_WIDTHS = 4;
const SETTLE_MS = 450;        // let the page re-layout after a size change
const MAX_HEIGHT = 3000;      // full-page screenshots are cut here

/** DevTools-style network profiles. Throughput is bytes per second; -1 = unlimited. */
export const NETWORK_PROFILES = {
  "slow-3g": { offline: false, latency: 2000, downloadThroughput: 51200, uploadThroughput: 51200 },
  "fast-3g": { offline: false, latency: 562, downloadThroughput: 204800, uploadThroughput: 96000 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};

/** Remembers the active profile per tab, for status reporting. */
const activeProfile = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);

/** Does the page scroll sideways? Returns { overflowX, scrollWidth, innerWidth }. */
async function measureOverflow(tabId) {
  const r = await send(tabId, "Runtime.evaluate", {
    expression: "({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })", returnByValue: true,
  });
  const { scrollWidth, innerWidth } = r.result.value;
  return { overflowX: scrollWidth > innerWidth + 1, scrollWidth, innerWidth };
}

/** Screenshots the tab at each width. Always restores the real size, even on error. */
export async function captureResponsiveCommand({ widths, url_contains, height = 800, full_page = false } = {}) {
  const tab = await pickAllowedTab(url_contains);
  if (!tab) return noTab(url_contains);
  const list = (Array.isArray(widths) && widths.length ? widths : DEFAULT_WIDTHS)
    .map(Number).filter((w) => w >= 200 && w <= 3000).slice(0, MAX_WIDTHS);
  await attachDebugger(tab.id);
  const shots = [];
  try {
    for (const width of list) {
      await send(tab.id, "Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(SETTLE_MS);
      const overflow = await measureOverflow(tab.id);
      const shot = await send(tab.id, "Page.captureScreenshot", { format: "jpeg", quality: 70, captureBeyondViewport: !!full_page, ...(full_page ? {} : {}) });
      shots.push({ width, ...overflow, dataUrl: `data:image/jpeg;base64,${shot.data}` });
    }
  } finally {
    await send(tab.id, "Emulation.clearDeviceMetricsOverride").catch(() => {});
  }
  return { status: "done", result: { url: tab.url, title: tab.title, shots } };
}

/** Switches network throttling for a tab. profile: slow-3g | fast-3g | offline | none. */
export async function networkThrottleCommand({ profile = "none", url_contains } = {}) {
  const conditions = NETWORK_PROFILES[profile];
  if (!conditions) return { status: "failed", result: { error: `Unknown profile '${profile}'. Use one of: ${Object.keys(NETWORK_PROFILES).join(", ")}.` } };
  const tab = await pickAllowedTab(url_contains);
  if (!tab) return noTab(url_contains);
  await attachDebugger(tab.id);
  await send(tab.id, "Network.emulateNetworkConditions", conditions);
  activeProfile.set(tab.id, profile);
  return { status: "done", result: { url: tab.url, profile, note: profile === "none" ? "Network back to normal." : "Throttling is on for this tab until you set 'none' (or close the tab)." } };
}
