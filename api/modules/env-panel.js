/**
 * env-panel.js — the environment picker in the top bar and its edit dialog.
 *
 * An environment is a named set of variables ({{baseUrl}}, {{token}} …). The picker chooses
 * which one is active; the dialog edits one (or creates / deletes).
 */

import { el, fill } from "./dom.js";
import { createKvTable } from "./kv-table.js";
import { api } from "./client.js";

/**
 * @param {{ select: HTMLSelectElement, editBtn: HTMLElement, dialog: HTMLDialogElement }} els
 * @param {{ onChanged(): Promise<void>, onError(msg: string): void }} cb
 */
export function createEnvPanel(els, cb) {
  let envs = [];

  els.select.addEventListener("change", async () => {
    try { await api.setActiveEnvironment(els.select.value); await cb.onChanged(); } catch (e) { cb.onError(e.message); }
  });
  els.editBtn.addEventListener("click", () => open(envs.find((e) => e.id === els.select.value) || null));

  /** Opens the dialog for an existing environment, or a blank one when `env` is null. */
  function open(env) {
    const name = el("input", { value: env?.name || "", placeholder: "e.g. Local, Staging", spellcheck: "false" });
    const table = el("div", { class: "kv" });
    const kv = createKvTable(table, { onChange() {}, keyPlaceholder: "variable", valuePlaceholder: "value" });
    kv.set(Object.entries(env?.variables || {}).map(([key, value]) => ({ key, value })));

    const save = async () => {
      const variables = Object.fromEntries(kv.get().filter((r) => r.enabled !== false).map((r) => [r.key.trim(), r.value]));
      try {
        const saved = await api.saveEnvironment({ id: env?.id, name: name.value, variables });
        await api.setActiveEnvironment(saved.environment.id); els.dialog.close(); await cb.onChanged();
      } catch (e) { cb.onError(e.message); }
    };
    const remove = async () => { try { await api.deleteEnvironment(env.id); els.dialog.close(); await cb.onChanged(); } catch (e) { cb.onError(e.message); } };

    fill(els.dialog, el("div", { class: "dlg-body" },
      el("h3", {}, env ? "Edit environment" : "New environment"),
      el("label", {}, "Name", name),
      el("p", { class: "empty-hint" }, "Use these as {{name}} in URLs, headers and bodies. Values saved by an Extract rule appear here too."),
      table,
      el("div", { class: "dlg-actions" },
        env ? el("button", { class: "danger", onclick: remove }, "Delete") : null,
        el("span", { class: "spacer" }),
        el("button", { onclick: () => els.dialog.close() }, "Cancel"),
        el("button", { class: "primary", onclick: save }, "Save"))));
    els.dialog.showModal(); name.focus();
  }

  return {
    /** Redraw the picker from the server state. */
    update(state) {
      envs = state.environments || [];
      fill(els.select, el("option", { value: "" }, envs.length ? "No environment" : "No environments"),
        envs.map((e) => el("option", { value: e.id, selected: e.id === state.activeEnvironmentId }, e.name)));
      els.select.value = state.activeEnvironmentId || "";
    },
    /** For the "New environment" button. */
    openNew: () => open(null),
  };
}
