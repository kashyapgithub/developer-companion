/**
 * captured.js — "From browser traffic": pick calls your app made (fetch / XHR) and turn them
 * into saved requests. The extension service worker holds the recorded traffic, so we ask it.
 * Secrets were masked when recorded; see lib/captured-to-request.js for how that is handled.
 */

import { el, fill } from "./dom.js";
import { api } from "./client.js";

/** Asks the service worker for recent API calls already converted to request drafts. */
const fetchCaptured = () => chrome.runtime.sendMessage({ type: "API_CAPTURED" });

/**
 * @param {HTMLDialogElement} dialog
 * @param {{ getCollectionId(): string, ensureCollection(): Promise<string>, onImported(summary: string): Promise<void>, onError(msg: string): void }} cb
 */
export function createCapturedDialog(dialog, cb) {
  async function open() {
    fill(dialog, el("div", { class: "dlg-body" }, el("h3", {}, "From browser traffic"), el("p", { class: "empty-hint" }, "Loading…")));
    dialog.showModal();
    const res = await fetchCaptured().catch(() => null);
    const items = res?.items || [];
    const boxes = items.map((it) => el("input", { type: "checkbox", checked: false }));

    const add = async () => {
      const picked = items.filter((_, i) => boxes[i].checked);
      if (!picked.length) return;
      try {
        const collectionId = await cb.ensureCollection();
        for (const it of picked) await api.saveRequest(collectionId, it.request);
        dialog.close(); await cb.onImported(`Added ${picked.length} request${picked.length > 1 ? "s" : ""} from browser traffic`);
      } catch (e) { cb.onError(e.message); }
    };

    fill(dialog, el("div", { class: "dlg-body" },
      el("h3", {}, "From browser traffic"),
      el("p", { class: "empty-hint" }, res?.note || "Calls your app made recently. Tokens were hidden when recorded, so auth is added as {{token}} for you to fill in."),
      items.length ? el("div", { class: "cap-list" }, items.map((it, i) => el("label", { class: "cap-row" }, boxes[i],
        el("span", { class: `m m-${it.request.method.toLowerCase()}` }, it.request.method), el("span", { class: "req-name" }, it.request.url),
        el("span", { class: `st ${it.status >= 400 || !it.status ? "bad" : "ok"}` }, it.status || "—")))) : el("p", { class: "empty-hint" }, "Nothing recorded yet. Open your app in a tab with the extension, use it, then come back."),
      el("div", { class: "dlg-actions" }, el("span", { class: "spacer" }), el("button", { onclick: () => dialog.close() }, "Close"),
        items.length ? el("button", { class: "primary", onclick: add }, "Add selected") : null)));
  }
  return { open };
}
