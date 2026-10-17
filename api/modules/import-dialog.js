/**
 * import-dialog.js — "Import": paste a curl command or a Postman export, or pick a .json file.
 * The server works out which one it is (curl / Postman collection / Postman environment).
 */

import { el, fill } from "./dom.js";
import { api } from "./client.js";

/** What the server reports about a Postman import, as short sentences (nothing is hidden silently). */
export function importNotes(n = {}) {
  const out = [];
  if (n.testsConverted || n.extractsConverted) out.push(`turned scripts into ${n.testsConverted || 0} test${n.testsConverted === 1 ? "" : "s"} and ${n.extractsConverted || 0} extract rule${n.extractsConverted === 1 ? "" : "s"}`);
  if (n.preRequestScripts) out.push(`${n.preRequestScripts} pre-request script${n.preRequestScripts > 1 ? "s" : ""} not imported (set those values by hand)`);
  const left = (n.scripts || 0) - (n.preRequestScripts || 0);
  if (left > 0) out.push(`${left} script${left > 1 ? "s" : ""} had lines that can't be converted${n.ignoredLines?.length ? `, e.g. "${n.ignoredLines[0]}"` : ""}`);
  if (n.unsupportedBodies) out.push(`${n.unsupportedBodies} file/form-data bod${n.unsupportedBodies > 1 ? "ies" : "y"} skipped`);
  return out;
}

/** One-line summary of what an import created. */
export function describeImport(r) {
  if (r.kind === "curl") return `Imported ${r.request.method} ${r.request.url}`;
  if (r.kind === "environment") return `Imported environment "${r.environment.name}"`;
  const n = r.collection.requests.length;
  const list = importNotes(r.notes);
  const notes = list.length ? ` — ${list.join("; ")}` : "";
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
