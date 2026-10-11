/**
 * page-actions.js — lets the agent DRIVE an allowed tab (service worker side).
 *
 * Together with start_recording / stop_recording this closes the loop: the
 * agent starts a recording, clicks through the app to reproduce a bug, stops,
 * and reads what went wrong, with nobody pressing anything.
 *
 * Safety: only tabs on allowed sites (localhost by default) are ever touched,
 * and navigation can only go to an allowed site too.
 */

import { getAppNameForUrl } from "./allowlist.js";
import { attachDebugger } from "./debugger-capture.js";

const SETTLE_MS = 400; // let the page react before the agent looks again

/** The open tab on an allowed site that matches `urlContains` (active one preferred), or null. */
export async function pickAllowedTab(urlContains) {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  const allowed = [];
  for (const tab of tabs) {
    if (urlContains && !tab.url.includes(urlContains)) continue;
    if (await getAppNameForUrl(tab.url)) allowed.push(tab);
  }
  return allowed.find((t) => t.active) || allowed[0] || null;
}

/** Runs a function-body string in the page and returns its JSON-able result. */
async function evaluate(tabId, body) {
  const res = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression: `(() => { ${body} })()`,
    returnByValue: true,
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || "page script failed");
  return res.result?.value;
}

/** Page-side snippets, one per action. `sel`/`val` are already JSON-encoded. */
const SNIPPETS = {
  click: (sel) => `const el = document.querySelector(${sel});
    if (!el) return { ok: false, error: "No element matches that selector." };
    el.scrollIntoView({ block: "center" }); el.click();
    return { ok: true, clicked: (el.innerText || el.value || el.tagName).trim().slice(0, 60) };`,
  fill: (sel, val) => `const el = document.querySelector(${sel});
    if (!el) return { ok: false, error: "No element matches that selector." };
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${val});   // works with React-style inputs
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };`,
};

/**
 * Performs one action.
 * @param {{action:"click"|"fill"|"navigate"|"reload", selector?:string, value?:string, url?:string, url_contains?:string}} req
 * @returns {Promise<{status:"done"|"failed", result:object}>}
 */
export async function runPageAction(req) {
  const tab = await pickAllowedTab(req.url_contains);
  if (!tab) return fail(`No open tab on an allowed site${req.url_contains ? ` matching "${req.url_contains}"` : ""}.`);
  await attachDebugger(tab.id);
  const send = (method, params) => chrome.debugger.sendCommand({ tabId: tab.id }, method, params);

  try {
    let result;
    switch (req.action) {
      case "click":
      case "fill":
        if (!req.selector) return fail("selector is required.");
        if (req.action === "fill" && typeof req.value !== "string") return fail("value is required for fill.");
        result = await evaluate(tab.id, SNIPPETS[req.action](JSON.stringify(req.selector), JSON.stringify(req.value)));
        if (!result?.ok) return fail(result?.error || "Action failed.");
        break;
      case "navigate":
        if (!req.url || !(await getAppNameForUrl(req.url))) return fail("That URL isn't on an allowed site.");
        await send("Page.navigate", { url: req.url });
        result = { ok: true };
        break;
      case "reload":
        await send("Page.reload");
        result = { ok: true };
        break;
      default:
        return fail(`Unknown action "${req.action}". Use click, fill, navigate or reload.`);
    }
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    return { status: "done", result: { ...result, url: tab.url } };
  } catch (err) {
    return fail(String(err?.message || err));
  }
}

const fail = (error) => ({ status: "failed", result: { error } });
