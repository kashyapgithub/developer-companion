/**
 * recording.js — "Record, test your app, Stop & send".
 *
 * While a recording is active, EVERY captured event (console, exceptions,
 * network requests and responses, failures) is also kept in a recording
 * buffer — far more than the normal always-on capture forwards. On stop the
 * whole buffer goes to the local server tagged with one session id, which the
 * agent reads with the `get_latest_recording` tool.
 *
 * State shown in the UI lives in chrome.storage.local under STATE_KEY, so the
 * editor tab, the floating hover window and the page bubble all show the same
 * timer without talking to each other. The raw rows are kept in
 * chrome.storage.session (survives the service worker sleeping) and are never
 * exposed to pages.
 */

import { logSender } from "./log-sender.js";
import { fingerprint } from "./fingerprint.js";

export const STATE_KEY = "dcRecording";
const ROWS_KEY = "dcRecordingRows";
const PENDING_KEY = "dcRecordingPending"; // a finished recording the server never received

const MAX_ROWS = 4000;           // oldest events are dropped beyond this
const CHUNK = 200;               // rows per POST to the server
const COUNT_PUSH_MS = 1000;      // how often live counters reach the UI
const PERSIST_MS = 2000;         // how often the buffer is saved to session storage

let rows = [];                   // recording buffer (in memory)
let state = idleState();
let countTimer = null;
let persistTimer = null;

function idleState(last = null) {
  return { active: false, id: null, startedAt: null, counts: zeroCounts(), sites: [], last };
}
function zeroCounts() { return { events: 0, errors: 0, warnings: 0, failedRequests: 0, markers: 0 }; }

// ---- persistence -----------------------------------------------------------

async function pushState() {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

/** Debounced: counters change per event, the UI only needs ~1 update/second. */
function schedulePush() {
  if (countTimer) return;
  countTimer = setTimeout(() => { countTimer = null; pushState(); }, COUNT_PUSH_MS);
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    chrome.storage.session.set({ [ROWS_KEY]: rows }).catch(() => {});
  }, PERSIST_MS);
}

/** Call once at service-worker start: resume a recording that was running. */
export async function restoreRecording() {
  const got = await chrome.storage.local.get(STATE_KEY);
  state = got[STATE_KEY] || idleState();
  if (state.active) {
    const saved = await chrome.storage.session.get(ROWS_KEY);
    rows = saved[ROWS_KEY] || [];
  }
}

export const getRecordingState = () => state;
export const isRecording = () => state.active;

// ---- capture ---------------------------------------------------------------

function countRow(row) {
  const c = state.counts;
  c.events += 1;
  if (row.level === "error" || row.level === "fatal") c.errors += 1;
  else if (row.level === "warn") c.warnings += 1;
  if (row.type === "network-failed" || (row.type === "network-response" && row.level !== "info")) c.failedRequests += 1;
  if (row.tags?.includes("marker")) c.markers += 1;
}

/** Called for every captured event (see recordLocal in background.js). */
export function captureForRecording(tabId, appName, row) {
  if (!state.active) return;
  rows.push({ ...row, app_name: appName || "unknown-site", tabId });
  if (rows.length > MAX_ROWS) rows.shift();
  countRow(row);
  if (row.type !== "marker" && appName && !state.sites.includes(appName)) state.sites.push(appName);
  schedulePush();
  schedulePersist();
}

// ---- controls --------------------------------------------------------------

/**
 * Starts a recording. `attachedApps` are the sites currently being captured;
 * the caller attaches open tabs first, so an empty list means nothing will be
 * recorded and the UI can say so.
 */
export async function startRecording(attachedApps = []) {
  if (state.active) return { ok: true, state, attachedApps };
  rows = [];
  const startedAt = new Date().toISOString();
  state = { active: true, id: `rec-${Date.now().toString(36)}`, startedAt, counts: zeroCounts(), sites: [...attachedApps], last: state.last || null };
  await chrome.storage.session.set({ [ROWS_KEY]: [] }).catch(() => {});
  await pushState();
  return { ok: true, state, attachedApps };
}

/** A one-click "something went wrong right here" note in the timeline. */
export async function addMarker(note = "") {
  if (!state.active) return { ok: false, error: "Not recording" };
  const seconds = Math.round((Date.now() - Date.parse(state.startedAt)) / 1000);
  captureForRecording(-1, "recording", {
    timestamp: new Date().toISOString(),
    type: "marker",
    level: "info",
    message: `⚑ Marker at ${formatClock(seconds)}${note ? `: ${note}` : " — the user flagged this moment"}`,
    error_type: null,
    stack_trace: null,
    context: {},
    tags: ["marker"],
  });
  return { ok: true };
}

/** Stops, then sends everything to the server. Safe to call when idle. */
export async function stopRecording({ send = true } = {}) {
  if (!state.active) return { ok: false, error: "Not recording" };
  const finished = { ...state, stoppedAt: new Date().toISOString() };
  const durationSeconds = Math.round((Date.parse(finished.stoppedAt) - Date.parse(finished.startedAt)) / 1000);
  const toSend = rows;
  rows = [];

  let result = { ok: true, sent: 0 };
  if (send) result = await sendRows(finished.id, toSend);

  // Never lose a debugging session to a server hiccup: keep it for a retry.
  if (send && !result.ok) await chrome.storage.session.set({ [PENDING_KEY]: { id: finished.id, rows: toSend } }).catch(() => {});

  const last = {
    id: finished.id, durationSeconds, counts: finished.counts, sites: finished.sites,
    sent: result.sent, ok: result.ok, error: result.error || null, at: finished.stoppedAt,
    canRetry: send && !result.ok,
  };
  state = idleState(last);
  await chrome.storage.session.remove(ROWS_KEY).catch(() => {});
  await pushState();
  return { ok: result.ok, last };
}

/** Re-sends the last recording that failed to reach the server. */
export async function retrySend() {
  const got = await chrome.storage.session.get(PENDING_KEY);
  const pending = got[PENDING_KEY];
  if (!pending) return { ok: false, error: "Nothing to retry" };
  const result = await sendRows(pending.id, pending.rows);
  if (result.ok) await chrome.storage.session.remove(PENDING_KEY).catch(() => {});
  const last = { ...(state.last || {}), id: pending.id, sent: result.sent, ok: result.ok, error: result.error || null, canRetry: !result.ok };
  state = { ...state, last };
  await pushState();
  return { ok: result.ok, last };
}

// ---- sending ---------------------------------------------------------------

/** Converts buffer rows to the server's log shape and POSTs them in chunks. */
async function sendRows(sessionId, list) {
  const serverUrl = await logSender.getEffectiveServerUrl();
  const headers = await logSender.getRequestHeaders();
  let sent = 0;
  try {
    for (let i = 0; i < list.length; i += CHUNK) {
      const batch = await Promise.all(list.slice(i, i + CHUNK).map(async (r) => ({
        created_at: r.timestamp,
        app_name: r.app_name,
        environment: "browser",
        host: "chrome-extension",
        level: r.level,
        message: r.message,
        error_type: r.error_type,
        stack_trace: r.stack_trace,
        context: r.context,
        fingerprint: await fingerprint(r.error_type, r.message),
        session_id: sessionId,
        tags: [...(r.tags || []), "recording"],
      })));
      const res = await fetch(`${serverUrl}/logs`, { method: "POST", headers, body: JSON.stringify(batch) });
      if (!res.ok) return { ok: false, sent, error: res.status === 401 ? "Wrong or missing access code" : `Server said ${res.status}` };
      sent += batch.length;
    }
    return { ok: true, sent };
  } catch (err) {
    return { ok: false, sent, error: "Can't reach the agent server — is it running?" };
  }
}

export function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60), s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
