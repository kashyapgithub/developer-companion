/**
 * security.js — "Security check": runs the probes (security-probes.js) against one request and
 * reports what an attacker could do. Nothing is saved; the probe requests are throwaway copies.
 *
 *   runSecurity(request, { variables, otherToken, urlGuard, fetchImpl }) -> { baseline, probes, summary }
 */

import { runRequest } from "./runner.js";
import { PROBES, findLeaks } from "./security-probes.js";

const PROBE_TIMEOUT_MS = 15000;

/** @returns {{ request: string, baselineStatus: number|null, probes: object[], summary: {pass,fail,warn,skip} }} */
export async function runSecurity(request, { variables = {}, otherToken, urlGuard, fetchImpl } = {}) {
  const opts = { variables, urlGuard, fetchImpl, timeoutMs: PROBE_TIMEOUT_MS, maxBodyBytes: 256 * 1024 };
  const baseline = await runRequest({ ...request, tests: [], extract: [] }, opts);
  const label = `${request.method} ${request.url}`;
  if (!baseline.ok) return { request: label, error: baseline.error, baselineStatus: null, probes: [], summary: { pass: 0, fail: 0, warn: 0, skip: 0 } };

  const ctx = { vars: variables, baseline, request, otherToken: otherToken || variables.otherToken };
  const probes = [], bodies = [String(baseline.body || "")];
  for (const probe of PROBES) {
    if (!probe.applies(request, ctx)) { probes.push({ id: probe.id, title: probe.title, status: "skip", detail: probe.skipDetail || "Not applicable to this request." }); continue; }
    const changed = probe.make(request, ctx);
    const res = changed ? await runRequest({ ...changed, tests: [], extract: [] }, opts) : baseline;
    if (changed && res.body) bodies.push(String(res.body));
    probes.push({ id: probe.id, title: probe.title, ...probe.judge(res, ctx), sent: changed ? res.status ?? res.error : "baseline response" });
  }
  const leaks = findLeaks(bodies);
  probes.push(leaks.length
    ? { id: "error-leak", title: "Error messages stay private?", status: "warn", detail: "Responses showed stack traces, file paths or framework internals. Return a generic message and log the detail server-side." }
    : { id: "error-leak", title: "Error messages stay private?", status: "pass", detail: "No stack traces or file paths in any response." });

  const summary = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const p of probes) summary[p.status]++;
  return { request: label, baselineStatus: baseline.status, probes, summary };
}
