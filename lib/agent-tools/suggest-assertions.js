/**
 * suggest-assertions.js — agent command `suggest_assertions`: what is on the page right now that a check should
 * expect (alerts and toasts, headings, the title). Used to auto-draft "I see …" steps after a recorded flow,
 * because a recording holds actions but not outcomes.
 */

import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger } from "../debugger-capture.js";
import { noTab } from "./index-helpers.js";

/** Runs in the page. Most outcome-like text first: alerts / toasts, then headings, then the title. */
export function suggestInPage() {
  const visible = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const seen = new Set(), out = [];
  const add = (kind, el) => {
    const text = clean(el.innerText);
    if (!text || text.length < 2 || text.length > 80 || seen.has(text.toLowerCase())) return;
    if (!visible(el)) return;
    seen.add(text.toLowerCase()); out.push({ kind, text });
  };
  const OUTCOME = "[role=alert],[role=status],[aria-live=polite],[aria-live=assertive],[class*=toast i],[class*=snackbar i],[class*=alert i],[class*=notification i],[class*=success i],[class*=error i],[class*=flash i]";
  document.querySelectorAll(OUTCOME).forEach((el) => add("message", el));
  document.querySelectorAll("h1").forEach((el) => add("heading", el));
  document.querySelectorAll("h2").forEach((el, i) => { if (i < 2) add("heading", el); });
  if (document.title) out.push({ kind: "title", text: clean(document.title).slice(0, 80) });
  return { url: location.pathname + location.search, suggestions: out.slice(0, 6) };
}

/** Agent command. payload: { url_contains? } */
export async function suggestAssertionsCommand(payload = {}) {
  const tab = await pickAllowedTab(payload.url_contains);
  if (!tab) return noTab(payload.url_contains);
  await attachDebugger(tab.id);
  const res = await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.evaluate", { expression: `(${suggestInPage.toString()})()`, returnByValue: true });
  if (res.exceptionDetails || !res.result?.value) return { status: "failed", result: { error: "Couldn't read the page." } };
  return { status: "done", result: res.result.value };
}
