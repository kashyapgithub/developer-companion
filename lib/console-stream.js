/**
 * console-stream.js — the "Stream console to agent" switch (service worker side).
 *
 * OFF (default): only the categories ticked in the log settings leave the browser,
 *                and they are sent in batches (every 50 rows or each minute).
 * ON:            everything is forwarded no matter what the settings say (console, errors,
 *                every network request with status, timing and bodies, page navigation and
 *                clicks), and sent within a fraction of a second, so the agent's watch_console
 *                sees it almost live.
 *
 * The flag lives in chrome.storage.local so the editor button, the floating window
 * and this worker always agree (and it survives the worker being put to sleep).
 */

import { logSender } from "./log-sender.js";

export const STREAM_KEY = "dcStreamConsole";
/**
 * Everything the stream adds on top of the log settings: the console, uncaught errors, browser
 * warnings, every network request (one line when it finishes), failed requests, and the
 * navigation / click timeline. Meant for testing sessions.
 */
export const STREAM_CATEGORIES = new Set(["console", "exceptions", "browserLog", "networkFailures", "networkStream", "timeline"]);
const FLUSH_DELAY_MS = 250;     // small wait so a burst of lines goes out as one request

let streaming = false;
let flushTimer = null;

/** Is streaming on right now? (synchronous: read from the cached flag) */
export const isStreaming = () => streaming;

/** Pure rule: does an event of `category` leave the browser? */
export function shouldForward(category, forwardConfig, isOn) {
  return !!forwardConfig[category] || (isOn && STREAM_CATEGORIES.has(category));
}

/** Loads the saved flag and keeps the cache in step with changes from any page. Call once at startup. */
export async function initConsoleStream() {
  const saved = await chrome.storage.local.get(STREAM_KEY);
  streaming = !!saved[STREAM_KEY];
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STREAM_KEY]) streaming = !!changes[STREAM_KEY].newValue;
  });
}

/** Turns streaming on or off and remembers the choice. Turning off sends whatever is still queued. */
export async function setStreaming(on) {
  streaming = !!on;
  await chrome.storage.local.set({ [STREAM_KEY]: streaming });
  if (!streaming) await logSender.flush();
  return streaming;
}

/** Sends the queue soon (debounced). No-op unless streaming. */
export function scheduleFlush() {
  if (!streaming || flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; logSender.flush(); }, FLUSH_DELAY_MS);
}
