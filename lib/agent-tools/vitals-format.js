/**
 * vitals-format.js — turns raw page measurements into rated Core Web Vitals, and compares two runs.
 * Pure (no browser APIs): unit-tested in Node.
 *
 * raw (from vitals.js, measured in the page):
 *   { page, navigation:{ttfbMs,fcpMs}, lcp:{ms,selector,url,tag}|null, cls:{value,shifts:[{value,selectors}]},
 *     inp:{ms,name,selector,inputDelayMs,processingMs,presentationMs,interactions}|null,
 *     longTasks:{count,totalBlockingMs,worst:[{ms}]} }
 */

/** [good up to, poor from] — the standard web.dev thresholds. */
export const THRESHOLDS = { lcpMs: [2500, 4000], inpMs: [200, 500], cls: [0.1, 0.25], fcpMs: [1800, 3000], ttfbMs: [800, 1800] };
/** A change smaller than this is noise, not a regression. */
export const NOISE = { lcpMs: 200, inpMs: 40, cls: 0.02, fcpMs: 150, ttfbMs: 100, totalBlockingMs: 50 };
const LABELS = { lcpMs: "LCP", inpMs: "INP", cls: "CLS", fcpMs: "FCP", ttfbMs: "TTFB", totalBlockingMs: "Blocking time" };

/** "good" | "needs work" | "poor" | null (not measured). */
export function rate(metric, value) {
  const t = THRESHOLDS[metric];
  if (value == null || !t) return null;
  return value <= t[0] ? "good" : value <= t[1] ? "needs work" : "poor";
}

/** What the agent should look at first, from the attribution. */
function culprits(raw, metrics) {
  const out = [];
  if (raw.lcp && metrics.lcpMs.rating !== "good") out.push(`LCP is ${raw.lcp.tag || "an element"} ${raw.lcp.selector || ""}${raw.lcp.url ? ` (${raw.lcp.url})` : ""}: make that the first thing to load (size, priority, no lazy-loading, preload).`.replace("  ", " "));
  if (raw.cls?.shifts?.length && metrics.cls.rating !== "good") out.push(`Layout shifts come from ${raw.cls.shifts.slice(0, 3).map((s) => `${(s.selectors || []).join(", ") || "unknown"} (${s.value})`).join("; ")}: reserve space (width/height, aspect-ratio) before content loads.`);
  if (raw.inp && metrics.inpMs.rating !== "good") {
    const i = raw.inp, big = Math.max(i.inputDelayMs, i.processingMs, i.presentationMs);
    const where = big === i.processingMs ? "the event handler itself is slow (split the work, defer it, or use a transition)" : big === i.inputDelayMs ? "the main thread was busy when the user acted (long tasks before the click)" : "rendering after the handler is slow (too much DOM or layout work)";
    out.push(`Slowest interaction: ${i.name} on ${i.selector || "?"}, ${i.ms}ms: ${where}.`);
  }
  if (raw.longTasks?.totalBlockingMs > 300) out.push(`${raw.longTasks.count} long tasks block the main thread for ${raw.longTasks.totalBlockingMs}ms in total: look for large scripts or synchronous work on load.`);
  return out;
}

/** Raw measurements -> report. */
export function buildVitals(raw) {
  const m = (metric, value) => ({ value, rating: rate(metric, value) });
  const metrics = {
    lcpMs: m("lcpMs", raw.lcp?.ms ?? null), inpMs: m("inpMs", raw.inp?.ms ?? null), cls: m("cls", raw.cls?.value ?? null),
    fcpMs: m("fcpMs", raw.navigation?.fcpMs ?? null), ttfbMs: m("ttfbMs", raw.navigation?.ttfbMs ?? null),
    totalBlockingMs: { value: raw.longTasks?.totalBlockingMs ?? null, rating: null },
  };
  const notes = [];
  if (!raw.inp) notes.push("INP needs an interaction: click or type in the page, then ask again (or use run_checks first).");
  if (!raw.lcp) notes.push("No largest-contentful-paint yet: the page may still be loading or in a background tab.");
  return { page: raw.page, metrics, attribution: { lcp: raw.lcp, cls: raw.cls, inp: raw.inp, longTasks: raw.longTasks }, fix_first: culprits(raw, metrics), notes,
    note: "Measured in this browser on this machine (lab conditions), the same way real users' browsers report vitals. Compare runs with the same setup." };
}

/** Compares a report with a saved baseline. Returns { verdict, changes } — regressions are listed first. */
export function compareVitals(current, baseline, { tolerance = 0.1 } = {}) {
  const changes = [];
  for (const key of Object.keys(LABELS)) {
    const now = current.metrics[key]?.value, was = baseline.metrics[key]?.value;
    if (now == null || was == null) continue;
    const delta = now - was, ratio = was ? delta / was : 0;
    const status = Math.abs(delta) < NOISE[key] || Math.abs(ratio) < tolerance ? "same" : delta > 0 ? "worse" : "better";
    const crossed = rate(key, now) !== rate(key, was) ? ` (${rate(key, was) || "?"} → ${rate(key, now) || "?"})` : "";
    changes.push({ metric: LABELS[key], was, now, delta: Math.round(delta * 1000) / 1000, status, ...(crossed ? { rating: crossed.trim() } : {}) });
  }
  changes.sort((a, b) => ({ worse: 0, better: 1, same: 2 }[a.status] - { worse: 0, better: 1, same: 2 }[b.status]));
  const worse = changes.filter((c) => c.status === "worse"), better = changes.filter((c) => c.status === "better");
  const verdict = worse.length ? "regressed" : better.length ? "improved" : "same";
  return { verdict, summary: worse.length ? `Regressed: ${worse.map((c) => `${c.metric} ${c.was} → ${c.now}`).join(", ")}` : better.length ? `Improved: ${better.map((c) => `${c.metric} ${c.was} → ${c.now}`).join(", ")}` : "No meaningful change.", changes };
}
