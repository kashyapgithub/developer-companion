/**
 * vitals.js — real-user-style Core Web Vitals for the open tab: LCP, INP, CLS (+ FCP, TTFB, long tasks)
 * with attribution (which element, which interaction). collectInPage() runs INSIDE the page.
 *
 * INP only exists after a real interaction, so run_checks (or the user) should click first.
 */

import { buildVitals } from "./vitals-format.js";
import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger } from "../debugger-capture.js";
import { noTab } from "./index-helpers.js";

/** Runs in the page (self-contained). Returns the raw measurements. */
export async function collectInPage() {
  const sel = (el) => {
    if (!el || !el.tagName) return "";
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls;
  };
  const read = (type, extra = {}) => new Promise((resolve) => {
    const seen = [];
    try { new PerformanceObserver((l) => seen.push(...l.getEntries())).observe({ type, buffered: true, ...extra }); } catch { return resolve([]); }
    setTimeout(() => resolve(seen), 120);
  });
  const [lcpList, shiftList, eventList, taskList] = await Promise.all([
    read("largest-contentful-paint"), read("layout-shift"), read("event", { durationThreshold: 16 }), read("longtask"),
  ]);

  const nav = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  const lcpEntry = lcpList[lcpList.length - 1];

  // CLS: the worst "session window" (shifts less than 1s apart, window up to 5s), as web.dev defines it.
  let best = { value: 0, shifts: [] }, cur = { value: 0, shifts: [], start: 0, last: 0 };
  for (const s of shiftList.filter((x) => !x.hadRecentInput)) {
    if (!cur.shifts.length || s.startTime - cur.last > 1000 || s.startTime - cur.start > 5000) cur = { value: 0, shifts: [], start: s.startTime, last: s.startTime };
    cur.value += s.value; cur.last = s.startTime;
    cur.shifts.push({ value: Number(s.value.toFixed(3)), selectors: (s.sources || []).map((x) => sel(x.node)).filter(Boolean).slice(0, 2) });
    if (cur.value > best.value) best = { value: cur.value, shifts: cur.shifts.slice() };
  }

  // INP: one interaction = all its events (pointerdown, pointerup, click share an id). Its duration is the longest
  // event; the time is split into waiting (input delay), running handlers, and painting afterwards.
  const groups = new Map();
  for (const e of eventList) if (e.interactionId) { if (!groups.has(e.interactionId)) groups.set(e.interactionId, []); groups.get(e.interactionId).push(e); }
  const interactions = [...groups.values()].map((es) => {
    const longest = es.reduce((a, e) => (e.duration > a.duration ? e : a));
    const slowest = es.reduce((a, e) => (e.processingEnd - e.processingStart > a.processingEnd - a.processingStart ? e : a));
    const inputDelayMs = Math.max(0, Math.min(...es.map((e) => e.processingStart - e.startTime)));
    const processingMs = es.reduce((a, e) => a + (e.processingEnd - e.processingStart), 0);
    return { duration: longest.duration, name: slowest.name, target: slowest.target || longest.target, inputDelayMs, processingMs, presentationMs: Math.max(0, longest.duration - inputDelayMs - processingMs) };
  }).sort((a, b) => b.duration - a.duration);
  const pick = interactions[Math.min(Math.floor(interactions.length / 50), interactions.length - 1)];

  const blocking = taskList.reduce((a, t) => a + Math.max(0, t.duration - 50), 0);
  return {
    page: { url: location.href, title: document.title },
    navigation: { ttfbMs: nav ? Math.round(nav.responseStart) : null, fcpMs: fcp ? Math.round(fcp.startTime) : null },
    lcp: lcpEntry ? { ms: Math.round(lcpEntry.startTime), selector: sel(lcpEntry.element), tag: lcpEntry.element?.tagName?.toLowerCase() || "", url: (lcpEntry.url || "").slice(0, 160), size: lcpEntry.size } : null,
    cls: { value: Number(best.value.toFixed(3)), shifts: best.shifts.sort((a, b) => b.value - a.value).slice(0, 5) },
    inp: pick ? { ms: Math.round(pick.duration), name: pick.name, selector: sel(pick.target), inputDelayMs: Math.round(pick.inputDelayMs), processingMs: Math.round(pick.processingMs), presentationMs: Math.round(pick.presentationMs), interactions: interactions.length } : null,
    longTasks: { count: taskList.length, totalBlockingMs: Math.round(blocking), worst: taskList.map((t) => ({ ms: Math.round(t.duration) })).sort((a, b) => b.ms - a.ms).slice(0, 3) },
  };
}

/** Agent command: measure the open tab. payload { url_contains?, reload? } */
export async function vitalsCommand(payload = {}) {
  const tab = await pickAllowedTab(payload.url_contains);
  if (!tab) return noTab(payload.url_contains);
  await attachDebugger(tab.id);
  const send = (method, params) => chrome.debugger.sendCommand({ tabId: tab.id }, method, params);
  if (payload.reload) {
    await send("Page.reload");
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < 100; i++) { const s = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }).catch(() => null); if (s?.result?.value === "complete") break; await new Promise((r) => setTimeout(r, 100)); }
    await new Promise((r) => setTimeout(r, 600));
  }
  const res = await send("Runtime.evaluate", { expression: `(${collectInPage.toString()})()`, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails || !res.result?.value) return { status: "failed", result: { error: "Couldn't measure the page." } };
  return { status: "done", result: buildVitals(res.result.value) };
}
