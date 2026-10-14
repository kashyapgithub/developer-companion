/**
 * service.js — the API client's actions, combining the store and the runner.
 *
 * Used by both the HTTP routes (the popup window) and the MCP tools (the agent), so they
 * behave the same. `guard` (optional) refuses URLs — pass makeAgentGuard() for the agent.
 */

import * as store from "./store.js";
import { runRequest } from "./runner.js";
import { buildRequest } from "./build-request.js";
import { toCurl } from "./curl.js";

/** Small record for the history list. */
const summarize = (r) => ({ name: r.name, method: r.method, url: r.url, status: r.status, ok: r.ok, durationMs: r.durationMs, testsPassed: r.testsPassed, error: r.error });

/** Runs one request with the saved variables; stores extracted values and a history line. */
export async function runOne(request, { collectionId, variables, guard, fetchImpl, record = true } = {}) {
  const vars = variables || store.variablesFor(collectionId);
  const result = await runRequest(request, { variables: vars, urlGuard: guard, fetchImpl });
  if (result.ok && Object.keys(result.extracted || {}).length) store.mergeIntoActiveEnvironment(result.extracted);
  if (record) store.addHistory(summarize(result));
  return result;
}

/** Runs a saved request by id or "Collection/Request". */
export async function runSaved(ref, opts = {}) {
  const found = store.findRequest(ref);
  if (!found) throw new Error(`No saved request "${ref}". Use api_list to see what exists.`);
  return runOne(found.request, { ...opts, collectionId: found.collection.id });
}

/**
 * Runs every request of a collection in order. Values extracted by one request (a login token,
 * an id) are available to the next. Returns a summary plus each result.
 */
export async function runCollection(collectionRef, { folder, stopOnFailure = false, guard, fetchImpl } = {}) {
  const state = store.getState();
  const col = state.collections.find((c) => c.id === collectionRef || c.name === collectionRef);
  if (!col) throw new Error(`No collection "${collectionRef}".`);
  const requests = col.requests.filter((r) => !folder || r.folder === folder || r.folder.startsWith(`${folder} / `));
  let vars = store.variablesFor(col.id, state);
  const results = [];
  for (const request of requests) {
    const result = await runOne(request, { collectionId: col.id, variables: vars, guard, fetchImpl });
    results.push(result);
    vars = { ...vars, ...(result.extracted || {}) };
    if (stopOnFailure && !(result.ok && result.testsPassed)) break;
  }
  const passed = results.filter((r) => r.ok && r.testsPassed).length;
  return { collection: col.name, total: requests.length, ran: results.length, passed, failed: results.length - passed, results };
}

/** The exact curl command for a saved/edited request with the current variables. */
export function curlFor(request, collectionId) {
  const built = buildRequest(request, store.variablesFor(collectionId));
  return { curl: toCurl(built), missing: built.missing };
}
