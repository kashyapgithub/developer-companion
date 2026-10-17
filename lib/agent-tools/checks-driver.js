/**
 * checks-driver.js — the real "driver" for checks-run.js: touches the user's tab through the
 * Chrome DevTools Protocol (clicks with real mouse events, types with real input, reads the page).
 *
 * Only allowed sites (localhost by default) are ever opened or driven.
 */

import { getAppNameForUrl } from "../allowlist.js";
import { queryRequests } from "./network-store.js";

const LOAD_TIMEOUT_MS = 10000;
const KEYS = {
  Enter: { code: "Enter", vk: 13, text: "\r" }, Tab: { code: "Tab", vk: 9 }, Escape: { code: "Escape", vk: 27 },
  Backspace: { code: "Backspace", vk: 8 }, ArrowDown: { code: "ArrowDown", vk: 40 }, ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 }, ArrowRight: { code: "ArrowRight", vk: 39 }, " ": { code: "Space", vk: 32, text: " " },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs in every document: remembers errors so "no console errors" can be checked later. */
const ERROR_HOOK = `(() => {
  if (window.__dcErrs) return;
  const errs = window.__dcErrs = [];
  const add = (m) => { if (errs.length < 20) errs.push(String(m).slice(0, 300)); };
  addEventListener("error", (e) => add(e.message || "Script error"));
  addEventListener("unhandledrejection", (e) => add("Unhandled promise rejection: " + (e.reason && e.reason.message || e.reason)));
  const orig = console.error; console.error = function () { add([].map.call(arguments, String).join(" ")); return orig.apply(this, arguments); };
})();`;

/** Page-side helpers (source string, evaluated together with each snippet). */
const HELPERS = `
  const visible = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const byText = (text) => {
    const want = text.trim().toLowerCase(), pick = [];
    for (const el of document.querySelectorAll("a,button,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],input[type=button],summary,label,li,h1,h2,h3,span,div,p")) {
      if (!visible(el)) continue;
      const t = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().toLowerCase();
      if (t === want) pick.unshift(el); else if (t.includes(want) && t.length < want.length + 40) pick.push(el);
    }
    return pick[0] || null;
  };
  const find = (sel, text) => (sel ? document.querySelector(sel) : byText(text));`;

/** @param {number} tabId */
export function createChecksDriver(tabId) {
  const send = (method, params) => chrome.debugger.sendCommand({ tabId }, method, params);
  const evaluate = async (body) => {
    const res = await send("Runtime.evaluate", { expression: `(() => { ${HELPERS} ${body} })()`, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "page script failed");
    return res.result?.value;
  };
  let hookId = null, startedAt = "", errors = [];

  /** Errors seen so far on the current document, added to those from documents we left. */
  const harvest = async () => { try { errors.push(...((await evaluate("const e = window.__dcErrs || []; window.__dcErrs = []; return e;")) || [])); } catch { /* navigating */ } };

  /** Where the pointer must go to click this element (scrolled into view first). */
  async function centerOf(sel, text) {
    const pos = await evaluate(`const el = find(${JSON.stringify(sel || "")}, ${JSON.stringify(text || "")});
      if (!el) return null; el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName };`);
    if (!pos) throw new Error(sel ? `No element matches ${sel}.` : `Couldn't find anything showing "${text}".`);
    return pos;
  }

  async function waitForLoad() {
    await sleep(200);
    const end = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < end) {
      try { if ((await evaluate("return document.readyState;")) === "complete") return; } catch { /* mid-navigation */ }
      await sleep(100);
    }
  }

  return {
    /** Starts a check: hook for errors, forget old ones. */
    async begin() {
      if (!hookId) hookId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: ERROR_HOOK })).identifier;
      try { await send("Runtime.evaluate", { expression: ERROR_HOOK }); } catch { /* ignore */ }
      errors = []; startedAt = new Date().toISOString();
      await harvest(); errors = [];
    },
    /** Removes the hook. */
    async end() { if (hookId) { try { await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: hookId }); } catch { /* tab gone */ } hookId = null; } },

    async goto(url) {
      const tab = await chrome.tabs.get(tabId);
      const full = new URL(url, tab.url).href;
      if (!(await getAppNameForUrl(full))) throw new Error(`${full} isn't on an allowed site.`);
      await harvest();
      await send("Page.navigate", { url: full });
      await waitForLoad();
    },
    async click({ selector, text }) {
      const p = await centerOf(selector, text);
      const at = { x: p.x, y: p.y, button: "left", clickCount: 1 };
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
      await sleep(150);
    },
    async type({ selector, text }) {
      const ok = await evaluate(`const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false; el.scrollIntoView({ block: "center" }); el.focus(); if (el.select) el.select(); return true;`);
      if (!ok) throw new Error(`No element matches ${selector}.`);
      await send("Input.insertText", { text });
    },
    async press(key) {
      const k = KEYS[key] || { code: /^.$/.test(key) ? `Key${key.toUpperCase()}` : key, vk: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, text: key.length === 1 ? key : undefined };
      const base = { key, code: k.code, windowsVirtualKeyCode: k.vk };
      await send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await sleep(150);
    },

    /** Is this expectation true right now? */
    async probe(step) {
      if (step.expect === "text" || step.expect === "no_text") {
        const has = await evaluate(`return document.body.innerText.toLowerCase().includes(${JSON.stringify(step.text.toLowerCase())});`);
        return step.expect === "text" ? { ok: has, detail: `"${step.text}" isn't on the page.` } : { ok: !has, detail: `"${step.text}" is on the page.` };
      }
      if (step.expect === "selector" || step.expect === "no_selector") {
        const shown = await evaluate(`const el = document.querySelector(${JSON.stringify(step.selector)}); return !!el && visible(el);`);
        return step.expect === "selector" ? { ok: shown, detail: `${step.selector} isn't visible.` } : { ok: !shown, detail: `${step.selector} is visible.` };
      }
      if (step.expect === "url") { const url = await evaluate("return location.href;"); return { ok: url.includes(step.contains), detail: `The URL is ${url}.` }; }
      if (step.expect === "no_console_errors") {
        await harvest();
        return errors.length ? { ok: false, detail: `Console error: ${errors[0]}` } : { ok: true };
      }
      if (step.expect === "request") {
        const mine = queryRequests({ tabId, limit: 50, includeBodies: false }).filter((r) => r.startedAt >= startedAt && r.url.includes(step.url_contains) && (!step.method || r.method === step.method));
        if (!mine.length) return { ok: false, detail: `No ${step.method || ""} request to ${step.url_contains} was made.`.replace("  ", " ") };
        const want = step.status || "";
        const hit = mine.find((r) => !want || (/^\dxx$/.test(want) ? String(r.status)[0] === want[0] : String(r.status) === want));
        return hit ? { ok: true } : { ok: false, detail: `${mine[0].method} ${mine[0].url} returned ${mine[0].status ?? mine[0].error}, expected ${want}.` };
      }
      return { ok: false, detail: "Unknown expectation." };
    },

    /** What the agent needs to see why it failed. */
    async evidence({ screenshot = true } = {}) {
      await harvest();
      const info = await evaluate("return { url: location.href, textSnippet: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 500) };").catch(() => ({}));
      const failedRequests = queryRequests({ tabId, limit: 30, includeBodies: false }).filter((r) => r.startedAt >= startedAt && (r.error || r.status >= 400))
        .slice(0, 5).map((r) => ({ method: r.method, url: r.url, status: r.status, error: r.error }));
      let shot = null;
      if (screenshot) { try { shot = (await send("Page.captureScreenshot", { format: "png" })).data; } catch { /* tab hidden */ } }
      return { ...info, consoleErrors: errors.slice(0, 5), failedRequests, screenshot: shot };
    },
  };
}
