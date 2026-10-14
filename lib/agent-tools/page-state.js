/**
 * page-state.js — reads the open page's client-side state for the agent.
 *
 * readStateInPage() runs INSIDE the page (self-contained, JSON-safe result).
 * state-format.js then masks secrets and caps sizes before anything leaves.
 */

import { buildPageState } from "./state-format.js";
import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger } from "../debugger-capture.js";
import { noTab } from "./index-helpers.js";

/** Runs in the page. Raw reads only — shaping happens outside. */
export function readStateInPage() {
  const dump = (store) => { const m = {}; try { for (let i = 0; i < store.length; i++) { const k = store.key(i); m[k] = store.getItem(k); } } catch { /* blocked */ } return m; };
  const GLOBALS = ["__NEXT_DATA__", "__NUXT__", "__INITIAL_STATE__", "__PRELOADED_STATE__", "__APOLLO_STATE__"];
  const globals = {};
  for (const name of GLOBALS) {
    try { if (window[name] !== undefined) globals[name] = JSON.parse(JSON.stringify(window[name])); } catch { globals[name] = "[not serialisable]"; }
  }
  return {
    page: { url: location.href, title: document.title },
    localStorage: dump(localStorage),
    sessionStorage: dump(sessionStorage),
    cookieNames: document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter(Boolean),
    globals,
  };
}

/** Agent command: state of the open tab on an allowed site. */
export async function pageStateCommand(payload = {}) {
  const tab = await pickAllowedTab(payload.url_contains);
  if (!tab) return noTab(payload.url_contains);
  await attachDebugger(tab.id);
  const res = await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.evaluate", {
    expression: `(${readStateInPage.toString()})()`, returnByValue: true,
  });
  if (res.exceptionDetails || !res.result?.value) return { status: "failed", result: { error: "Couldn't read the page's state." } };
  return { status: "done", result: buildPageState(res.result.value) };
}
