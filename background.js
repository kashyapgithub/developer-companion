/**
 * background.js — Unified Service Worker for Developer Companion
 *
 * Coordinates:
 * 1. UI Sketch Canvas (primary tab interface opened on action click)
 * 2. GitHub Repo Dashboard (managed window or modal)
 * 3. Browser Debug Logger (CDP debugger capturing console, errors, network)
 * 4. Unified messaging & log streaming to the Agent Companion Server
 */

import { getAppNameForUrl, setAllowlist, getAllowlist } from "./lib/allowlist.js";
import {
  attachDebugger,
  detachDebugger,
  isAttached,
  forgetTab,
  createEventHandler,
} from "./lib/debugger-capture.js";
import { logSender } from "./lib/log-sender.js";
import { startCommandLoop } from "./lib/commands.js";
import { showSketchOverlay, hideSketchOverlay } from "./lib/sketch-overlay.js";
import { startPicking, handlePicked, handleCancelled } from "./lib/element-picker.js";
import { captureTab, trackWebTabs } from "./lib/tab-capture.js";
import { captureForRecording, restoreRecording, startRecording, stopRecording, retrySend, addMarker, getRecordingState, isRecording } from "./lib/recording.js";
import { setHoverEnabled, isHoverEnabled, repairHoverRegistration } from "./lib/hover-manager.js";
import { getForwardConfig, setForwardConfig, DEFAULT_FORWARD_CONFIG } from "./lib/forward-config.js";

const CANVAS_URL = chrome.runtime.getURL("editor/editor.html");
const DASHBOARD_URL = chrome.runtime.getURL("overlay/overlay.html");
const LOGS_URL = chrome.runtime.getURL("logs/logs.html");

// ---------------------------------------------------------------------------
// 1. Primary Action: Open UI Sketch Canvas in a full tab
// ---------------------------------------------------------------------------
chrome.action.onClicked.addListener(async () => {
  // If an editor tab is already open, focus it
  const tabs = await chrome.tabs.query({ url: CANVAS_URL + "*" });
  if (tabs.length > 0 && tabs[0].id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: CANVAS_URL });
  }
});

// ---------------------------------------------------------------------------
// 2. GitHub Dashboard Window Management
// ---------------------------------------------------------------------------
async function getOpenDashboardWindowId() {
  const { dashboardWindowId } = await chrome.storage.session.get("dashboardWindowId");
  return dashboardWindowId ?? null;
}

async function setOpenDashboardWindowId(windowId) {
  await chrome.storage.session.set({ dashboardWindowId: windowId });
}

async function openOrFocusDashboard() {
  const existingId = await getOpenDashboardWindowId();
  if (existingId !== null) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return;
    } catch {
      // Window was closed; create new
    }
  }

  let targetWidth = 1140;
  let targetHeight = 720;
  let targetTop = 50;
  let targetLeft = 80;

  try {
    const currentWin = await chrome.windows.getCurrent();
    if (currentWin?.width && currentWin?.height) {
      targetWidth = Math.min(1180, Math.max(880, Math.round(currentWin.width * 0.82)));
      targetHeight = Math.min(740, Math.max(560, Math.round(currentWin.height * 0.80)));
      targetLeft = Math.max(20, Math.round((currentWin.width - targetWidth) / 2) + (currentWin.left || 0));
      targetTop = Math.max(20, Math.round((currentWin.height - targetHeight) / 2) + (currentWin.top || 0));
    }
  } catch {}

  const created = await chrome.windows.create({
    url: DASHBOARD_URL,
    type: "popup",
    width: targetWidth,
    height: targetHeight,
    top: targetTop,
    left: targetLeft,
  });

  await setOpenDashboardWindowId(created.id);
}

chrome.windows.onRemoved.addListener(async (closedId) => {
  const existingId = await getOpenDashboardWindowId();
  if (closedId === existingId) {
    await chrome.storage.session.remove("dashboardWindowId");
  }
});

// ---------------------------------------------------------------------------
// 3. Centralized Debugger Log Capture
// ---------------------------------------------------------------------------
let forwardConfigCache = DEFAULT_FORWARD_CONFIG;
getForwardConfig().then((config) => {
  forwardConfigCache = config;
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.forwardConfig) {
    forwardConfigCache = { ...DEFAULT_FORWARD_CONFIG, ...changes.forwardConfig.newValue };
  }
});

// Seed config if config.local.json is present
(async function seedConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL("config.local.json"));
    if (!res.ok) return;
    const config = await res.json();
    if (config.serverUrl) await chrome.storage.local.set({ serverUrl: config.serverUrl });
    if (Array.isArray(config.allowlist) && config.allowlist.length > 0) {
      await setAllowlist(config.allowlist);
    }
    if (config.forwardConfig && typeof config.forwardConfig === "object") {
      forwardConfigCache = await setForwardConfig(config.forwardConfig);
    }
  } catch {}
})();

const tabAppNames = new Map(); // tabId -> app label
const tabSessions = new Map(); // tabId -> session id

const MAX_BUFFERED_ROWS = 500;
const localLogs = new Map(); // tabId -> row[]

function recordLocal(tabId, row) {
  let buffer = localLogs.get(tabId);
  if (!buffer) {
    buffer = [];
    localLogs.set(tabId, buffer);
  }
  buffer.push(row);
  if (buffer.length > MAX_BUFFERED_ROWS) buffer.shift();
  captureForRecording(tabId, tabAppNames.get(tabId), row); // no-op unless a recording is running
}

const onDebuggerEvent = createEventHandler({
  getTabHostname: (tabId) => tabAppNames.get(tabId),
  getSessionId: (tabId) => tabSessions.get(tabId),
  recordLocal,
  getForwardConfig: () => forwardConfigCache,
  isRecording,
});
chrome.debugger.onEvent.addListener(onDebuggerEvent);

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) forgetTab(source.tabId);
});

// Auto-attach / detach as user navigates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading" || !tab.url || !tab.url.startsWith("http")) {
    return;
  }

  tabSessions.set(tabId, `${tabId}-${Date.now()}`);
  const appName = await getAppNameForUrl(tab.url);

  if (appName) {
    tabAppNames.set(tabId, appName);
    if (!isAttached(tabId)) await attachDebugger(tabId);
  } else {
    tabAppNames.delete(tabId);
    if (isAttached(tabId)) await detachDebugger(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
  tabAppNames.delete(tabId);
  tabSessions.delete(tabId);
  localLogs.delete(tabId);
});

// Periodic flush
chrome.alarms.create("flush-logs", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flush-logs") logSender.flush();
});

// Remote commands
function findTabIdByAppName(appName) {
  for (const [tabId, name] of tabAppNames.entries()) {
    if (name === appName) return tabId;
  }
  return undefined;
}

function getAttachedAppNames() {
  return [...tabAppNames.entries()]
    .filter(([tabId]) => isAttached(tabId))
    .map(([, appName]) => appName);
}

/**
 * Tabs that were already open on an allowlisted site when recording starts
 * aren't attached yet (attaching normally happens on navigation). Attach them
 * now so the recording sees their next click, not just the next page load.
 */
async function attachOpenAllowlistedTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    const appName = await getAppNameForUrl(tab.url);
    if (!appName) continue;
    tabAppNames.set(tab.id, appName);
    if (!tabSessions.has(tab.id)) tabSessions.set(tab.id, `${tab.id}-${Date.now()}`);
    if (!isAttached(tab.id)) await attachDebugger(tab.id).catch(() => {});
  }
}

const commandDeps = {
  findTabIdByHostname: findTabIdByAppName,
  getAttachedHostnames: getAttachedAppNames,
  attachOpenTabs: attachOpenAllowlistedTabs,
  getAttachedApps: getAttachedAppNames,
};
startCommandLoop(commandDeps);

repairHoverRegistration().catch(() => {});
restoreRecording().catch(() => {});
trackWebTabs();

// Restart the command loop if the worker was recycled (no-op while it is running).
chrome.alarms.create("poll-commands", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll-commands") startCommandLoop(commandDeps);
});

// ---------------------------------------------------------------------------
// 4. Message Bus for Canvas, Dashboard, and Logger UIs
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "OPEN_CANVAS") {
    chrome.tabs.create({ url: CANVAS_URL }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "FOCUS_CANVAS_TAB") {
    (async () => {
      try {
        const senderTabId = _sender?.tab?.id;
        const senderWindowId = _sender?.tab?.windowId;
        if (senderTabId) {
          await chrome.tabs.update(senderTabId, { active: true });
          if (senderWindowId) {
            await chrome.windows.update(senderWindowId, { focused: true });
          }
        } else {
          const tabs = await chrome.tabs.query({ url: CANVAS_URL + "*" });
          if (tabs.length > 0 && tabs[0].id) {
            await chrome.tabs.update(tabs[0].id, { active: true });
            if (tabs[0].windowId) {
              await chrome.windows.update(tabs[0].windowId, { focused: true });
            }
          }
        }
      } catch {}
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Hover mode: float the editor over any tab (see lib/hover-manager.js).
  if (message.type === "HOVER_SET") {
    setHoverEnabled(!!message.enabled).then(sendResponse);
    return true;
  }

  if (message.type === "HOVER_STATUS") {
    isHoverEnabled().then((enabled) => sendResponse({ enabled }));
    return true;
  }

  // Screenshot the page the user is working on (see lib/tab-capture.js).
  if (message.type === "CAPTURE_TAB") {
    captureTab({ senderTab: _sender?.tab, maxWidth: message.maxWidth }).then(sendResponse);
    return true;
  }

  // Sketch laid over the live page (see lib/sketch-overlay.js).
  if (message.type === "SKETCH_OVERLAY_SHOW") {
    showSketchOverlay({ senderTab: _sender?.tab, ...message }).then(sendResponse);
    return true;
  }
  if (message.type === "SKETCH_OVERLAY_HIDE") {
    hideSketchOverlay({ senderTab: _sender?.tab }).then(sendResponse);
    return true;
  }

  // Point at an element on a page (see lib/element-picker.js).
  if (message.type === "PICK_ELEMENT") {
    startPicking({ requestId: message.requestId, senderTab: _sender?.tab }).then(sendResponse);
    return true;
  }
  if (message.type === "ELEMENT_PICKED") {
    handlePicked(message.payload, _sender?.tab);
    return;
  }
  if (message.type === "ELEMENT_PICK_CANCEL") {
    handleCancelled();
    return;
  }

  // Recording: Record -> test your app -> Stop & send (see lib/recording.js).
  if (message.type === "REC_START") {
    (async () => {
      await attachOpenAllowlistedTabs();
      sendResponse(await startRecording(getAttachedAppNames()));
    })();
    return true;
  }
  if (message.type === "REC_STOP") {
    stopRecording({ send: message.send !== false }).then(sendResponse);
    return true;
  }
  if (message.type === "REC_RETRY") {
    retrySend().then(sendResponse);
    return true;
  }
  if (message.type === "REC_MARK") {
    addMarker(message.note).then(sendResponse);
    return true;
  }
  if (message.type === "REC_STATUS") {
    sendResponse({ state: getRecordingState(), attachedApps: getAttachedAppNames() });
    return true;
  }

  if (message.type === "OPEN_GITHUB_DASHBOARD") {
    openOrFocusDashboard().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "OPEN_LOGS_VIEWER") {
    chrome.tabs.create({ url: LOGS_URL }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "GET_STATUS") {
    const attached = [...tabAppNames.entries()].filter(([tabId]) => isAttached(tabId));
    let totalBufferedLogs = 0;
    for (const logs of localLogs.values()) {
      totalBufferedLogs += logs.length;
    }
    sendResponse({
      attachedTabs: attached,
      totalBufferedLogs,
      queueSize: logSender.queue.length,
    });
    return true;
  }

  if (message.type === "GET_ALL_LOGS") {
    const all = [];
    for (const [tabId, rows] of localLogs.entries()) {
      const app = tabAppNames.get(tabId) || `tab-${tabId}`;
      for (const r of rows) {
        all.push({ ...r, tabId, appName: app });
      }
    }
    // Sort descending by timestamp
    all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    sendResponse({ rows: all });
    return true;
  }

  if (message.type === "GET_LOGS") {
    const tabId = findTabIdByAppName(message.appName);
    sendResponse({ rows: tabId !== undefined ? localLogs.get(tabId) || [] : [] });
    return true;
  }

  if (message.type === "CLEAR_LOGS") {
    if (message.appName) {
      const tabId = findTabIdByAppName(message.appName);
      if (tabId !== undefined) localLogs.set(tabId, []);
    } else {
      localLogs.clear();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "FLUSH_NOW" || message.type === "SEND_LOGS_TO_AGENT") {
    // If specific rows were passed, queue them first
    if (Array.isArray(message.rows)) {
      for (const r of message.rows) {
        logSender.enqueue(r);
      }
    } else if (logSender.queue.length === 0) {
      // If queue is empty, push buffered local logs
      for (const rows of localLogs.values()) {
        for (const r of rows) {
          logSender.enqueue(r);
        }
      }
    }

    logSender.flush().then((res) => sendResponse(res));
    return true;
  }
});
