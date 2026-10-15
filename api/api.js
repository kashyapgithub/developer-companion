/**
 * api.js — wires the API client window together.
 *
 * Owns the one piece of state that matters (which request is open and in which collection);
 * everything else lives in the modules and on the bridge. Reads top to bottom as:
 *   refresh → draw  ·  open / new / save request  ·  send  ·  sidebar + dialogs
 */

import { api } from "./modules/client.js";
import { initTabs } from "./modules/tabs.js";
import { toast } from "./modules/toast.js";
import { askText, askConfirm } from "./modules/ask-dialog.js";
import { createRequestEditor } from "./modules/request-editor.js";
import { createResponseView } from "./modules/response-view.js";
import { createSidebar } from "./modules/sidebar.js";
import { createEnvPanel } from "./modules/env-panel.js";
import { createImportDialog } from "./modules/import-dialog.js";
import { createCapturedDialog } from "./modules/captured.js";
import { showRunReport } from "./modules/run-report.js";
import { el, fill } from "./modules/dom.js";

const $ = (id) => document.getElementById(id);
const say = (m) => toast($("toast"), m);
const fail = (m) => toast($("toast"), m, { error: true });
/** Runs an async action and shows its error as a toast. */
const guarded = (fn) => async (...args) => { try { return await fn(...args); } catch (e) { fail(e.message || String(e)); } };

// ---- state ---------------------------------------------------------------------------------
let state = { collections: [], environments: [], activeEnvironmentId: "", history: [] };
let collectionId = "";          // collection the open request belongs to / will be saved into
let dirty = false;

const tabs = initTabs();
const markDirty = () => { dirty = true; $("dirty").textContent = "unsaved changes"; };
const markClean = () => { dirty = false; $("dirty").textContent = ""; };

// ---- modules ---------------------------------------------------------------------------------
const editor = createRequestEditor({
  method: $("method"), url: $("url"), name: $("req-name"), params: $("params"), headers: $("headers"), form: $("form"),
  authType: $("auth-type"), authFields: $("auth-fields"), bodyMode: $("body-mode"), bodyText: $("body-text"), bodyHint: $("body-hint"),
  beautify: $("beautify"), tests: $("tests"), extract: $("extract"),
}, { onChange: markDirty });

const response = createResponseView({ bar: $("resp-bar"), body: $("resp-body"), headers: $("resp-headers"), tests: $("resp-tests"), testsTab: $("tests-tab") });

const sidebar = createSidebar({ tree: $("tree"), history: $("history") }, {
  onOpen: (c, r) => openRequest(c.id, r),
  onNewRequest: (c) => openRequest(c.id, { name: "New request", method: "GET", url: "" }),
  onRenameCollection: guarded(async (c) => { const name = await askText($("dlg-ask"), "Rename collection", c.name); if (name) { await api.renameCollection(c.id, name); await refresh(); } }),
  onDeleteCollection: guarded(async (c) => { if (await askConfirm($("dlg-ask"), `Delete "${c.name}" and its ${c.requests.length} request(s)?`)) { await api.deleteCollection(c.id); if (collectionId === c.id) collectionId = ""; await refresh(); } }),
  onDeleteRequest: guarded(async (c, r) => { if (await askConfirm($("dlg-ask"), `Delete "${r.name}"?`)) { await api.deleteRequest(c.id, r.id); await refresh(); } }),
  onRunCollection: guarded(async (c) => { say(`Running ${c.name}…`); const { run } = await api.runCollection(c.id); await refresh(); showRunReport($("dlg-run"), run); }),
});

const envPanel = createEnvPanel({ select: $("env-select"), editBtn: $("env-edit"), dialog: $("dlg-env") }, { onChanged: refresh, onError: fail });
const importer = createImportDialog($("dlg-import"), {
  getCollectionId: () => collectionId,
  onImported: async (_result, summary) => { await refresh(); say(summary); }, onError: fail,
});
const captured = createCapturedDialog($("dlg-captured"), {
  getCollectionId: () => collectionId, ensureCollection, onImported: async (summary) => { await refresh(); say(summary); }, onError: fail,
});

// ---- refresh / draw ----------------------------------------------------------------------------
/** Loads the state from the bridge and redraws the lists. */
async function refresh() {
  state = await api.state();
  sidebar.update(state); envPanel.update(state); drawCollectionPicker();
}

/** The "save into" dropdown. */
function drawCollectionPicker() {
  fill($("save-col"), state.collections.length ? state.collections.map((c) => el("option", { value: c.id, selected: c.id === collectionId }, c.name)) : el("option", { value: "" }, "(new collection)"));
  if (!collectionId && state.collections[0]) collectionId = state.collections[0].id;
  $("save-col").value = collectionId;
}
$("save-col").addEventListener("change", () => { collectionId = $("save-col").value; });

/** A collection to save into: the selected one, or a fresh "My requests". */
async function ensureCollection() {
  if (collectionId && state.collections.some((c) => c.id === collectionId)) return collectionId;
  const { collection } = await api.createCollection("My requests");
  collectionId = collection.id; await refresh(); return collectionId;
}

// ---- requests ------------------------------------------------------------------------------------
function openRequest(colId, request) {
  collectionId = colId; editor.set(request); response.reset(); markClean();
  $("save-col").value = colId; sidebar.setActive(request.id);
}

const save = guarded(async () => {
  const draft = editor.get();
  if (!draft.url) return fail("Enter a URL first.");
  const colId = await ensureCollection();
  const { request } = await api.saveRequest(colId, { ...draft, name: draft.name || `${draft.method} ${draft.url}` });
  editor.set(request); markClean(); await refresh(); sidebar.setActive(request.id); say("Saved");
});

const send = guarded(async () => {
  const draft = editor.get();
  if (!draft.url) return fail("Enter a URL first.");
  $("send").disabled = true; $("send").textContent = "Sending…";
  try {
    const { result } = await api.run(draft, collectionId);
    response.show(result);
    await refresh();                                   // history + any values the Extract rules saved
  } finally { $("send").disabled = false; $("send").textContent = "Send"; }
});

const copyCurl = guarded(async () => {
  const { curl, missing } = await api.curl(editor.get(), collectionId);
  await navigator.clipboard.writeText(curl);
  say(missing.length ? `Copied. Unset variables: ${missing.map((m) => `{{${m}}}`).join(", ")}` : "curl copied");
});

// ---- buttons & shortcuts ---------------------------------------------------------------------------
$("send").addEventListener("click", send);
$("save").addEventListener("click", save);
$("copy-curl").addEventListener("click", copyCurl);
$("new-col").addEventListener("click", guarded(async () => {
  const name = await askText($("dlg-ask"), "New collection", ""); if (!name) return;
  const { collection } = await api.createCollection(name); collectionId = collection.id; await refresh();
}));
$("import-btn").addEventListener("click", () => importer.open());
$("captured-btn").addEventListener("click", () => captured.open());
$("env-new").addEventListener("click", () => envPanel.openNew());
$("clear-history").addEventListener("click", guarded(async () => { await api.clearHistory(); await refresh(); }));
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
});
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

// ---- start -------------------------------------------------------------------------------------------
editor.set({ method: "GET", url: "", name: "" });
response.reset();
refresh().catch((e) => fail(e.message));

/** Handle for tests and debugging. */
window.__dcApi = { editor, refresh: guarded(refresh), send, save, get state() { return state; }, tabs };
