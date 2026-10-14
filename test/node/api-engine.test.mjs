/**
 * api-engine.test.mjs — build-request, runner (against a real local HTTP server), curl,
 * Postman import, the store, collections with chaining, and the agent URL guard.
 */
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ROOT } from "../helpers/paths.mjs";
process.env.STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dc-api-"));
const { buildRequest } = await import(ROOT + "/server/api/build-request.js");
const { runRequest } = await import(ROOT + "/server/api/runner.js");
const curl = await import(ROOT + "/server/api/curl.js");
const pm = await import(ROOT + "/server/api/postman.js");
const store = await import(ROOT + "/server/api/store.js");
const svc = await import(ROOT + "/server/api/service.js");
const { makeAgentGuard } = await import(ROOT + "/server/api/agent-guard.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

// A tiny API to talk to.
const seen = [];
const api = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const send = (code, obj, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(obj)); };
    if (req.url === "/login") return send(200, { data: { token: "tok-123" }, user: { id: 9 } });
    if (req.url === "/me") return send(req.headers.authorization === "Bearer tok-123" ? 200 : 401, { name: "Ana" });
    if (req.url.startsWith("/echo")) return send(200, { method: req.method, url: req.url, body, ct: req.headers["content-type"] }, { "x-request-id": "r-1" });
    if (req.url === "/slow") return setTimeout(() => send(200, {}), 1500);
    if (req.url === "/big") { res.writeHead(200); return res.end("x".repeat(3 * 1024 * 1024)); }
    if (req.url === "/text") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("plain words"); }
    send(404, { error: "nope" });
  });
});
await new Promise((r) => api.listen(5970, "127.0.0.1", r));
const base = "http://127.0.0.1:5970";

// ---- build-request ----
let b = buildRequest({ method: "post", url: "{{base}}/echo", params: [{ key: "a", value: "1" }, { key: "off", value: "x", enabled: false }], headers: [{ key: "X-A", value: "{{v}}" }], auth: { type: "bearer", token: "{{tk}}" }, body: { mode: "json", content: '{"n":"{{v}}"}' } }, { base, v: "7", tk: "T" });
t("url gets the variable and query params", b.url === `${base}/echo?a=1`, b.url);
t("method upper-cased, headers filled, bearer added", b.method === "POST" && b.headers["X-A"] === "7" && b.headers.Authorization === "Bearer T");
t("json body filled and content-type defaulted", b.body === '{"n":"7"}' && b.headers["Content-Type"] === "application/json");
t("user's own content-type wins", buildRequest({ method: "POST", url: base, headers: [{ key: "content-type", value: "application/vnd.x+json" }], body: { mode: "json", content: "{}" } }).headers["content-type"] === "application/vnd.x+json");
t("GET never sends a body", buildRequest({ method: "GET", url: base, body: { mode: "json", content: "{}" } }).body === undefined);
b = buildRequest({ method: "POST", url: base, body: { mode: "form", form: [{ key: "a b", value: "c&d" }] } });
t("form body is url-encoded", b.body === "a+b=c%26d" && b.headers["Content-Type"] === "application/x-www-form-urlencoded");
t("basic auth", buildRequest({ url: base, auth: { type: "basic", username: "u", password: "p" } }).headers.Authorization === "Basic " + Buffer.from("u:p").toString("base64"));
t("api key in query", buildRequest({ url: base, auth: { type: "apikey", key: "k", value: "v", in: "query" } }).url.endsWith("?k=v"));
t("scheme added when missing", buildRequest({ url: "localhost:3000/x" }).url === "http://localhost:3000/x");
t("missing variables are listed", buildRequest({ url: "http://x/{{nope}}" }, {}).missing.join() === "nope");

// ---- runner ----
let r = await runRequest({ name: "echo", method: "POST", url: `${base}/echo`, body: { mode: "json", content: '{"a":1}' }, tests: [{ type: "status", value: 200 }, { type: "json", path: "body", op: "contains", value: "a" }, { type: "header", name: "x-request-id", op: "equals", value: "r-1" }, { type: "time", op: "lt", value: 2000 }] });
t("real request: status, json, timing", r.ok && r.status === 200 && r.isJson && r.durationMs >= 0 && JSON.parse(r.body).ct === "application/json");
t("tests ran and passed", r.tests.length === 4 && r.testsPassed, JSON.stringify(r.tests.filter((x) => !x.pass)));
t("server saw the exact body", seen.at(-1).body === '{"a":1}' && seen.at(-1).method === "POST");
r = await runRequest({ method: "GET", url: `${base}/me`, tests: [{ type: "status", value: 200 }] });
t("401 is a completed request with a failing test", r.ok && r.status === 401 && !r.testsPassed);
r = await runRequest({ method: "GET", url: `${base}/text` });
t("non-JSON body is returned as text", r.body === "plain words" && !r.isJson);
r = await runRequest({ method: "GET", url: "http://127.0.0.1:5971/nothing" });
t("connection refused is a clear error", !r.ok && /Couldn't connect/.test(r.error), r.error);
r = await runRequest({ method: "GET", url: `${base}/slow` }, { timeoutMs: 300 });
t("timeout is reported", !r.ok && /Timed out/.test(r.error), r.error);
r = await runRequest({ method: "GET", url: `${base}/big` }, { maxBodyBytes: 1024 * 1024 });
t("huge bodies are capped", r.ok && r.truncated && r.size === 1024 * 1024);
r = await runRequest({ method: "GET", url: "{{gone}}/x" }, { variables: {} });
t("missing variable stops before sending", !r.ok && /Missing variable.*\{\{gone\}\}/.test(r.error));
r = await runRequest({ method: "GET", url: `${base}/me` }, { urlGuard: () => "blocked by test" });
t("urlGuard can refuse", !r.ok && r.error === "blocked by test");
r = await runRequest({ method: "GET", url: `${base}/login`, extract: [{ var: "token", from: "data.token" }, { var: "rid", from: "header:content-type" }, { var: "nope", from: "x.y" }] });
t("extract pulls values from json and headers", r.extracted.token === "tok-123" && /json/.test(r.extracted.rid) && !("nope" in r.extracted), JSON.stringify(r.extracted));

// ---- curl ----
let c = curl.parseCurl(`curl 'http://x.test/api/orders?x=1' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer abc.def" --data-raw '{"qty":2}' --compressed`);
t("curl: method, url, json body", c.method === "POST" && c.url === "http://x.test/api/orders?x=1" && c.body.mode === "json" && c.body.content === '{"qty":2}');
t("curl: bearer becomes auth, not a header", c.auth.type === "bearer" && c.auth.token === "abc.def" && !c.headers.some((h) => h.key === "Authorization"));
c = curl.parseCurl("curl -u me:secret https://x.test/a \\\n  -H 'Accept: */*'");
t("curl: basic auth + line continuation", c.auth.username === "me" && c.auth.password === "secret" && c.headers[0].key === "Accept");
t("curl: -d implies POST", curl.parseCurl("curl http://x -d 'a=1'").method === "POST");
t("curl: no url is an error", (() => { try { curl.parseCurl("curl -X GET"); return false; } catch { return true; } })());
const cu = curl.toCurl({ method: "POST", url: "http://x/a", headers: { A: "it's" }, body: '{"q":1}' });
t("toCurl quotes safely", cu === `curl -X POST 'http://x/a' -H 'A: it'\\''s' --data-raw '{"q":1}'`, cu);
t("curl round trip keeps the request", curl.parseCurl(cu).headers[0].value === "it's");

// ---- postman ----
const coll = { info: { name: "Shop" }, variable: [{ key: "baseUrl", value: base }], item: [
  { name: "Auth", item: [{ name: "Login", request: { method: "POST", header: [{ key: "Content-Type", value: "application/json" }], url: { raw: "{{baseUrl}}/login?x=1", query: [{ key: "x", value: "1" }] }, body: { mode: "raw", raw: '{"u":"a"}', options: { raw: { language: "json" } } } }, event: [{ listen: "test", script: { exec: ["pm.test('x')"] } }] }] },
  { name: "Me", request: { method: "GET", url: "{{baseUrl}}/me", auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] } } },
  { name: "Upload", request: { method: "POST", url: "{{baseUrl}}/x", body: { mode: "formdata", formdata: [] } } } ] };
const imp = pm.importPostmanCollection(coll);
t("postman: requests imported with folder labels", imp.collection.requests.length === 3 && imp.collection.requests[0].folder === "Auth");
t("postman: url, query split, json body, header", imp.collection.requests[0].url === "{{baseUrl}}/login" && imp.collection.requests[0].params[0].key === "x" && imp.collection.requests[0].body.mode === "json");
t("postman: bearer auth and collection variables", imp.collection.requests[1].auth.token === "{{token}}" && imp.collection.variables.baseUrl === base);
t("postman: scripts and unsupported bodies are reported, not hidden", imp.notes.scripts === 1 && imp.notes.unsupportedBodies === 1, JSON.stringify(imp.notes));
t("postman: environment import", pm.importPostmanEnvironment({ name: "Staging", values: [{ key: "a", value: "1" }, { key: "b", value: "2", enabled: false }] }).variables.a === "1");
t("postman: junk refused", (() => { try { pm.importPostmanCollection({}); return false; } catch { return true; } })());
t("postman: kind detection", pm.detectPostmanKind(coll) === "collection" && pm.detectPostmanKind({ values: [] }) === "environment" && pm.detectPostmanKind({}) === null);

// ---- store + service: collection run with chaining ----
const col = store.addCollection(imp.collection);
store.saveEnvironment({ name: "Local", variables: { baseUrl: base } });
const login = col.requests[0]; login.extract = [{ var: "token", from: "data.token" }]; login.tests = [{ type: "status", value: 200 }]; login.method = "GET"; login.body = { mode: "none" }; login.params = [];
store.saveRequest(col.id, login);
const me = col.requests[1]; me.tests = [{ type: "status", value: 200 }, { type: "json", path: "name", op: "equals", value: "Ana" }]; store.saveRequest(col.id, me);
const noCreds = await svc.runSaved(`Shop/Me`);
t("without the token the request refuses to send and names the variable", !noCreds.ok && /\{\{token\}\}/.test(noCreds.error), noCreds.error);
const run = await svc.runCollection("Shop", { folder: undefined });
t("collection run: login's token feeds the next request", run.results[0].status === 200 && run.results[1].status === 200 && run.results[1].testsPassed, JSON.stringify(run.results.map((x) => x.status)));
t("collection summary counts", run.total === 3 && run.ran === 3 && typeof run.passed === "number");
t("extracted token is saved into the active environment", store.getState().environments[0].variables.token === "tok-123");
t("history is recorded (newest first)", store.getHistory().length >= 4 && store.getHistory()[0].name);
const stop = await svc.runCollection("Shop", { stopOnFailure: true, fetchImpl: async () => new Response("{}", { status: 500 }) });
t("stopOnFailure stops at the first failure", stop.ran === 1 && stop.failed === 1);
t("folder filter runs only that folder", (await svc.runCollection("Shop", { folder: "Auth" })).ran === 1);
t("curlFor builds from saved variables", /curl -X GET 'http:\/\/127\.0\.0\.1:5970\/me'/.test(svc.curlFor(store.findRequest("Shop/Me").request, col.id).curl));
t("unknown request ref errors clearly", await svc.runSaved("Shop/Nope").then(() => false, (e) => /No saved request/.test(e.message)));

// ---- store basics ----
const c2 = store.createCollection("Scratch"); store.saveRequest(c2.id, { name: "a", url: "http://x" });
t("save + find a request", store.findRequest("Scratch/a").request.method === "GET");
store.deleteRequest(c2.id, store.findRequest("Scratch/a").request.id); t("delete request", !store.findRequest("Scratch/a"));
t("rename + duplicate-name import gets a suffix", store.renameCollection(c2.id, "Renamed").name === "Renamed" && store.addCollection({ id: "z", name: "Shop", variables: {}, requests: [] }).name === "Shop (2)");
t("active environment can be switched", (() => { const e = store.saveEnvironment({ name: "Staging", variables: { baseUrl: "https://staging.example.com" } }); store.setActiveEnvironment(e.id); return store.getState().activeEnvironmentId === e.id; })());
t("empty names refused", (() => { try { store.createCollection("  "); return false; } catch { return true; } })());

// ---- agent guard ----
const guard = makeAgentGuard(store.getState());
t("agent: localhost allowed", guard("http://localhost:3000/x") === null && guard("http://127.0.0.1:1/x") === null);
t("agent: a host the user configured is allowed", guard("https://staging.example.com/api") === null);
t("agent: any other host is refused with advice", /baseUrl/.test(guard("https://evil.example.org/steal") || ""));
t("agent: the cloud metadata address is refused", guard("http://169.254.169.254/latest/meta-data") !== null);
t("agent: junk url refused", guard("::::") !== null);

api.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
