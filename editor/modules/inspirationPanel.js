/**
 * inspirationPanel.js — the "Inspiration" tab: screenshots saved from around
 * the web, sorted into folders, ready to drop on the canvas or hand to the agent.
 *
 * Layout: search + "New folder" on top, a row of folder chips (All, Unsorted,
 * yours), a thumbnail grid, and a detail strip for the selected image
 * (title, note, folder, Add to canvas, Delete).
 *
 * Small pieces, each doing one thing: state -> render functions -> actions.
 */

import { blobToDataUrl } from "./inspirationApi.js";

const ALL = "__all__";
const UNSORTED = "";

export function createInspirationPanel({ rootEl, api, imageImport, say }) {
  const els = {
    search: rootEl.querySelector("#insp-search"),
    newFolder: rootEl.querySelector("#insp-new-folder"),
    nameRow: rootEl.querySelector("#insp-name-row"),
    nameInput: rootEl.querySelector("#insp-name-input"),
    nameOk: rootEl.querySelector("#insp-name-ok"),
    folders: rootEl.querySelector("#insp-folders"),
    folderActions: rootEl.querySelector("#insp-folder-actions"),
    grid: rootEl.querySelector("#insp-grid"),
    detail: rootEl.querySelector("#insp-detail"),
    status: rootEl.querySelector("#insp-status"),
  };

  const state = { library: { folders: [], unsorted: 0, items: [] }, folder: ALL, selected: null, nameMode: null, thumbs: new Map() };

  // ---- helpers ------------------------------------------------------------------

  const setStatus = (text, isError = false) => { els.status.textContent = text; els.status.className = "hint" + (isError ? " err" : ""); };
  const folderName = (id) => state.library.folders.find((f) => f.id === id)?.name || "Unsorted";
  const selectedItem = () => state.library.items.find((i) => i.id === state.selected) || null;

  /** Items for the active folder + search text. */
  function visibleItems() {
    const q = els.search.value.trim().toLowerCase();
    return state.library.items.filter((i) =>
      (state.folder === ALL || i.folder === state.folder) &&
      (!q || `${i.title} ${i.note} ${i.url}`.toLowerCase().includes(q)));
  }

  /** Runs an API action; shows its error in the status line instead of throwing. */
  async function attempt(fn, okMessage) {
    try { const r = await fn(); if (okMessage) setStatus(okMessage); return r; }
    catch (err) { setStatus(err.message, true); return null; }
  }

  // ---- data ---------------------------------------------------------------------

  async function refresh() {
    const data = await attempt(() => api.list());
    if (!data) { render(); return; }
    state.library = data;
    if (state.folder !== ALL && state.folder !== UNSORTED && !data.folders.some((f) => f.id === state.folder)) state.folder = ALL;
    if (!selectedItem()) state.selected = null;
    setStatus(data.items.length ? "" : "Nothing saved yet. Select an image and press “Save to inspiration”, or turn on auto-save in the Add screenshot menu.");
    render();
  }

  /** Thumbnail URL for an item, fetched once (needs the access-code header, so not a plain <img src>). */
  async function thumbFor(id) {
    if (!state.thumbs.has(id)) state.thumbs.set(id, api.imageBlob(id).then((b) => URL.createObjectURL(b)).catch(() => ""));
    return state.thumbs.get(id);
  }

  // ---- render -------------------------------------------------------------------

  function chip(id, label, count) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "insp-chip" + (state.folder === id ? " active" : "");
    b.dataset.folder = id; b.textContent = count != null ? `${label} · ${count}` : label;
    b.addEventListener("click", () => { state.folder = id; state.nameMode = null; render(); });
    // Drop an image on a chip to file it there (not on "All").
    if (id !== ALL) {
      b.addEventListener("dragover", (e) => { e.preventDefault(); b.classList.add("drop"); });
      b.addEventListener("dragleave", () => b.classList.remove("drop"));
      b.addEventListener("drop", async (e) => {
        e.preventDefault(); b.classList.remove("drop");
        const itemId = e.dataTransfer.getData("text/plain");
        if (itemId) { await attempt(() => api.updateItem(itemId, { folder: id }), `Moved to ${folderName(id)}`); refresh(); }
      });
    }
    return b;
  }

  function renderFolders() {
    const { folders, unsorted, items } = state.library;
    els.folders.replaceChildren(
      chip(ALL, "All", items.length), chip(UNSORTED, "Unsorted", unsorted),
      ...folders.map((f) => chip(f.id, f.name, f.count)),
    );
    const custom = state.folder !== ALL && state.folder !== UNSORTED;
    els.folderActions.hidden = !custom;
    els.nameRow.hidden = !state.nameMode;
  }

  async function renderGrid() {
    const items = visibleItems();
    els.grid.replaceChildren(...items.map((item) => {
      const card = document.createElement("button");
      card.type = "button"; card.className = "insp-card" + (item.id === state.selected ? " selected" : "");
      card.dataset.id = item.id; card.draggable = true; card.title = item.title;
      const img = document.createElement("img"); img.alt = item.title; img.loading = "lazy";
      thumbFor(item.id).then((url) => { if (url) img.src = url; });
      const cap = document.createElement("span"); cap.textContent = item.title;
      card.append(img, cap);
      card.addEventListener("click", () => { state.selected = item.id; render(); });
      card.addEventListener("dblclick", () => addToCanvas(item));
      card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", item.id));
      return card;
    }));
    els.grid.hidden = items.length === 0;
  }

  function renderDetail() {
    const item = selectedItem();
    els.detail.hidden = !item;
    if (!item) return;
    els.detail.querySelector("#insp-title").value = item.title;
    els.detail.querySelector("#insp-note").value = item.note || "";
    const src = els.detail.querySelector("#insp-source");
    src.textContent = item.url ? new URL(item.url, "http://x").host || item.url : "";
    src.title = item.url || ""; src.hidden = !item.url;
    const sel = els.detail.querySelector("#insp-folder-select");
    sel.replaceChildren(new Option("Unsorted", UNSORTED), ...state.library.folders.map((f) => new Option(f.name, f.id)));
    sel.value = item.folder;
  }

  /** Redraws everything. A selected image that the folder/search hides is deselected, so the detail strip never shows a stranger. */
  function render() {
    if (state.selected && !visibleItems().some((i) => i.id === state.selected)) state.selected = null;
    renderFolders(); renderGrid(); renderDetail();
  }

  // ---- actions ------------------------------------------------------------------

  /** Puts a saved image on the canvas (with its source info travelling to the agent in the sketch). */
  async function addToCanvas(item) {
    const blob = await attempt(() => api.imageBlob(item.id));
    if (!blob) return;
    const ok = await imageImport.addDataUrl(await blobToDataUrl(blob), { name: item.title, meta: { kind: "inspiration", title: item.title, url: item.url, note: item.note } });
    setStatus(ok ? "Added to the canvas" : "Couldn't add it to the canvas.", !ok);
  }

  /** Saves one image into the library. Used by the Design-panel button and by auto-save. */
  async function save({ dataUrl, title, url, folder }) {
    const target = folder ?? (state.folder !== ALL ? state.folder : UNSORTED);
    const r = await attempt(() => api.addItem({ dataUrl, title, url, folder: target }));
    if (r) { say?.(`Saved to Inspiration${target ? " · " + folderName(target) : ""}`); await refresh(); }
    return !!r;
  }

  /** Create-or-rename: the same inline name field serves both. */
  async function commitName() {
    const name = els.nameInput.value.trim();
    if (!name) return;
    const mode = state.nameMode;
    state.nameMode = null; els.nameInput.value = "";
    if (mode === "create") {
      const r = await attempt(() => api.createFolder(name));
      if (r) state.folder = r.folder.id;
    } else if (mode === "rename") {
      await attempt(() => api.renameFolder(state.folder, name));
    }
    await refresh();
  }

  function startName(mode) {
    state.nameMode = mode;
    els.nameInput.value = mode === "rename" ? folderName(state.folder) : "";
    render(); els.nameInput.focus(); els.nameInput.select();
  }

  // ---- wiring -------------------------------------------------------------------

  els.search.addEventListener("input", render);
  els.newFolder.addEventListener("click", () => startName("create"));
  els.nameOk.addEventListener("click", commitName);
  els.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitName();
    if (e.key === "Escape") { state.nameMode = null; render(); }
    e.stopPropagation(); // typing a folder name must not trigger canvas shortcuts
  });
  rootEl.querySelector("#insp-rename").addEventListener("click", () => startName("rename"));
  rootEl.querySelector("#insp-delete-folder").addEventListener("click", async () => {
    if (await attempt(() => api.deleteFolder(state.folder), "Folder deleted — its images moved to Unsorted")) { state.folder = ALL; await refresh(); }
  });

  const saveField = (selector, key) => els.detail.querySelector(selector).addEventListener("change", async (e) => {
    const item = selectedItem(); if (!item) return;
    await attempt(() => api.updateItem(item.id, { [key]: e.target.value }));
    if (key === "folder" && state.folder !== ALL) state.folder = e.target.value; // follow the image to its new folder
    await refresh();
  });
  saveField("#insp-title", "title"); saveField("#insp-note", "note"); saveField("#insp-folder-select", "folder");
  for (const field of els.detail.querySelectorAll("input, textarea")) field.addEventListener("keydown", (e) => e.stopPropagation());
  els.detail.querySelector("#insp-use").addEventListener("click", () => { const i = selectedItem(); if (i) addToCanvas(i); });
  els.detail.querySelector("#insp-delete").addEventListener("click", async () => {
    const item = selectedItem(); if (!item) return;
    if (await attempt(() => api.deleteItem(item.id), "Deleted")) { state.selected = null; await refresh(); }
  });

  return { refresh, save };
}
