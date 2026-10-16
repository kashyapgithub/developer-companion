/**
 * sidebar.js — the collections tree (collection → folder → request) and the run history.
 *
 * Pure view: it draws what it is given and reports clicks through callbacks; the owner
 * (api.js) does the actual saving.
 */

import { el, fill } from "./dom.js";

const METHOD_CLASS = (m) => `m m-${String(m).toLowerCase()}`;

/** Groups a collection's requests by their folder label ("" = top level). */
export function groupByFolder(requests) {
  const groups = new Map();
  for (const r of requests) { const k = r.folder || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

/**
 * @param {{ tree: HTMLElement, history: HTMLElement }} els
 * @param {{ onOpen(collection, request): void, onNewRequest(collection): void, onRenameCollection(c): void,
 *           onDeleteCollection(c): void, onDeleteRequest(c, r): void, onRunCollection(c): void }} cb
 */
export function createSidebar(els, cb) {
  let activeId = "";
  const collapsed = new Set();

  function requestRow(c, r) {
    return el("div", { class: `req-row${r.id === activeId ? " active" : ""}`, onclick: () => cb.onOpen(c, r) },
      el("span", { class: METHOD_CLASS(r.method) }, r.method), el("span", { class: "req-name" }, r.name),
      el("button", { class: "row-x", title: "Delete request", onclick: (e) => { e.stopPropagation(); cb.onDeleteRequest(c, r); } }, "✕"));
  }

  function collectionBlock(c) {
    const open = !collapsed.has(c.id);
    const body = groupByFolder(c.requests).map(([folder, reqs]) => el("div", { class: "folder" }, folder ? el("div", { class: "folder-name" }, folder) : null, reqs.map((r) => requestRow(c, r))));
    return el("div", { class: "collection" },
      el("div", { class: "col-head" },
        el("button", { class: "twirl", onclick: () => { open ? collapsed.add(c.id) : collapsed.delete(c.id); render(); } }, open ? "▾" : "▸"),
        el("span", { class: "col-name", title: c.name }, c.name),
        el("button", { title: "New request", onclick: () => cb.onNewRequest(c) }, "+"),
        el("button", { title: "Run every request in order", onclick: () => cb.onRunCollection(c) }, "▶"),
        el("button", { title: "Security check for every request", onclick: () => cb.onSecurityCollection(c) }, "🛡"),
        el("button", { title: "Rename", onclick: () => cb.onRenameCollection(c) }, "✎"),
        el("button", { title: "Delete collection", onclick: () => cb.onDeleteCollection(c) }, "✕")),
      open ? el("div", { class: "col-body" }, body.length ? body : el("p", { class: "empty-hint" }, "Empty. Press + to add a request.")) : null);
  }

  let state = { collections: [], history: [] };
  function render() {
    fill(els.tree, state.collections.length ? state.collections.map(collectionBlock) : el("p", { class: "empty-hint" }, "No collections yet. Create one, or import from curl / Postman."));
    fill(els.history, state.history.length ? state.history.map((h) => el("div", { class: "hist-row", title: h.url },
      el("span", { class: METHOD_CLASS(h.method) }, h.method), el("span", { class: `st ${h.ok && h.status < 400 ? "ok" : "bad"}` }, h.ok ? h.status : "ERR"),
      el("span", { class: "req-name" }, h.url), el("span", { class: "muted" }, `${h.durationMs ?? "?"} ms`))) : el("p", { class: "empty-hint" }, "Nothing sent yet."));
  }

  return {
    /** Redraw from the server state. */
    update(next) { state = { collections: next.collections || [], history: next.history || [] }; render(); },
    /** Highlights the open request. */
    setActive(id) { activeId = id || ""; render(); },
  };
}
