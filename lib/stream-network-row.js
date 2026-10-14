/**
 * stream-network-row.js — turns one finished network request into a stream line. Pure.
 *
 *   "POST /api/orders → 201 (84ms, 1.2KB)"   level info
 *   "GET /api/me → 401 (12ms)"               level warn
 *   "POST /api/pay → 500 (301ms)"            level error
 *
 * The context carries the details the agent may want (full URL, ids, and the
 * request/response bodies, already masked by redact.js and cut to a few hundred chars).
 */

const BODY_CHARS = 1200;

const clip = (text) => (typeof text === "string" && text.length > BODY_CHARS ? `${text.slice(0, BODY_CHARS)}…[+${text.length - BODY_CHARS}]` : text);

/** "http://x:3000/api/a?b=1" -> "/api/a?b=1" (falls back to the input). */
export function shortUrl(url) {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

/** "1.2KB", "340B". */
export function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return bytes < 1024 ? `${Math.round(bytes)}B` : `${(bytes / 1024).toFixed(1)}KB`;
}

/** @returns {{level:string, message:string, context:object, tags:string[]} | null} null when the entry isn't finished. */
export function buildNetworkRow(entry) {
  if (!entry || entry.status === null || entry.status === undefined) return null;
  const meta = [entry.durationMs != null ? `${entry.durationMs}ms` : "", humanSize(entry.size)].filter(Boolean).join(", ");
  const level = entry.status >= 500 ? "error" : entry.status >= 400 ? "warn" : "info";
  return {
    level,
    message: `${entry.method} ${shortUrl(entry.url)} → ${entry.status}${meta ? ` (${meta})` : ""}`,
    context: {
      method: entry.method, url: entry.url, status: entry.status, durationMs: entry.durationMs, size: entry.size,
      resourceType: entry.type, mimeType: entry.mimeType, requestId: entry.correlationId || undefined,
      requestBody: clip(entry.requestBody) || undefined, responseBody: clip(entry.responseBody) || undefined,
    },
    tags: ["network", "finished", String(entry.status), entry.method],
  };
}
