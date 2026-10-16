/**
 * load.js — two throw-away tests for one request:
 *
 *   load  Sends `total` requests, at most `concurrency` at a time. Reports throughput and
 *         p50 / p95 / p99 latency plus errors: finds slow endpoints, pool exhaustion, crashes under load.
 *   race  Sends `n` identical requests at the very same moment (double-click, retry, two tabs).
 *         Reports how many succeeded and whether they created different records: finds duplicate
 *         orders, double charges, cache stampedes. Sequential tests can't see these.
 *
 * Limits keep a slip from becoming an accident: at most 500 requests, 50 at a time, 20 in a race.
 */

import { runRequest } from "./runner.js";

export const LIMITS = { total: 500, concurrency: 50, race: 20 };
const clamp = (n, lo, hi, dflt) => Math.max(lo, Math.min(hi, Math.round(Number(n)) || dflt));

/** The p-th percentile (0-100) of a list of numbers; null for an empty list. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** Count of each status ("200": 48, "ERR": 2). */
function histogram(results) {
  const h = {};
  for (const r of results) { const k = r.ok ? String(r.status) : "ERR"; h[k] = (h[k] || 0) + 1; }
  return h;
}

/** The first few distinct error messages, so a flood of the same failure reads as one line. */
function errorSamples(results) {
  const seen = new Map();
  for (const r of results) { const msg = r.ok ? (r.status >= 500 ? `HTTP ${r.status}` : null) : r.error; if (msg) seen.set(msg, (seen.get(msg) || 0) + 1); }
  return [...seen].slice(0, 5).map(([message, count]) => ({ message, count }));
}

const plain = (request) => ({ ...request, tests: [], extract: [] });

/** @returns {Promise<object>} summary of a load run */
export async function runLoad(request, { variables = {}, total = 50, concurrency = 10, urlGuard, fetchImpl, timeoutMs = 30000 } = {}) {
  const count = clamp(total, 1, LIMITS.total, 50), width = clamp(concurrency, 1, LIMITS.concurrency, 10);
  const opts = { variables, urlGuard, fetchImpl, timeoutMs, maxBodyBytes: 64 * 1024 };
  const first = await runRequest(plain(request), opts);                       // also proves the request works before hammering it
  if (!first.ok && /Missing variable|Bad request|may only call/.test(first.error || "")) return { mode: "load", error: first.error };

  const results = [first];
  let next = 1;
  const started = performance.now();
  await Promise.all(Array.from({ length: Math.min(width, count) }, async () => {
    while (next < count) { next += 1; results.push(await runRequest(plain(request), opts)); }
  }));
  const seconds = (performance.now() - started) / 1000;
  const times = results.filter((r) => r.ok).map((r) => r.durationMs);
  const bad = results.filter((r) => !r.ok || r.status >= 500).length;
  return {
    mode: "load", request: `${request.method} ${request.url}`, requests: results.length, concurrency: width,
    seconds: Math.round(seconds * 100) / 100, requestsPerSecond: Math.round((results.length / Math.max(seconds, 0.001)) * 10) / 10,
    statuses: histogram(results), errorRate: Math.round((bad / results.length) * 1000) / 10,
    latencyMs: { min: times.length ? Math.min(...times) : null, p50: percentile(times, 50), p95: percentile(times, 95), p99: percentile(times, 99), max: times.length ? Math.max(...times) : null },
    errors: errorSamples(results),
    verdict: bad ? `${bad} of ${results.length} requests failed under load.` : times.length && percentile(times, 95) > 1000 ? "No errors, but the slowest 5% took over a second." : "Held up: no errors.",
  };
}

/** Pulls id-looking values out of a JSON response (id, _id, uuid, orderId…), to see whether racing requests made different records. */
export function idsOf(body) {
  try {
    const j = JSON.parse(body), root = j?.data && typeof j.data === "object" ? j.data : j;
    return Object.entries(root || {}).filter(([k, v]) => /(^|_)id$|^uuid$|Id$/.test(k) && (typeof v === "string" || typeof v === "number")).map(([k, v]) => `${k}=${v}`);
  } catch { return []; }
}

/** @returns {Promise<object>} summary of a race */
export async function runRace(request, { variables = {}, n = 2, urlGuard, fetchImpl, timeoutMs = 30000 } = {}) {
  const count = clamp(n, 2, LIMITS.race, 2);
  const opts = { variables, urlGuard, fetchImpl, timeoutMs, maxBodyBytes: 64 * 1024 };
  const results = await Promise.all(Array.from({ length: count }, () => runRequest(plain(request), opts)));
  if (results.every((r) => !r.ok) && /Missing variable|Bad request|may only call/.test(results[0].error || "")) return { mode: "race", error: results[0].error };

  const okCount = results.filter((r) => r.ok && r.status < 300).length;
  const ids = new Set(results.filter((r) => r.ok && r.status < 300).flatMap((r) => idsOf(r.body)));
  const distinctIds = new Set(results.filter((r) => r.ok && r.status < 300).map((r) => idsOf(r.body).join("|")).filter(Boolean));
  const crashed = results.filter((r) => !r.ok || r.status >= 500).length;
  const verdict = crashed ? `${crashed} of ${count} simultaneous requests crashed or failed.`
    : okCount > 1 && distinctIds.size > 1 ? `${okCount} succeeded and created ${distinctIds.size} different records. If this action should happen once (order, payment, signup), it needs a lock or an idempotency key.`
    : okCount > 1 ? `${okCount} of ${count} succeeded. If this action should happen only once, check it didn't run ${okCount} times (read the data back).`
    : okCount === 1 ? "Exactly one succeeded and the rest were refused. Good." : "None succeeded.";
  return { mode: "race", request: `${request.method} ${request.url}`, simultaneous: count, statuses: histogram(results), succeeded: okCount, distinctRecords: distinctIds.size, ids: [...ids].slice(0, 10), errors: errorSamples(results), verdict };
}
