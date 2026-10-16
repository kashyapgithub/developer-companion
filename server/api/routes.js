/**
 * routes.js — the HTTP side of the API client (used by the popup window).
 *
 *   GET    /apiclient/state                          collections, environments, active env, history
 *   POST   /apiclient/collections                    { name }
 *   PATCH  /apiclient/collections/:id                { name }
 *   DELETE /apiclient/collections/:id
 *   POST   /apiclient/collections/:id/requests       a request (new, or same id = update)
 *   DELETE /apiclient/collections/:id/requests/:rid
 *   POST   /apiclient/environments                   { id?, name, variables }
 *   DELETE /apiclient/environments/:id
 *   POST   /apiclient/environments/active            { id }
 *   POST   /apiclient/run                            { request, collectionId? }  send any request (you typed it)
 *   POST   /apiclient/run-collection                 { collection, folder?, stopOnFailure? }
 *   POST   /apiclient/import                         { text }  Postman collection/environment JSON or a curl command
 *   POST   /apiclient/curl                           { request, collectionId? }  -> { curl }
 *   POST   /apiclient/security                      { request, collectionId?, otherToken? }  or  { collection }  -> probe results
 *   POST   /apiclient/stress                         { request, mode: "load"|"race", total?, concurrency?, n?, collectionId? }
 *   POST   /apiclient/history/clear
 *
 * Called from server.js after the origin / access-code checks. Returns true when handled.
 */

import * as store from "./store.js";
import * as svc from "./service.js";
import { parseCurl } from "./curl.js";
import { importPostmanCollection, importPostmanEnvironment, detectPostmanKind } from "./postman.js";

/** Runs `fn` (sync or async): 200 with its result, or 400 with the error message. */
async function reply(res, respondJson, fn) {
  try { respondJson(res, 200, { ok: true, ...(await fn()) }); }
  catch (err) { respondJson(res, 400, { ok: false, error: err.message || String(err) }); }
}

/** What an import did, in one result shape. */
export function importText(text, collectionId) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Nothing to import.");
  if (/^curl\b/i.test(trimmed)) {
    const request = parseCurl(trimmed);
    const target = collectionId ? store.getState().collections.find((c) => c.id === collectionId) : null;
    const col = target || store.getState().collections.find((c) => c.name === "Imported") || store.createCollection("Imported");
    return { kind: "curl", collectionId: col.id, request: store.saveRequest(col.id, request) };
  }
  let json;
  try { json = JSON.parse(trimmed); } catch { throw new Error("Paste a curl command, or a Postman collection / environment (JSON)."); }
  const kind = detectPostmanKind(json);
  if (kind === "collection") { const { collection, notes } = importPostmanCollection(json); return { kind, collection: store.addCollection(collection), notes }; }
  if (kind === "environment") return { kind, environment: store.saveEnvironment(importPostmanEnvironment(json)) };
  throw new Error("Not a Postman collection or environment export.");
}

export function handleApiClient(req, res, pathname, { readJsonBody, respondJson }) {
  if (!pathname.startsWith("/apiclient/")) return false;
  const [, , kind, id, sub, rid] = pathname.split("/");       // ["", "apiclient", kind, id, sub, rid]
  const body = (fn) => readJsonBody(req, res, (payload) => reply(res, respondJson, () => fn(payload || {})));
  const now = (fn) => reply(res, respondJson, fn);
  const m = req.method;

  if (m === "GET" && kind === "state") { now(() => ({ ...store.getState(), history: store.getHistory() })); return true; }

  if (kind === "collections") {
    if (m === "POST" && !id) { body((p) => ({ collection: store.createCollection(p.name) })); return true; }
    if (m === "PATCH" && id && !sub) { body((p) => ({ collection: store.renameCollection(id, p.name) })); return true; }
    if (m === "DELETE" && id && !sub) { now(() => ({ deleted: store.deleteCollection(id) })); return true; }
    if (m === "POST" && id && sub === "requests") { body((p) => ({ request: store.saveRequest(id, p) })); return true; }
    if (m === "DELETE" && id && sub === "requests" && rid) { now(() => ({ deleted: store.deleteRequest(id, rid) })); return true; }
  }

  if (kind === "environments") {
    if (m === "POST" && id === "active") { body((p) => ({ activeEnvironmentId: store.setActiveEnvironment(p.id) })); return true; }
    if (m === "POST" && !id) { body((p) => ({ environment: store.saveEnvironment(p) })); return true; }
    if (m === "DELETE" && id) { now(() => ({ deleted: store.deleteEnvironment(id) })); return true; }
  }

  if (m === "POST" && kind === "run") { body(async (p) => ({ result: await svc.runOne(store.cleanRequest(p.request || {}), { collectionId: p.collectionId }) })); return true; }
  if (m === "POST" && kind === "run-collection") { body(async (p) => ({ run: await svc.runCollection(p.collection, { folder: p.folder, stopOnFailure: !!p.stopOnFailure }) })); return true; }
  if (m === "POST" && kind === "import") { body((p) => importText(p.text, p.collectionId)); return true; }
  if (m === "POST" && kind === "curl") { body((p) => svc.curlFor(store.cleanRequest(p.request || {}), p.collectionId)); return true; }
  if (m === "POST" && kind === "security") { body(async (p) => (p.collection ? { report: await svc.securityCheckCollection(p.collection, { otherToken: p.otherToken }) } : { report: await svc.securityCheck(store.cleanRequest(p.request || {}), { collectionId: p.collectionId, otherToken: p.otherToken }) })); return true; }
  if (m === "POST" && kind === "stress") { body(async (p) => ({ report: await svc.stressTest(store.cleanRequest(p.request || {}), p)  })); return true; }
  if (m === "POST" && kind === "history" && id === "clear") { now(() => { store.clearHistory(); return {}; }); return true; }
  return false;
}
