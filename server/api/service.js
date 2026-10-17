/**
 * service.js — the API client's actions, combining the store and the runner.
 *
 * Used by both the HTTP routes (the popup window) and the MCP tools (the agent), so they
 * behave the same. `guard` (optional) refuses URLs — pass makeAgentGuard() for the agent.
 */

import * as store from "./store.js";
import { changesData } from "./safety.js";
import { runRequest } from "./runner.js";
import { buildRequest } from "./build-request.js";
import { toCurl } from "./curl.js";
import { runSecurity } from "./security.js";
import { runLoad, runRace } from "./load.js";

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

// ---- throw-away tests (nothing is saved, no history) ------------------------------------------

/** Security probes for one request. `otherToken` (a second user's token) enables the IDOR check. */
export function securityCheck(request, { collectionId, otherToken, guard, fetchImpl } = {}) {
  return runSecurity(request, { variables: store.variablesFor(collectionId), otherToken, urlGuard: guard, fetchImpl });
}

/** Security probes for every request in a collection (first 25), one result each. */
export async function securityCheckCollection(collectionRef, { otherToken, guard, fetchImpl, readOnlyOnly = false } = {}) {
  const col = store.getState().collections.find((c) => c.id === collectionRef || c.name === collectionRef);
  if (!col) throw new Error(`No collection "${collectionRef}".`);
  const results = [], skipped = [];
  for (const request of col.requests.slice(0, 25)) {
    if (readOnlyOnly && changesData(request)) { skipped.push(`${request.method} ${request.name}`); continue; }   // the agent has no go-ahead from the user
    results.push(await securityCheck(request, { collectionId: col.id, otherToken, guard, fetchImpl }));
  }
  return { collection: col.name, results, skipped };
}

/** Load test ("load") or simultaneous-requests test ("race") for one request. */
export function stressTest(request, { mode = "load", collectionId, total, concurrency, n, guard, fetchImpl } = {}) {
  const variables = store.variablesFor(collectionId);
  return mode === "race" ? runRace(request, { variables, n, urlGuard: guard, fetchImpl }) : runLoad(request, { variables, total, concurrency, urlGuard: guard, fetchImpl });
}
