/**
 * kv-table.js — an editable list of key / value rows (query params, headers, form fields).
 *
 *   [x] key   value   ✕        each row can be switched off without deleting it
 *   An empty row is always kept at the bottom, so typing in it adds the next one.
 */

import { el, fill } from "./dom.js";

/**
 * @param {HTMLElement} container
 * @param {{ onChange: () => void, keyPlaceholder?: string, valuePlaceholder?: string }} opts
 * @returns {{ set(rows): void, get(): {key,value,enabled}[] }}
 */
export function createKvTable(container, { onChange, keyPlaceholder = "key", valuePlaceholder = "value" }) {
  let rows = [];

  const isBlank = (r) => !r.key && !r.value;

  /** Keeps exactly one blank row at the end. */
  function normalise() {
    rows = rows.filter((r, i) => !isBlank(r) || i === rows.length - 1);
    if (!rows.length || !isBlank(rows[rows.length - 1])) rows.push({ key: "", value: "", enabled: true });
  }

  function render() {
    normalise();
    fill(container, ...rows.map((row, i) => el("div", { class: "kv-row" },
      el("input", { type: "checkbox", class: "kv-on", checked: row.enabled !== false, title: "Include this row", onchange: (e) => { row.enabled = e.target.checked; onChange(); } }),
      el("input", { class: "kv-key", value: row.key, placeholder: keyPlaceholder, spellcheck: "false", oninput: (e) => edit(i, "key", e.target.value) }),
      el("input", { class: "kv-value", value: row.value, placeholder: valuePlaceholder, spellcheck: "false", oninput: (e) => edit(i, "value", e.target.value) }),
      el("button", { class: "kv-del", type: "button", title: "Remove row", onclick: () => { rows.splice(i, 1); render(); onChange(); } }, "✕"),
    )));
  }

  /** Typing in the last (blank) row turns it into a real row and adds a new blank one, without losing focus. */
  function edit(i, field, value) {
    const wasBlank = isBlank(rows[i]);
    rows[i][field] = value;
    onChange();
    if (wasBlank && i === rows.length - 1) {
      const focused = document.activeElement;
      const col = focused?.classList.contains("kv-value") ? ".kv-value" : ".kv-key";
      const caret = focused?.selectionStart;
      render();
      const again = container.querySelectorAll(".kv-row")[i]?.querySelector(col);
      again?.focus(); if (caret != null) again?.setSelectionRange(caret, caret);
    }
  }

  return {
    set(next) { rows = (next || []).map((r) => ({ key: r.key ?? "", value: r.value ?? "", enabled: r.enabled !== false })); render(); },
    get() { return rows.filter((r) => !isBlank(r)).map((r) => ({ ...r })); },
  };
}
