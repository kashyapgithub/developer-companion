/**
 * stress-tools.js — the security and load/race tests as MCP tools for the agent.
 *
 *   api_security   probes one request (or a whole collection) for the bugs AI-written backends ship
 *   api_stress     load test, or "race": the same request sent twice at once
 *
 * Same URL rule as the other API tools: localhost and hosts the user configured (agent-guard.js).
 */

import { z } from "zod";
import * as store from "./store.js";
import * as svc from "./service.js";
import { makeAgentGuard } from "./agent-guard.js";

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const guardNow = () => makeAgentGuard(store.getState());

/** Only what the agent needs: failures and warnings first, passes as a count. */
export function agentSecurityView(report) {
  if (report.error) return { request: report.request, error: report.error };
  const worst = report.probes.filter((p) => p.status === "fail" || p.status === "warn").map(({ id, title, status, detail }) => ({ id, title, status, detail }));
  return { request: report.request, baselineStatus: report.baselineStatus, summary: report.summary, findings: worst, skipped: report.probes.filter((p) => p.status === "skip").map((p) => `${p.id}: ${p.detail}`) };
}

export function registerStressTools(server) {
  server.tool(
    "api_security",
    "Probes a saved API request (ref) or a whole collection for common security bugs: works without a token, accepts a made-up token, " +
      "lets another user read the data (IDOR, needs other_token), accepts privileged extra fields (mass assignment), crashes on broken JSON, " +
      "oversized or hostile input, leaks stack traces, unsafe CORS/headers. Returns failures and warnings with what to fix. Run it after writing or changing an endpoint.",
    {
      ref: z.string().optional().describe("Saved request id or 'Collection/Request' from api_list"),
      collection: z.string().optional().describe("Check every request of this collection instead (first 25)"),
      other_token: z.string().optional().describe("A second user's token, to test that one user can't read another's data"),
    },
    async ({ ref, collection, other_token }) => {
      try {
        const guard = guardNow();
        if (collection) {
          const r = await svc.securityCheckCollection(collection, { otherToken: other_token, guard });
          return text({ collection: r.collection, results: r.results.map(agentSecurityView) });
        }
        const found = ref && store.findRequest(ref);
        if (!found) return text("Give ref (a saved request) or collection. Use api_list to see what exists.");
        return text(agentSecurityView(await svc.securityCheck(found.request, { collectionId: found.collection.id, otherToken: other_token, guard })));
      } catch (err) { return text(`Failed: ${err.message}`); }
    },
  );

  server.tool(
    "api_stress",
    "Stress-tests one saved API request. mode 'load' sends many requests with limited concurrency and reports requests/second, p50/p95/p99 latency and errors " +
      "(finds slow endpoints and pool exhaustion). mode 'race' sends the same request several times at the same instant and reports whether more than one " +
      "succeeded or created different records (finds double-submit, duplicate orders, cache stampedes). Limits: 500 requests, 50 concurrent, 20 in a race.",
    {
      ref: z.string().describe("Saved request id or 'Collection/Request' from api_list"),
      mode: z.enum(["load", "race"]).describe("'load' or 'race'"),
      total: z.number().optional().describe("load: how many requests (default 50)"),
      concurrency: z.number().optional().describe("load: how many at once (default 10)"),
      n: z.number().optional().describe("race: how many simultaneous requests (default 2)"),
    },
    async ({ ref, mode, total, concurrency, n }) => {
      try {
        const found = store.findRequest(ref);
        if (!found) return text(`No saved request "${ref}". Use api_list to see what exists.`);
        return text(await svc.stressTest(found.request, { mode, collectionId: found.collection.id, total, concurrency, n, guard: guardNow() }));
      } catch (err) { return text(`Failed: ${err.message}`); }
    },
  );
}
