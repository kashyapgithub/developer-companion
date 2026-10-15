/**
 * ask-dialog.js — a small "type a name" / "are you sure" dialog.
 * (window.prompt and confirm are unreliable in extension windows, so we use <dialog>.)
 */

import { el, fill } from "./dom.js";

/** @returns {Promise<string|null>} the typed text, or null when cancelled */
export function askText(dialog, title, initial = "") {
  return new Promise((resolve) => {
    const input = el("input", { value: initial, spellcheck: "false" });
    const done = (value) => { dialog.close(); resolve(value); };
    fill(dialog, el("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); done(input.value.trim() || null); } },
      el("h3", {}, title), input,
      el("div", { class: "dlg-actions" }, el("button", { type: "button", onclick: () => done(null) }, "Cancel"), el("button", { type: "submit", class: "primary" }, "OK"))));
    dialog.oncancel = () => resolve(null);
    dialog.showModal(); input.focus(); input.select();
  });
}

/** @returns {Promise<boolean>} */
export function askConfirm(dialog, message, okLabel = "Delete") {
  return new Promise((resolve) => {
    const done = (value) => { dialog.close(); resolve(value); };
    fill(dialog, el("form", { method: "dialog", onsubmit: (e) => { e.preventDefault(); done(true); } },
      el("p", {}, message),
      el("div", { class: "dlg-actions" }, el("button", { type: "button", onclick: () => done(false) }, "Cancel"), el("button", { type: "submit", class: "danger" }, okLabel))));
    dialog.oncancel = () => resolve(false);
    dialog.showModal();
  });
}
