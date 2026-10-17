/**
 * response-view.js — shows what came back from a request.
 *
 *   [200 OK]  84 ms  1.2 KB        status chip is green / amber / red by class
 *   Body | Headers | Tests (2/3)
 */

import { el, fill, humanBytes, prettyJson } from "./dom.js";

const statusClass = (s) => (s >= 500 ? "bad" : s >= 400 ? "warn" : s >= 300 ? "info" : "ok");

/**
 * @param {{ bar: HTMLElement, body: HTMLElement, headers: HTMLElement, tests: HTMLElement, testsTab: HTMLElement }} els
 */
export function createResponseView(els) {
  /** Clears everything back to the "nothing sent yet" state. */
  function reset(message = "Send a request to see the response here.") {
    fill(els.bar, el("span", { class: "muted" }, message));
    fill(els.body); fill(els.headers); fill(els.tests);
    els.testsTab.textContent = "Tests";
  }

  function showError(result) {
    fill(els.bar, el("span", { class: "chip bad" }, "Failed"), el("span", { class: "muted" }, result.durationMs != null ? `${result.durationMs} ms` : ""));
    fill(els.body, el("pre", { class: "error-text" }, result.error || "The request failed."));
    fill(els.headers); fill(els.tests);
    els.testsTab.textContent = "Tests";
  }

  /** Test results as a pass/fail list. */
  function renderTests(tests) {
    if (!tests.length) return fill(els.tests, el("p", { class: "empty-hint" }, "This request has no tests."));
    fill(els.tests, tests.map((t) => el("div", { class: `test-row ${t.pass ? "pass" : "fail"}` },
      el("span", { class: "test-mark" }, t.pass ? "✓" : "✗"), el("span", {}, t.name),
      !t.pass && t.actual !== undefined ? el("span", { class: "muted" }, ` — got ${JSON.stringify(t.actual)}`) : null)));
  }

  /** @param {object} r result from the server */
  function show(r) {
    if (!r.ok) return showError(r);
    const passed = r.tests.filter((t) => t.pass).length;
    fill(els.bar,
      el("span", { class: `chip ${statusClass(r.status)}` }, `${r.status} ${r.statusText || ""}`.trim()),
      el("span", {}, `${r.durationMs} ms`), el("span", {}, humanBytes(r.size)),
      r.queries ? el("span", { class: `chip ${r.queryAdvice ? "warn" : ""}`, title: r.queryAdvice || "Database queries this request ran" }, `${r.queries.count} queries`) : null,
      r.truncated ? el("span", { class: "chip warn" }, "body cut at 2 MB") : null,
      r.tests.length ? el("span", { class: `chip ${r.testsPassed ? "ok" : "bad"}` }, `${passed}/${r.tests.length} tests`) : null);
    fill(els.body, el("pre", { class: "resp-body" }, r.isJson ? prettyJson(r.body) : r.body || "(empty body)"));
    fill(els.headers, Object.entries(r.headers).map(([k, v]) => el("div", { class: "hdr-row" }, el("b", {}, k), el("span", {}, v))));
    renderTests(r.tests);
    els.testsTab.textContent = r.tests.length ? `Tests (${passed}/${r.tests.length})` : "Tests";
  }

  reset();
  return { show, reset };
}
