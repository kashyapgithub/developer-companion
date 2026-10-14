/**
 * network-store.js — remembers the last requests each captured tab made, with
 * headers and bodies, so the agent can ask "what exactly did POST /api/orders
 * send and get back?" (tool: get_network_requests).
 *
 * Fed by the same Chrome DevTools Protocol events the log capture already
 * receives. Memory only: nothing here is written to disk or the database.
 * Secrets are masked before they are stored (see redact.js).
 */

import { redactHeaders, redactBodyText } from "../redact.js";

const MAX_PER_TAB = 150;          // newest requests kept per tab
const MAX_BODY_CHARS = 20000;     // bodies are cut here when stored
const BODY_TYPES = new Set(["Fetch", "XHR"]);              // only API-style calls get bodies
const TEXT_MIME = /json|text\/|xml|x-www-form-urlencoded|graphql/i;
const REQUEST_ID_HEADERS = ["x-request-id", "request-id", "x-correlation-id", "x-amzn-trace-id", "traceparent"];

/** tabId -> Map(cdpRequestId -> entry). Maps keep insertion order, so the oldest is first. */
const byTab = new Map();

const cut = (text) => (typeof text === "string" && text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) + "…[truncated]" : text);
const tabMap = (tabId) => { if (!byTab.has(tabId)) byTab.set(tabId, new Map()); return byTab.get(tabId); };

/** The header value for any of the usual correlation-id names, if the server sent one. */
function correlationId(headers) {
  const lower = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of REQUEST_ID_HEADERS) if (lower[name]) return String(lower[name]);
  return null;
}

/** Forget everything for a tab (it closed, or the debugger detached). */
export function clearTab(tabId) { byTab.delete(tabId); }

/**
 * Feed one CDP Network.* event. `send` is chrome.debugger.sendCommand bound to the tab
 * (used to read a response body once the response has finished loading).
 */
export async function onNetworkEvent(tabId, method, params, send) {
  const entries = tabMap(tabId);
  switch (method) {
    case "Network.requestWillBeSent": {
      const { request } = params;
      if (!/^https?:/.test(request.url)) return;
      entries.set(params.requestId, {
        id: params.requestId, tabId, method: request.method, url: request.url, type: params.type || "Other",
        startedAt: new Date().toISOString(), t0: params.timestamp,
        requestHeaders: redactHeaders(request.headers),
        requestBody: request.postData ? cut(redactBodyText(request.postData)) : null,
        status: null, mimeType: null, responseHeaders: null, responseBody: null, error: null, durationMs: null,
      });
      while (entries.size > MAX_PER_TAB) entries.delete(entries.keys().next().value); // drop the oldest
      return;
    }
    case "Network.responseReceived": {
      const e = entries.get(params.requestId);
      if (!e) return;
      e.status = params.response.status;
      e.statusText = params.response.statusText || "";
      e.mimeType = params.response.mimeType;
      e.responseHeaders = redactHeaders(params.response.headers);
      e.correlationId = correlationId(params.response.headers);
      return;
    }
    case "Network.loadingFinished": {
      const e = entries.get(params.requestId);
      if (!e) return;
      e.durationMs = Math.round((params.timestamp - e.t0) * 1000);
      e.size = params.encodedDataLength;
      if (BODY_TYPES.has(e.type) && TEXT_MIME.test(e.mimeType || "")) {
        try {
          const body = await send("Network.getResponseBody", { requestId: params.requestId });
          e.responseBody = cut(redactBodyText(body.base64Encoded ? "[binary]" : body.body));
        } catch { /* body already gone (e.g. page navigated) — headers are still useful */ }
      }
      return;
    }
    case "Network.loadingFailed": {
      const e = entries.get(params.requestId);
      if (!e) return;
      e.error = params.errorText + (params.canceled ? " (canceled)" : "");
      e.durationMs = Math.round((params.timestamp - e.t0) * 1000);
    }
  }
}

/** Does this request match the status filter ("failed", "4xx", "5xx", or an exact code)? */
function statusMatches(e, want) {
  if (want === undefined || want === null || want === "") return true;
  const w = String(want).toLowerCase();
  if (w === "failed") return !!e.error || e.status >= 400;
  if (/^\dxx$/.test(w)) return e.status !== null && String(e.status)[0] === w[0];
  return String(e.status) === w;
}

/**
 * Newest-first list of recorded requests across tabs (or one tab).
 * Bodies are left out unless `includeBodies`, and cut to `maxBodyChars` each.
 */
export function queryRequests({ tabId, urlContains, status, method, limit = 15, includeBodies = true, maxBodyChars = 4000 } = {}) {
  const all = [];
  for (const [id, entries] of byTab) if (tabId === undefined || tabId === id) all.push(...entries.values());
  all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const text = (s) => (typeof s === "string" && s.length > maxBodyChars ? s.slice(0, maxBodyChars) + "…[truncated]" : s);
  return all
    .filter((e) => (!urlContains || e.url.includes(urlContains)) && (!method || e.method === method.toUpperCase()) && statusMatches(e, status))
    .slice(0, Math.max(1, Math.min(Number(limit) || 15, 50)))
    .map(({ t0, ...e }) => (includeBodies ? { ...e, requestBody: text(e.requestBody), responseBody: text(e.responseBody) }
      : { ...e, requestBody: e.requestBody ? "[omitted]" : null, responseBody: e.responseBody ? "[omitted]" : null }));
}
