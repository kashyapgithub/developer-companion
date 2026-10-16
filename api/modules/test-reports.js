/**
 * test-reports.js — the dialogs for "Security check" and "Load / race test".
 * They only draw what the bridge returned (see server/api/security.js and load.js).
 */

import { el, fill } from "./dom.js";

const ICON = { pass: "✓", fail: "✗", warn: "!", skip: "–" };
const closeRow = (dialog, ...extra) => el("div", { class: "dlg-actions" }, el("span", { class: "spacer" }), ...extra, el("button", { class: "primary", onclick: () => dialog.close() }, "Close"));

/** One security report: counts, then every probe with what it found. */
function securityBlock(report) {
  if (report.error) return el("p", { class: "error-text" }, `${report.request}: ${report.error}`);
  const s = report.summary;
  return el("div", { class: "sec-report" },
    el("div", { class: "sec-head" }, el("b", {}, report.request),
      el("span", { class: "chip bad" }, `${s.fail} fail`), el("span", { class: "chip warn" }, `${s.warn} warn`), el("span", { class: "chip ok" }, `${s.pass} pass`), el("span", { class: "chip" }, `${s.skip} skipped`)),
    report.probes.map((p) => el("div", { class: `probe ${p.status}` },
      el("span", { class: "probe-mark" }, ICON[p.status]), el("div", {}, el("div", { class: "probe-title" }, p.title), el("div", { class: "muted" }, p.detail)))));
}

/** @param {HTMLDialogElement} dialog @param {{ reports: object[], title?: string, onTokenChange?: Function }} data */
export function showSecurityReport(dialog, { reports, title = "Security check" }) {
  fill(dialog, el("div", { class: "dlg-body wide" }, el("h3", {}, title),
    el("p", { class: "empty-hint" }, "These send throwaway copies of your request with credentials removed, extra fields added, broken or hostile input. Only test servers you own."),
    el("div", { class: "report-scroll" }, reports.map(securityBlock)), closeRow(dialog)));
  dialog.showModal();
}

/** Load or race result as a small table plus the one-line verdict. */
export function showStressReport(dialog, report) {
  const rows = report.error ? [] : report.mode === "load"
    ? [["Requests", `${report.requests} (${report.concurrency} at a time)`], ["Took", `${report.seconds}s · ${report.requestsPerSecond} req/s`], ["Latency p50 / p95 / p99", `${report.latencyMs.p50} / ${report.latencyMs.p95} / ${report.latencyMs.p99} ms (max ${report.latencyMs.max})`],
       ["Statuses", Object.entries(report.statuses).map(([k, v]) => `${k}×${v}`).join("  ")], ["Error rate", `${report.errorRate}%`]]
    : [["Sent at the same instant", String(report.simultaneous)], ["Succeeded", String(report.succeeded)], ["Different records created", String(report.distinctRecords)],
       ["Statuses", Object.entries(report.statuses).map(([k, v]) => `${k}×${v}`).join("  ")], ["Ids seen", (report.ids || []).join(", ") || "none"]];
  const bad = !report.error && (/failed|crash|different records|took over/.test(report.verdict));
  fill(dialog, el("div", { class: "dlg-body" }, el("h3", {}, report.mode === "race" ? "Double-submit test" : "Load test"),
    el("p", { class: "muted" }, report.request || ""),
    report.error ? el("p", { class: "error-text" }, report.error) : el("div", {},
      el("p", { class: `verdict ${bad ? "bad" : "ok"}` }, report.verdict),
      rows.map(([k, v]) => el("div", { class: "hdr-row" }, el("b", {}, k), el("span", {}, v))),
      (report.errors || []).length ? el("div", {}, el("h3", {}, "Errors"), report.errors.map((e) => el("div", { class: "muted" }, `${e.count}× ${e.message}`))) : null),
    closeRow(dialog)));
  dialog.showModal();
}
