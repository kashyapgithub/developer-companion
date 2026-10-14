/**
 * trace.js — follows one request from the browser through to the backend.
 *
 * Given the browser's view of a request (from the network inspector) it finds
 *   - server log lines for the same request id (exact match), and
 *   - server and browser log lines in the time window around it (best guess),
 * and returns them in time order so an agent can read the story top to bottom.
 */

import { queryLogsBetween, queryLogsByRequestId } from "./storage.js";

const LEAD_MS = 1000;   // look a little before the request started (clock skew, queued work)

/** The bits of a log row an agent needs (the rest is noise). */
const brief = (r) => ({
  time: r.created_at, source: r.environment, level: r.level, app: r.app_name,
  message: r.message, ...(r.stack_trace ? { stack: r.stack_trace } : {}), ...(r.request_id ? { request_id: r.request_id } : {}),
});

/** Picks the request to trace: exact request id, else the newest failed one, else the newest match. */
export function pickRequest(requests, { requestId } = {}) {
  if (!requests?.length) return null;
  if (requestId) { const hit = requests.find((r) => r.correlationId === requestId); if (hit) return hit; }
  return requests.find((r) => r.error || r.status >= 400) || requests[0];
}

/**
 * Builds the trace. `request` may be null (no browser): then only the request id
 * or `fallbackMinutes` of recent server logs are used.
 */
export function buildTrace({ request, requestId, windowSeconds = 5, fallbackMinutes = 5 }) {
  const id = requestId || request?.correlationId || null;
  const byId = id ? queryLogsByRequestId(id).filter((r) => r.environment === "server") : [];

  let from, to;
  if (request) {
    const start = Date.parse(request.startedAt);
    from = new Date(start - LEAD_MS).toISOString();
    to = new Date(start + (request.durationMs || 0) + windowSeconds * 1000).toISOString();
  } else {
    to = new Date().toISOString();
    from = new Date(Date.now() - fallbackMinutes * 60000).toISOString();
  }
  const near = queryLogsBetween(from, to, { limit: 200 });
  const nearServer = near.filter((r) => r.environment === "server");
  const nearBrowser = near.filter((r) => r.environment === "browser" && (r.level === "error" || r.level === "warn"));

  // Exact matches first, then the window, without repeating a row.
  const seen = new Set(byId.map((r) => r.id));
  const server = [...byId, ...nearServer.filter((r) => !seen.has(r.id))].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return {
    request: request ? {
      method: request.method, url: request.url, status: request.status, error: request.error, durationMs: request.durationMs,
      startedAt: request.startedAt, request_id: id, requestBody: request.requestBody, responseBody: request.responseBody,
    } : null,
    matched_by_request_id: byId.length,
    server_logs: server.map(brief),
    browser_logs: nearBrowser.map(brief),
    hint: server.length
      ? "Read server_logs in order; entries with matched_by_request_id are certain, the rest are from the same time window."
      : "No server logs found. Start the backend through `npm run tail -- <your dev command>` (in the server folder) so its output is captured.",
  };
}
