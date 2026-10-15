/**
 * api-window.js — opens the API client window and prepares browser traffic for it.
 *
 * The client is a small popup window (not a tab) so it sits next to your app while you work.
 */

import { queryRequests } from "./agent-tools/network-store.js";
import { capturedToRequest, isApiCall } from "./captured-to-request.js";

const WINDOW_KEY = "dcApiWindowId";
const SIZE = { width: 1100, height: 760 };

/** Opens the window, or focuses it if it is already open. */
export async function openApiWindow() {
  const { [WINDOW_KEY]: existing } = await chrome.storage.session.get(WINDOW_KEY);
  if (existing != null) {
    try { await chrome.windows.update(existing, { focused: true }); return { ok: true }; } catch { /* closed: open a new one */ }
  }
  const win = await chrome.windows.create({ url: chrome.runtime.getURL("api/api.html"), type: "popup", ...SIZE });
  await chrome.storage.session.set({ [WINDOW_KEY]: win.id });
  return { ok: true };
}

/** Recent fetch/XHR calls (newest first, de-duplicated by method + URL) as request drafts. */
export function capturedForApiClient(limit = 40) {
  const seen = new Set();
  const items = [];
  for (const entry of queryRequests({ limit: 50, includeBodies: true, maxBodyChars: 8000 })) {
    if (!isApiCall(entry)) continue;
    const key = `${entry.method} ${entry.url.split("?")[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ status: entry.status, request: capturedToRequest(entry) });
    if (items.length >= limit) break;
  }
  return { ok: true, items };
}
