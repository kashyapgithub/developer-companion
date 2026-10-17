/**
 * runner.js — sends one saved request and reports what came back.
 *
 * Steps: fill variables -> send (with timeout, size cap, redirects) -> parse ->
 * run the request's tests -> pick out values to carry to the next request ("extract").
 * `fetchImpl` is injectable so tests (and anything offline) don't need a network.
 */

import { readQueries, queryAdvice } from "./query-count.js";
import { buildRequest } from "./build-request.js";
import { runAssertions } from "./assertions.js";
import { getPath } from "./json-path.js";

const DEFAULTS = { timeoutMs: 30000, maxBodyBytes: 2 * 1024 * 1024, maxShownChars: 200000 };

/** Reads a response body up to `max` bytes (so a huge download can't fill memory). */
async function readCapped(res, max) {
  if (!res.body) return { text: "", size: 0, truncated: false };
  const reader = res.body.getReader();
  const chunks = []; let size = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { truncated = true; chunks.push(value.slice(0, value.length - (size - max))); size = max; await reader.cancel().catch(() => {}); break; }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), size, truncated };
}

/** Lower-cased header object from a fetch Headers. */
const headersToObject = (h) => { const o = {}; h.forEach((v, k) => { o[k] = v; }); return o; };

/** Tries to parse JSON; returns undefined when it isn't JSON. */
function tryJson(text) { try { return JSON.parse(text); } catch { return undefined; } }

/** Values to carry forward: [{var, from:"data.token"}] -> { token: "…" } (from the JSON body, or "header:name"). */
export function extractValues(rules = [], res) {
  const out = {};
  for (const r of rules) {
    if (!r || !r.var || !r.from) continue;
    const value = String(r.from).startsWith("header:") ? res.headers[String(r.from).slice(7).toLowerCase()] : getPath(res.json, r.from);
    if (value !== undefined && value !== null) out[r.var] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
}

/**
 * @param {object} req saved request
 * @param {{variables?:object, fetchImpl?:Function, timeoutMs?:number, maxBodyBytes?:number, urlGuard?:(url:string)=>string|null}} opts
 *        urlGuard returns an error message to refuse a URL (used for agent calls), or null to allow.
 */
export async function runRequest(req, opts = {}) {
  const { variables = {}, fetchImpl = fetch, timeoutMs = DEFAULTS.timeoutMs, maxBodyBytes = DEFAULTS.maxBodyBytes, urlGuard } = opts;
  let built;
  try { built = buildRequest(req, variables); }
  catch (err) { return { ok: false, name: req.name, error: `Bad request: ${err.message}` }; }
  const base = { name: req.name, method: built.method, url: built.url };
  if (built.missing.length) return { ...base, ok: false, error: `Missing variable${built.missing.length > 1 ? "s" : ""}: ${built.missing.map((m) => `{{${m}}}`).join(", ")}. Set them in the environment.` };
  const refused = urlGuard?.(built.url);
  if (refused) return { ...base, ok: false, error: refused };

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(built.url, { method: built.method, headers: built.headers, body: built.body, redirect: "follow", signal: controller.signal });
    const { text, size, truncated } = await readCapped(res, maxBodyBytes);
    const durationMs = Math.round(performance.now() - started);
    const headers = headersToObject(res.headers);
    const json = tryJson(text);
    const queries = readQueries(headers);
    const response = { status: res.status, headers, bodyText: text, json, durationMs, queries };
    const tests = runAssertions(req.tests, response);
    return {
      ...base, ok: true, finalUrl: res.url || built.url, status: res.status, statusText: res.statusText, durationMs, size, truncated,
      headers, body: text.length > DEFAULTS.maxShownChars ? text.slice(0, DEFAULTS.maxShownChars) : text, isJson: json !== undefined,
      ...(queries ? { queries, queryAdvice: queryAdvice(queries, json) } : {}),
      tests, testsPassed: tests.every((t) => t.pass), extracted: extractValues(req.extract, response),
      sent: { headers: built.headers, body: built.body },
    };
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    const cause = err?.cause?.code || err?.cause?.message;
    return { ...base, ok: false, durationMs: Math.round(performance.now() - started), error: timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : `Couldn't connect: ${cause || err.message}` };
  } finally { clearTimeout(timer); }
}
