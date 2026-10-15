/**
 * client.js — the API window's connection to the bridge (the local server).
 *
 * Uses the same saved connection as the rest of the extension (this computer, or a VM with
 * an access code). Every call returns the parsed JSON or throws an Error whose message is
 * fit to show the user. Note: requests are SENT by the bridge, so they come from the
 * machine the bridge runs on (important when the bridge is in a VM).
 */

import { logSender } from "../../lib/log-sender.js";

/** One call to /apiclient/<path>. */
async function call(method, path, body) {
  const base = await logSender.getEffectiveServerUrl();
  const headers = await logSender.getRequestHeaders();
  let res;
  try { res = await fetch(`${base}/apiclient${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error("Can't reach the agent server. Is it running? (npm start inside server/)"); }
  if (res.status === 401) throw new Error("Wrong or missing access code.");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

export const api = {
  state: () => call("GET", "/state"),
  createCollection: (name) => call("POST", "/collections", { name }),
  renameCollection: (id, name) => call("PATCH", `/collections/${id}`, { name }),
  deleteCollection: (id) => call("DELETE", `/collections/${id}`),
  saveRequest: (collectionId, request) => call("POST", `/collections/${collectionId}/requests`, request),
  deleteRequest: (collectionId, id) => call("DELETE", `/collections/${collectionId}/requests/${id}`),
  saveEnvironment: (env) => call("POST", "/environments", env),
  deleteEnvironment: (id) => call("DELETE", `/environments/${id}`),
  setActiveEnvironment: (id) => call("POST", "/environments/active", { id }),
  run: (request, collectionId) => call("POST", "/run", { request, collectionId }),
  runCollection: (collection, opts = {}) => call("POST", "/run-collection", { collection, ...opts }),
  importText: (text, collectionId) => call("POST", "/import", { text, collectionId }),
  curl: (request, collectionId) => call("POST", "/curl", { request, collectionId }),
  clearHistory: () => call("POST", "/history/clear"),
};
