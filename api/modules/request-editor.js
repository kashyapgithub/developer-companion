/**
 * request-editor.js — the form for ONE request: method, URL, params, headers, auth, body,
 * plus its tests and extract rules. `set(request)` fills it in, `get()` reads it back out
 * in the exact shape the server stores (see server/api/build-request.js).
 */

import { createKvTable } from "./kv-table.js";
import { createTestsEditor, createExtractEditor } from "./rules-editor.js";
import { el, fill } from "./dom.js";

const AUTH_FIELDS = {
  none: [],
  bearer: [["token", "Token", "{{token}}"]],
  basic: [["username", "Username", ""], ["password", "Password", ""]],
  apikey: [["key", "Key name", "X-API-Key"], ["value", "Value", "{{apiKey}}"]],
};
const BODY_MODES = ["none", "json", "text", "form"];

/**
 * @param {Record<string, HTMLElement>} els elements from api.html
 * @param {{ onChange: () => void }} opts
 */
export function createRequestEditor(els, { onChange }) {
  const params = createKvTable(els.params, { onChange, keyPlaceholder: "param", valuePlaceholder: "value" });
  const headers = createKvTable(els.headers, { onChange, keyPlaceholder: "Header", valuePlaceholder: "value" });
  const form = createKvTable(els.form, { onChange, keyPlaceholder: "field", valuePlaceholder: "value" });
  const tests = createTestsEditor(els.tests, { onChange });
  const extract = createExtractEditor(els.extract, { onChange });
  let current = { id: "", folder: "" };               // fields the form doesn't edit but must keep
  let auth = { type: "none" };

  /** Auth type select + the inputs that type needs. */
  function renderAuth() {
    fill(els.authFields, AUTH_FIELDS[auth.type]?.map(([field, label, hint]) =>
      el("label", {}, label, el("input", { value: auth[field] ?? "", placeholder: hint, spellcheck: "false", oninput: (e) => { auth[field] = e.target.value; onChange(); } }))));
    if (auth.type === "apikey") {
      fill(els.authFields, ...els.authFields.childNodes, el("label", {}, "Send in",
        el("select", { onchange: (e) => { auth.in = e.target.value; onChange(); } }, ["header", "query"].map((v) => el("option", { value: v, selected: (auth.in || "header") === v }, v)))));
    }
    els.authType.value = auth.type;
  }

  /** Shows the text area or the form table depending on the body mode. */
  function renderBodyMode() {
    const mode = els.bodyMode.value;
    els.bodyText.hidden = !["json", "text"].includes(mode);
    els.form.hidden = mode !== "form";
    els.bodyHint.hidden = mode !== "none";
  }

  els.authType.addEventListener("change", () => { auth = { type: els.authType.value }; renderAuth(); onChange(); });
  els.bodyMode.addEventListener("change", () => { renderBodyMode(); onChange(); });
  for (const input of [els.method, els.url, els.name, els.bodyText]) input.addEventListener("input", onChange);
  els.beautify.addEventListener("click", () => {
    try { els.bodyText.value = JSON.stringify(JSON.parse(els.bodyText.value), null, 2); onChange(); } catch { /* not JSON: leave it */ }
  });

  return {
    set(r = {}) {
      current = { id: r.id || "", folder: r.folder || "" };
      els.method.value = r.method || "GET"; els.url.value = r.url || ""; els.name.value = r.name || "";
      params.set(r.params); headers.set(r.headers);
      auth = { type: "none", ...(r.auth || {}) }; renderAuth();
      const body = r.body || { mode: "none" };
      els.bodyMode.value = BODY_MODES.includes(body.mode) ? body.mode : "none";
      els.bodyText.value = body.content || ""; form.set(body.form);
      renderBodyMode();
      tests.set(r.tests); extract.set(r.extract);
    },
    get() {
      const mode = els.bodyMode.value;
      return {
        id: current.id, folder: current.folder, name: els.name.value.trim(), method: els.method.value, url: els.url.value.trim(),
        params: params.get(), headers: headers.get(), auth: { ...auth },
        body: mode === "form" ? { mode, form: form.get() } : mode === "none" ? { mode } : { mode, content: els.bodyText.value },
        tests: tests.get(), extract: extract.get().filter((r) => r.var || r.from),
      };
    },
  };
}
