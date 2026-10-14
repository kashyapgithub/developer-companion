/**
 * audit-format.js — ranks and summarises raw audit findings. Pure, no browser APIs.
 *
 * Input is what auditInPage() collects: a list of issues {rule, severity, selector, detail}
 * and a metrics object. Output is sorted by severity, grouped counts, and plain-language
 * performance verdicts using the standard "good / needs work / poor" thresholds.
 */

const SEVERITY_ORDER = { serious: 0, moderate: 1, minor: 2 };

/** Web-vitals style thresholds: [good up to, poor from]. */
const THRESHOLDS = {
  lcpMs: [2500, 4000],
  fcpMs: [1800, 3000],
  cls: [0.1, 0.25],
};

/** Rates one metric value: "good", "needs work" or "poor" (null if unmeasured). */
export function rate(metric, value) {
  const t = THRESHOLDS[metric];
  if (value == null || !t) return null;
  return value <= t[0] ? "good" : value <= t[1] ? "needs work" : "poor";
}

/** Sorts issues serious-first and keeps a readable cap per rule. */
export function rankIssues(issues = [], perRule = 5) {
  const seen = {};
  return [...issues]
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    .filter((i) => (seen[i.rule] = (seen[i.rule] || 0) + 1) <= perRule);
}

/** Counts issues per rule (before the per-rule cap) so nothing looks smaller than it is. */
export function countByRule(issues = []) {
  const counts = {};
  for (const i of issues) counts[i.rule] = (counts[i.rule] || 0) + 1;
  return counts;
}

/** Raw audit -> final report. */
export function buildAudit(raw) {
  const m = raw.metrics || {};
  return {
    page: raw.page,
    accessibility: { total_issues: raw.issues.length, by_rule: countByRule(raw.issues), issues: rankIssues(raw.issues) },
    performance: {
      ...m,
      verdicts: { lcp: rate("lcpMs", m.lcpMs), fcp: rate("fcpMs", m.fcpMs), cls: rate("cls", m.cls) },
    },
    note: "Quick checks, not a full WCAG audit. Contrast is sampled from visible text.",
  };
}
