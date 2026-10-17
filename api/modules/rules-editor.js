/**
 * rules-editor.js — the "Tests" and "Extract" tabs of the request editor.
 *
 *   Tests:   [status ▾] [equals ▾] [200]                 a check on the response
 *            [json   ▾] data.id [exists ▾]
 *   Extract: save  token  from  data.token                carries a value to the next request
 *
 * Both are plain lists of rows with an "Add" button. Rows are stored exactly as the server
 * expects them (see server/api/assertions.js and runner.js).
 */

import { el, fill } from "./dom.js";

const TYPES = [["status", "Status"], ["json", "JSON field"], ["header", "Header"], ["body", "Body text"], ["time", "Time (ms)"], ["queries", "DB queries"]];
const OPS = ["equals", "not_equals", "contains", "exists", "not_exists", "gt", "lt", "matches", "type"];
const OP_LABEL = { equals: "equals", not_equals: "does not equal", contains: "contains", exists: "exists", not_exists: "doesn't exist", gt: "is greater than", lt: "is less than", matches: "matches regex", type: "has type" };
const NEEDS_VALUE = (op) => !["exists", "not_exists"].includes(op);
const DEFAULTS = { status: { op: "equals", value: "200" }, json: { op: "exists", path: "" }, header: { op: "contains", name: "content-type", value: "json" }, body: { op: "contains", value: "" }, time: { op: "lt", value: "1000" }, queries: { op: "lt", value: "10" } };

const select = (options, current, onchange) =>
  el("select", { onchange: (e) => onchange(e.target.value) }, options.map(([v, label]) => el("option", { value: v, selected: v === current }, label)));

/** Numbers typed in the value box are stored as numbers (so status 200 compares nicely). */
const coerce = (text) => (text !== "" && /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text);

/** @returns {{ set(tests): void, get(): object[] }} */
export function createTestsEditor(container, { onChange }) {
  let tests = [];

  function row(t, i) {
    const target = t.type === "json" ? el("input", { class: "rule-target", value: t.path || "", placeholder: "data.items[0].id", spellcheck: "false", oninput: (e) => { t.path = e.target.value; onChange(); } })
      : t.type === "header" ? el("input", { class: "rule-target", value: t.name || "", placeholder: "header name", spellcheck: "false", oninput: (e) => { t.name = e.target.value; onChange(); } })
      : null;
    const value = NEEDS_VALUE(t.op) ? el("input", { class: "rule-value", value: t.value ?? "", placeholder: t.op === "type" ? "array, object, string…" : "value", spellcheck: "false", onfocus: (e) => e.target.select(), oninput: (e) => { t.value = coerce(e.target.value); onChange(); } }) : null;
    return el("div", { class: "rule-row" },
      select(TYPES, t.type, (v) => { Object.assign(t, { type: v }, DEFAULTS[v]); render(); onChange(); }),
      target,
      select(OPS.map((o) => [o, OP_LABEL[o]]), t.op, (v) => { t.op = v; render(); onChange(); }),
      value,
      el("button", { type: "button", class: "kv-del", title: "Remove test", onclick: () => { tests.splice(i, 1); render(); onChange(); } }, "✕"));
  }

  function render() {
    fill(container,
      tests.length ? tests.map(row) : el("p", { class: "empty-hint" }, "No tests yet. Add a check, for example: Status equals 200."),
      el("button", { type: "button", class: "add-rule", onclick: () => { tests.push({ type: "status", ...DEFAULTS.status }); render(); onChange(); } }, "+ Add test"));
  }

  return { set(next) { tests = (next || []).map((t) => ({ ...t })); render(); }, get() { return tests.map((t) => ({ ...t })); } };
}

/** @returns {{ set(rules): void, get(): {var:string, from:string}[] }} */
export function createExtractEditor(container, { onChange }) {
  let rules = [];

  function render() {
    fill(container,
      el("p", { class: "empty-hint" }, "Save a value from the response into the environment, so later requests can use it as {{name}}. Example: save token from data.token (or header:x-request-id)."),
      rules.map((r, i) => el("div", { class: "rule-row" },
        "save", el("input", { class: "rule-target", value: r.var, placeholder: "token", spellcheck: "false", oninput: (e) => { r.var = e.target.value; onChange(); } }),
        "from", el("input", { class: "rule-value", value: r.from, placeholder: "data.token", spellcheck: "false", oninput: (e) => { r.from = e.target.value; onChange(); } }),
        el("button", { type: "button", class: "kv-del", title: "Remove", onclick: () => { rules.splice(i, 1); render(); onChange(); } }, "✕"))),
      el("button", { type: "button", class: "add-rule", onclick: () => { rules.push({ var: "", from: "" }); render(); onChange(); } }, "+ Add value"));
  }

  return { set(next) { rules = (next || []).map((r) => ({ ...r })); render(); }, get() { return rules.filter((r) => r.var && r.from); } };
}
