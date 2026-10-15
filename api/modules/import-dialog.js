/**
 * import-dialog.js — "Import": paste a curl command or a Postman export, or pick a .json file.
 * The server works out which one it is (curl / Postman collection / Postman environment).
 */

import { el, fill } from "./dom.js";
import { api } from "./client.js";

/** One-line summary of what an import created. */
export function describeImport(r) {
  if (r.kind === "curl") return `Imported ${r.request.method} ${r.request.url}`;
  if (r.kind === "environment") return `Imported environment "${r.environment.name}"`;
  const n = r.collection.requests.length;
  const notes = (r.notes || []).length ? ` (${r.notes.length} note${r.notes.length > 1 ? "s" : ""}: ${r.notes.slice(0, 2).join("; ")})` : "";
  return `Imported "${r.collection.name}" with ${n} request${n === 1 ? "" : "s"}${notes}`;
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {{ getCollectionId(): string, onImported(r: object, summary: string): Promise<void>, onError(msg: string): void }} cb
 */
export function createImportDialog(dialog, cb) {
  /** Opens the dialog with an empty text box. */
  function open() {
    const text = el("textarea", { rows: 10, placeholder: "curl https://api.example.com/users -H 'Authorization: Bearer …'\n\n…or paste a Postman collection / environment (JSON)", spellcheck: "false" });
    const file = el("input", { type: "file", accept: ".json,application/json", onchange: async (e) => { const f = e.target.files[0]; if (f) text.value = await f.text(); } });
    const run = async () => {
      try {
        const result = await api.importText(text.value, cb.getCollectionId());
        dialog.close(); await cb.onImported(result, describeImport(result));
      } catch (e) { cb.onError(e.message); }
    };
    fill(dialog, el("div", { class: "dlg-body" },
      el("h3", {}, "Import"), text,
      el("label", {}, "…or choose a Postman .json file", file),
      el("div", { class: "dlg-actions" }, el("span", { class: "spacer" }), el("button", { onclick: () => dialog.close() }, "Cancel"), el("button", { class: "primary", onclick: run }, "Import"))));
    dialog.showModal(); text.focus();
  }
  return { open };
}
