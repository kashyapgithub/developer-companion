/**
 * tools.js — the API client for the AGENT (MCP tools).
 *
 *   api_list            what's saved: collections, requests, environments
 *   api_run             run one saved request (or an ad-hoc one) and get the response + test results
 *   api_run_collection  run a whole collection in order (values extracted from one feed the next)
 *   api_save            save a request so the user can see and re-run it in the API window
 *
 * The agent is limited to localhost and hosts the user configured (see agent-guard.js).
 */

import { z } from "zod";
import * as store from "./store.js";
import * as svc from "./service.js";
import { makeAgentGuard } from "./agent-guard.js";

const MAX_BODY_CHARS = 4000;

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const clip = (s) => (typeof s === "string" && s.length > MAX_BODY_CHARS ? `${s.slice(0, MAX_BODY_CHARS)}…[+${s.length - MAX_BODY_CHARS} chars]` : s);
const guardNow = () => makeAgentGuard(store.getState());

/** A result trimmed for an agent: no giant bodies, no echo of what was sent. */
export function agentView(r) {
  if (!r.ok) return { name: r.name, method: r.method, url: r.url, error: r.error };
  const { sent, headers, finalUrl, ...rest } = r;
  const keep = ["content-type", "location", "x-request-id", "set-cookie", "www-authenticate", "retry-after"];
  return { ...rest, body: clip(r.body), headers: Object.fromEntries(Object.entries(headers).filter(([k]) => keep.includes(k))), finalUrl: finalUrl !== r.url ? finalUrl : undefined };
}

const rowSchema = z.array(z.object({ key: z.string(), value: z.string(), enabled: z.boolean().optional() }));
const testSchema = z.array(z.object({
  type: z.enum(["status", "header", "json", "body", "time"]), op: z.string().optional(), value: z.any().optional(), path: z.string().optional(), name: z.string().optional(),
}));

export function registerApiTools(server) {
  server.tool(
    "api_list",
    "Lists the user's saved API requests (grouped in collections), their environments and which one is active. " +
      "These are the requests the user built in the API window of Developer Companion (or imported from Postman). " +
      "Use the names shown here with api_run.",
    {},
    async () => {
      const s = store.getState();
      return text({
        active_environment: s.environments.find((e) => e.id === s.activeEnvironmentId)?.name || null,
        environments: s.environments.map((e) => ({ name: e.name, variables: Object.keys(e.variables) })),
        collections: s.collections.map((c) => ({ name: c.name, requests: c.requests.map((r) => ({ ref: `${c.name}/${r.name}`, method: r.method, url: r.url, folder: r.folder || undefined, tests: r.tests.length })) })),
      });
    }
  );

  server.tool(
    "api_run",
    "Sends an HTTP request and returns status, timing, key headers, the body and the results of its tests. Either " +
      "run a saved one with ref ('Collection/Request name' from api_list), or give method + url (+ headers, json_body, " +
      "tests) for a one-off. {{variables}} come from the user's active environment. Only localhost and hosts the user " +
      "configured in an environment are allowed. Great for checking an endpoint you just wrote.",
    {
      ref: z.string().optional().describe("Saved request, e.g. 'Shop/Login'"),
      method: z.string().optional().describe("For a one-off request (default GET)"),
      url: z.string().optional().describe("For a one-off request, e.g. http://localhost:3000/api/orders"),
      headers: z.record(z.string()).optional().describe("Extra headers for a one-off request"),
      json_body: z.any().optional().describe("JSON body for a one-off request"),
      tests: testSchema.optional().describe("Checks to run on the response, e.g. [{type:'status',value:200},{type:'json',path:'data.id',op:'exists'}]"),
    },
    async ({ ref, method, url, headers, json_body, tests }) => {
      try {
        if (ref) return text(agentView(await svc.runSaved(ref, { guard: guardNow() })));
        if (!url) return text("Give either ref (a saved request) or url.");
        const request = store.cleanRequest({
          name: `${method || "GET"} ${url}`, method, url, tests: tests || [],
          headers: Object.entries(headers || {}).map(([key, value]) => ({ key, value, enabled: true })),
          body: json_body === undefined ? { mode: "none" } : { mode: "json", content: JSON.stringify(json_body) },
        });
        return text(agentView(await svc.runOne(request, { guard: guardNow() })));
      } catch (err) { return text(`Failed: ${err.message}`); }
    }
  );

  server.tool(
    "api_run_collection",
    "Runs every request of a saved collection in order and reports pass/fail per request with the test results. Values a " +
      "request extracts (like a login token) are available to the next ones. Use after changing an API to check nothing broke.",
    {
      collection: z.string().describe("Collection name from api_list"),
      folder: z.string().optional().describe("Only this folder of the collection"),
      stop_on_failure: z.boolean().optional().describe("Stop at the first failing request"),
    },
    async ({ collection, folder, stop_on_failure }) => {
      try {
        const run = await svc.runCollection(collection, { folder, stopOnFailure: stop_on_failure, guard: guardNow() });
        return text({
          collection: run.collection, summary: `${run.passed}/${run.ran} passed${run.ran < run.total ? ` (stopped; ${run.total - run.ran} not run)` : ""}`,
          results: run.results.map((r) => ({ name: r.name, status: r.status, ms: r.durationMs, passed: r.ok && r.testsPassed, error: r.error, failed_tests: (r.tests || []).filter((t) => !t.pass), body: r.ok && !r.testsPassed ? clip(r.body) : undefined })),
        });
      } catch (err) { return text(`Failed: ${err.message}`); }
    }
  );

  server.tool(
    "api_save",
    "Saves a request into a collection (created if missing) so the user sees it in the API window and can re-run it. " +
      "Add tests so it doubles as a regression check, and extract rules to carry values (like a token) to later requests.",
    {
      collection: z.string().describe("Collection name (created if it doesn't exist)"),
      name: z.string().describe("Request name"),
      method: z.string().optional(), url: z.string().describe("May use {{variables}}, e.g. {{baseUrl}}/api/orders"),
      headers: rowSchema.optional(), json_body: z.any().optional(), tests: testSchema.optional(),
      extract: z.array(z.object({ var: z.string(), from: z.string().describe("JSON path like data.token, or header:name") })).optional(),
      folder: z.string().optional(),
    },
    async ({ collection, name, method, url, headers, json_body, tests, extract, folder }) => {
      try {
        const s = store.getState();
        const col = s.collections.find((c) => c.name === collection) || store.createCollection(collection);
        const existing = col.requests.find((r) => r.name === name);
        const saved = store.saveRequest(col.id, {
          id: existing?.id, name, folder, method, url, headers: headers || [], tests: tests || [], extract: extract || [],
          body: json_body === undefined ? { mode: "none" } : { mode: "json", content: JSON.stringify(json_body, null, 2) },
        });
        return text({ saved: `${col.name}/${saved.name}`, note: "Visible in the API window. Run it with api_run." });
      } catch (err) { return text(`Failed: ${err.message}`); }
    }
  );
}
