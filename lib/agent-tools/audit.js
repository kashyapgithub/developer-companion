/**
 * audit.js — quick accessibility + performance scan of the open page.
 *
 * auditInPage() runs INSIDE the page (self-contained). It returns raw issues and
 * metrics; audit-format.js ranks them. Checks are deliberately simple and fast.
 */

import { buildAudit } from "./audit-format.js";
import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger } from "../debugger-capture.js";
import { noTab } from "./index-helpers.js";

/** Runs in the page. Returns a promise of { page, issues, metrics }. */
export async function auditInPage() {
  const issues = [];
  const add = (rule, severity, el, detail) => issues.push({ rule, severity, selector: describe(el), detail });

  /** Short CSS-ish description of an element, for the agent to find it. */
  function describe(el) {
    if (!el || !el.tagName) return "";
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + id + cls;
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const nameOf = (el) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || el.textContent || "").trim();

  // ---- accessibility ----
  if (!document.documentElement.lang) add("missing-lang", "moderate", document.documentElement, "<html> has no lang attribute");
  if (!document.title.trim()) add("missing-title", "moderate", document.head, "Page has no <title>");
  for (const img of document.querySelectorAll("img")) if (!img.hasAttribute("alt") && visible(img)) add("image-alt", "serious", img, "Image has no alt attribute");
  for (const b of document.querySelectorAll("button, [role=button]")) if (visible(b) && !nameOf(b) && !b.querySelector("img[alt]:not([alt=''])")) add("button-name", "serious", b, "Button has no accessible name");
  for (const a of document.querySelectorAll("a[href]")) if (visible(a) && !nameOf(a) && !a.querySelector("img[alt]:not([alt=''])")) add("link-name", "serious", a, "Link has no accessible name");
  for (const f of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")) {
    const labelled = f.getAttribute("aria-label") || f.getAttribute("aria-labelledby") || f.getAttribute("title") || (f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`)) || f.closest("label");
    if (visible(f) && !labelled) add("form-label", "serious", f, "Form field has no label");
  }
  let prev = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const level = Number(h.tagName[1]);
    if (prev && level > prev + 1) add("heading-order", "minor", h, `Jumps from h${prev} to h${level}`);
    prev = level;
  }
  if (document.querySelectorAll("h1").length !== 1) add("h1-count", "minor", document.body, `Page has ${document.querySelectorAll("h1").length} <h1> (expected 1)`);
  for (const el of document.querySelectorAll("[tabindex]")) if (Number(el.getAttribute("tabindex")) > 0) add("tabindex-positive", "minor", el, "Positive tabindex disrupts keyboard order");

  // Contrast (sampled): resolve the first opaque background up the tree.
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const rgba = (s) => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 1]; };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if ((c[3] ?? 1) > 0.95) return c; } return [255, 255, 255]; };
  let sampled = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (sampled >= 300) break;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || !visible(el)) continue;
    sampled++;
    const cs = getComputedStyle(el); const fg = rgba(cs.color); const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) add("color-contrast", "serious", el, `Contrast ${ratio.toFixed(2)}:1 (needs ${large ? 3 : 4.5}:1)`);
  }

  // ---- performance ----
  const nav = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  const observe = (type) => new Promise((resolve) => {
    const seen = [];
    try { new PerformanceObserver((l) => seen.push(...l.getEntries())).observe({ type, buffered: true }); } catch { return resolve([]); }
    setTimeout(() => resolve(seen), 150);
  });
  const [lcpEntries, shifts] = await Promise.all([observe("largest-contentful-paint"), observe("layout-shift")]);
  const res = performance.getEntriesByType("resource");
  const metrics = {
    fcpMs: fcp ? Math.round(fcp.startTime) : null,
    lcpMs: lcpEntries.length ? Math.round(lcpEntries[lcpEntries.length - 1].startTime) : null,
    cls: Number(shifts.filter((s) => !s.hadRecentInput).reduce((a, s) => a + s.value, 0).toFixed(3)),
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    requests: res.length,
    transferKb: Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
    domNodes: document.getElementsByTagName("*").length,
    slowestResources: res.sort((a, b) => b.duration - a.duration).slice(0, 3).map((r) => ({ url: r.name.slice(0, 120), ms: Math.round(r.duration) })),
  };
  return { page: { url: location.href, title: document.title }, issues, metrics };
}

/** Agent command: audit the open tab on an allowed site. */
export async function auditCommand(payload = {}) {
  const tab = await pickAllowedTab(payload.url_contains);
  if (!tab) return noTab(payload.url_contains);
  await attachDebugger(tab.id);
  const res = await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.evaluate", {
    expression: `(${auditInPage.toString()})()`, returnByValue: true, awaitPromise: true,
  });
  if (res.exceptionDetails || !res.result?.value) return { status: "failed", result: { error: "Couldn't audit the page." } };
  return { status: "done", result: buildAudit(res.result.value) };
}
