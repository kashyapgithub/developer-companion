/**
 * mocks.js — API mock mode: answer chosen requests with fake responses.
 *
 * Uses the CDP "Fetch" domain: while a tab has rules, every request is paused; matching
 * ones are fulfilled (or failed) here, the rest continue untouched. When the last rule
 * goes, interception is switched off so the page runs normally again.
 *
 * Commands: set_mock, list_mocks, clear_mocks. onFetchEvent() is called from debugger-capture.
 */

import { addRule, listRules, clearRules, matchRule, toFulfillParams, describeRule } from "./mock-rules.js";
import { queryRequests } from "./network-store.js";
import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger } from "../debugger-capture.js";
import { noTab } from "./index-helpers.js";

const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tabs where Fetch interception is currently on. */
const interceptingTabs = new Set();

async function ensureIntercepting(tabId) {
  if (interceptingTabs.has(tabId)) return;
  await send(tabId, "Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  interceptingTabs.add(tabId);
}

async function stopIntercepting(tabId) {
  if (!interceptingTabs.has(tabId)) return;
  interceptingTabs.delete(tabId);
  await send(tabId, "Fetch.disable").catch(() => {});
}

/** Handles one paused request: mock it or let it through. Never throws. */
export async function onFetchEvent(tabId, method, params) {
  if (method !== "Fetch.requestPaused") return;
  const { requestId, request } = params;
  try {
    const rule = matchRule(tabId, request.url, request.method);
    if (!rule) return void (await send(tabId, "Fetch.continueRequest", { requestId }));
    if (rule.delayMs) await sleep(rule.delayMs);
    if (rule.fail) return void (await send(tabId, "Fetch.failRequest", { requestId, errorReason: "Failed" }));
    await send(tabId, "Fetch.fulfillRequest", { requestId, ...toFulfillParams(rule) });
  } catch (err) {
    console.warn("[developer-companion] mock:", err);
    await send(tabId, "Fetch.continueRequest", { requestId }).catch(() => {});
  }
}

/** Forget a tab (closed / detached). */
export function forgetMocks(tabId) { clearRules(tabId); interceptingTabs.delete(tabId); }

/** Fills a spec from the newest recorded response when asked ("mock it like the real one, but…"). */
function specFromRecorded(spec, tabId) {
  const found = queryRequests({ tabId, urlContains: spec.url_contains, method: spec.method, limit: 1 })[0];
  if (!found || found.responseBody == null) return { error: `No recorded response for "${spec.url_contains}" to copy. Load the page first, or give a body.` };
  let body = found.responseBody;
  try { body = JSON.parse(body); } catch { /* keep text */ }
  return { spec: { ...spec, status: spec.status ?? found.status, body: spec.body ?? body, content_type: spec.content_type ?? found.mimeType } };
}

/** Agent command: add a mock rule to the open tab. */
export async function setMockCommand(payload = {}) {
  const tab = await pickAllowedTab(payload.url_contains_tab);
  if (!tab) return noTab(payload.url_contains_tab);
  let spec = payload;
  if (payload.from_recorded) {
    const copied = specFromRecorded(payload, tab.id);
    if (copied.error) return { status: "failed", result: { error: copied.error } };
    spec = copied.spec;
  }
  await attachDebugger(tab.id);
  const added = addRule(tab.id, spec);
  if (added.error) return { status: "failed", result: { error: added.error } };
  await ensureIntercepting(tab.id);
  return { status: "done", result: { added: describeRule(added.rule), active: listRules(tab.id).map(describeRule) } };
}

/** Agent command: show active mocks and how often each was hit. */
export async function listMocksCommand(payload = {}) {
  const tab = await pickAllowedTab(payload.url_contains_tab);
  if (!tab) return noTab(payload.url_contains_tab);
  return { status: "done", result: { active: listRules(tab.id).map(describeRule) } };
}

/** Agent command: remove one mock (id) or all, and stop intercepting when none remain. */
export async function clearMocksCommand(payload = {}) {
  const tab = await pickAllowedTab(payload.url_contains_tab);
  if (!tab) return noTab(payload.url_contains_tab);
  const removed = clearRules(tab.id, payload.id);
  if (!listRules(tab.id).length) await stopIntercepting(tab.id);
  return { status: "done", result: { removed, remaining: listRules(tab.id).map(describeRule) } };
}
