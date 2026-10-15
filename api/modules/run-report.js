/** run-report.js — the dialog that shows the outcome of "run every request in a collection". */

import { el, fill } from "./dom.js";

/** @param {HTMLDialogElement} dialog @param {object} run result of /apiclient/run-collection */
export function showRunReport(dialog, run) {
  fill(dialog, el("div", { class: "dlg-body" },
    el("h3", {}, `${run.collection}: ${run.passed}/${run.ran} passed`),
    el("div", { class: "cap-list" }, run.results.map((r) => {
      const good = r.ok && r.testsPassed;
      const failedTests = (r.tests || []).filter((t) => !t.pass).map((t) => t.name);
      return el("div", { class: `cap-row ${good ? "" : "fail-row"}` },
        el("span", { class: `st ${good ? "ok" : "bad"}` }, good ? "✓" : "✗"),
        el("span", { class: `m m-${String(r.method || "get").toLowerCase()}` }, r.method || ""),
        el("span", { class: "req-name", title: r.url }, r.name),
        el("span", { class: "muted" }, r.ok ? `${r.status} · ${r.durationMs} ms` : r.error),
        failedTests.length ? el("span", { class: "muted full" }, `Failed: ${failedTests.join(", ")}`) : null);
    })),
    el("div", { class: "dlg-actions" }, el("span", { class: "spacer" }), el("button", { class: "primary", onclick: () => dialog.close() }, "Close"))));
  dialog.showModal();
}
