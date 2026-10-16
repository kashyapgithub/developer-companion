/**
 * api-server.test.mjs — the API client through the real server: HTTP routes (what the popup uses)
 * and MCP tools (what the agent uses), against a small local API.
 */
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ROOT } from "../helpers/paths.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const api = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    res.writeHead(req.url === "/login" ? 200 : req.url === "/orders" && req.headers.authorization === "Bearer tok-9" ? 201 : 401, { "content-type": "application/json" });
    res.end(req.url === "/login" ? JSON.stringify({ data: { token: "tok-9" } }) : JSON.stringify({ id: 1, got: body }));
  });
});
await new Promise((r) => api.listen(5973, "127.0.0.1", r));
const base = "http://127.0.0.1:5973";

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5972", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-apis-")) } }));
await new Promise((r) => setTimeout(r, 800));
const H = "http://127.0.0.1:5972/apiclient";
const call = async (method, p, body) => { const r = await fetch(H + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };
const tool = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 }); try { return JSON.parse(r.content[0].text); } catch { return r.content[0].text; } };

// ---- popup routes ----
let r = await call("GET", "/state");
t("empty state to begin with", r.status === 200 && r.collections.length === 0 && r.environments.length === 0);
const col = (await call("POST", "/collections", { name: "Shop" })).collection;
t("create collection", !!col.id && col.name === "Shop");
await call("POST", "/environments", { name: "Local", variables: { baseUrl: base } });
r = await call("GET", "/state");
t("environment saved and becomes active", r.environments.length === 1 && r.activeEnvironmentId === r.environments[0].id);
const login = (await call("POST", `/collections/${col.id}/requests`, { name: "Login", method: "POST", url: "{{baseUrl}}/login", tests: [{ type: "status", value: 200 }], extract: [{ var: "token", from: "data.token" }] })).request;
await call("POST", `/collections/${col.id}/requests`, { name: "Create order", method: "POST", url: "{{baseUrl}}/orders", auth: { type: "bearer", token: "{{token}}" }, body: { mode: "json", content: '{"qty":2}' }, tests: [{ type: "status", value: 201 }, { type: "json", path: "id", op: "exists" }] });
t("requests saved", (await call("GET", "/state")).collections[0].requests.length === 2);
r = await call("POST", "/run", { request: { name: "adhoc", method: "GET", url: "{{baseUrl}}/login" } });
t("popup run: any request sends and returns the response", r.result.status === 200 && r.result.isJson && /tok-9/.test(r.result.body));
r = await call("POST", "/run-collection", { collection: "Shop" });
t("collection run via route: token chains into the order call", r.run.passed === 2 && r.run.failed === 0, JSON.stringify(r.run.results.map((x) => x.status)));
t("history recorded", (await call("GET", "/state")).history.length >= 3);
r = await call("POST", "/curl", { request: { method: "POST", url: "{{baseUrl}}/orders", body: { mode: "json", content: "{}" } } });
t("copy-as-curl uses the environment", /curl -X POST 'http:\/\/127\.0\.0\.1:5973\/orders'/.test(r.curl));
r = await call("POST", "/import", { text: "curl -X POST http://localhost:3000/api/x -H 'Content-Type: application/json' -d '{\"a\":1}'" });
t("import a pasted curl command", r.kind === "curl" && r.request.method === "POST" && r.request.body.mode === "json");
r = await call("POST", "/import", { text: JSON.stringify({ info: { name: "PM" }, item: [{ name: "One", request: { method: "GET", url: "http://localhost/x" } }] }) });
t("import a Postman collection", r.kind === "collection" && r.collection.requests.length === 1 && r.notes.requests === 1);
r = await call("POST", "/import", { text: JSON.stringify({ name: "Prod", values: [{ key: "baseUrl", value: "https://api.myapp.com" }] }) });
t("import a Postman environment", r.kind === "environment" && r.environment.variables.baseUrl === "https://api.myapp.com");
r = await call("POST", "/import", { text: "hello there" });
t("junk import gives a helpful message", r.status === 400 && /curl command|Postman/.test(r.error));
r = await call("POST", "/collections", { name: " " }); t("bad input is a 400, not a crash", r.status === 400 && !!r.error);
r = await call("POST", "/run", { request: { method: "GET", url: "http://127.0.0.1:5974/none" } }); t("unreachable host is reported in the result", r.status === 200 && !r.result.ok && /Couldn't connect/.test(r.result.error));

// ---- agent tools ----
const names = (await client.listTools()).tools.map((x) => x.name);
t("agent has all six tools", ["api_list", "api_run", "api_run_collection", "api_save", "api_security", "api_stress"].every((n) => names.includes(n)));
const list = await tool("api_list");
t("api_list shows collections, refs and environments", list.collections.some((c) => c.name === "Shop" && c.requests.some((q) => q.ref === "Shop/Login")) && list.environments.some((e) => e.name === "Local"));
let run = await tool("api_run", { ref: "Shop/Login" });
t("api_run a saved request", run.status === 200 && run.testsPassed === true && run.tests.length === 1);
run = await tool("api_run", { method: "GET", url: `${base}/login`, tests: [{ type: "json", path: "data.token", op: "exists" }] });
t("api_run a one-off request with tests", run.status === 200 && run.testsPassed === true);
run = await tool("api_run", { method: "GET", url: "https://example.org/data" });
t("agent is refused for a host nobody configured", /may only call localhost/.test(run.error || ""), JSON.stringify(run).slice(0, 120));
run = await tool("api_run", { method: "GET", url: "http://169.254.169.254/latest/meta-data" });
t("agent is refused for the cloud metadata address", !!run.error && /may only call/.test(run.error));
const coll = await tool("api_run_collection", { collection: "Shop" });
t("api_run_collection summary", coll.summary === "2/2 passed" && coll.results.every((x) => x.passed), JSON.stringify(coll.summary));
const saved = await tool("api_save", { collection: "Agent checks", name: "Orders needs auth", method: "POST", url: "{{baseUrl}}/orders", json_body: { qty: 1 }, tests: [{ type: "status", value: 401 }] });
t("api_save creates the collection and request", /Agent checks\/Orders needs auth/.test(saved.saved));
t("…and the user sees it in the popup's state", (await call("GET", "/state")).collections.some((c) => c.name === "Agent checks" && c.requests.length === 1));
t("…and it runs: no token sent, 401 as the test expects", (await tool("api_run", { ref: "Agent checks/Orders needs auth" })).testsPassed === true);
t("unknown ref gives advice", /api_list/.test(await tool("api_run", { ref: "Nope/Nope" })));

// security + stress tools
const sec = await tool("api_security", { ref: "Agent checks/Orders needs auth" });
t("api_security returns findings in agent form", sec.summary && Array.isArray(sec.findings) && sec.request.includes("/orders"), JSON.stringify(sec).slice(0, 120));
t("api_security refuses unknown refs with advice", /api_list/.test(await tool("api_security", { ref: "Nope/Nope" })));
const colSec = await tool("api_security", { collection: "Shop" });
t("api_security can check a whole collection", colSec.results?.length === 2);
const load = await tool("api_stress", { ref: "Shop/Login", mode: "load", total: 12, concurrency: 4 });
t("api_stress load reports percentiles", load.requests === 12 && load.latencyMs.p95 !== undefined);
const race = await tool("api_stress", { ref: "Shop/Login", mode: "race", n: 3 });
t("api_stress race reports simultaneous requests", race.simultaneous === 3);
t("the popup route works too", (await call("POST", "/stress", { request: { method: "GET", url: `${base}/login` }, mode: "race", n: 2 })).report.simultaneous === 2);

await client.close(); api.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
