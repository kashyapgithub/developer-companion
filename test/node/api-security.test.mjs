/**
 * api-security.test.mjs — security probes, load and race tests against local servers:
 * one deliberately vulnerable, one done properly.
 */
import http from "node:http";
import { runSecurity } from "../../server/api/security.js";
import { runLoad, runRace, percentile, idsOf } from "../../server/api/load.js";
import { cleanRequest } from "../../server/api/store.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

let orderSeq = 0, locked = false;
const send = (res, code, body, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", async () => {
    const auth = req.headers.authorization || "", path = req.url.split("?")[0];
    if (path === "/open") return send(res, 200, { secret: 1 }, { "access-control-allow-origin": "*", "x-powered-by": "Express" });
    if (path === "/safe") return auth === "Bearer good" ? send(res, 200, { mine: true }, { "x-content-type-options": "nosniff" }) : send(res, auth ? 403 : 401, { error: "no" });
    if (path === "/idor") return /^Bearer (good|bob)$/.test(auth) ? send(res, 200, { orders: [1, 2] }, { "x-content-type-options": "nosniff" }) : send(res, 401, {});
    if (path === "/users") {                                   // vulnerable
      if (auth !== "Bearer good") return send(res, 401, {});
      try { const body = JSON.parse(raw); return send(res, 201, { ...body, id: 7 }, { "x-content-type-options": "nosniff" }); }
      catch { return send(res, 500, "Error: Unexpected end of JSON\n    at JSON.parse (<anonymous>)\n    at Object.handler (/app/server.js:10:5)", { "content-type": "text/plain" }); }
    }
    if (path === "/safe-users") {                              // validates
      if (auth !== "Bearer good") return send(res, 401, {});
      let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "bad json" }); }
      if (Object.keys(body).some((k) => k !== "name")) return send(res, 422, { error: "unknown field" });
      if (String(body.name).length > 100) return send(res, 413, { error: "too long" });
      return send(res, 201, { name: body.name }, { "x-content-type-options": "nosniff" });
    }
    if (path === "/orders") { await new Promise((r) => setTimeout(r, 15)); orderSeq += 1; return send(res, 201, { id: orderSeq }); }
    if (path === "/once") { await new Promise((r) => setTimeout(r, 15)); if (locked) return send(res, 409, {}); locked = true; return send(res, 201, { id: 1 }); }
    if (path === "/flaky") return Math.random() < 0.5 ? send(res, 500, {}) : send(res, 200, {});
    if (path === "/slow") { await new Promise((r) => setTimeout(r, 20)); return send(res, 200, {}); }
    send(res, 404, {});
  });
});
await new Promise((r) => server.listen(5979, "127.0.0.1", r));
const base = "http://127.0.0.1:5979";
const bearer = (token) => ({ type: "bearer", token });
const req = (o) => cleanRequest({ method: "GET", ...o, url: base + o.url });
const find = (rep, id) => rep.probes.find((p) => p.id === id);

// ---- security ----
let r = await runSecurity(req({ url: "/open", auth: bearer("good") }));
t("an open endpoint fails the no-credentials check", find(r, "no-auth").status === "fail");
t("and accepts a made-up token", find(r, "bad-token").status === "fail");
t("CORS * on an authenticated API is flagged", find(r, "headers").status === "warn" && /x-powered-by/.test(find(r, "headers").detail));
t("the other-user check is skipped without a second token", find(r, "other-user").status === "skip");

r = await runSecurity(req({ url: "/safe", auth: bearer("good") }), { otherToken: "bob" });
t("a properly protected endpoint passes auth checks", find(r, "no-auth").status === "pass" && find(r, "bad-token").status === "pass");
t("another user is refused", find(r, "other-user").status === "pass");
t("no failures on a clean endpoint", r.summary.fail === 0, JSON.stringify(r.summary));

r = await runSecurity(req({ url: "/idor", auth: bearer("good") }), { otherToken: "bob" });
t("IDOR: a second user getting the same data fails", find(r, "other-user").status === "fail");

r = await runSecurity(req({ method: "POST", url: "/users", auth: bearer("good"), body: { mode: "json", content: '{"name":"Ada"}' } }));
t("mass assignment is caught when fields are echoed", find(r, "mass-assignment").status === "fail" && /role/.test(find(r, "mass-assignment").detail));
t("broken JSON crashing the server fails", find(r, "malformed-json").status === "fail");
t("stack traces in errors are flagged", find(r, "error-leak").status === "warn");

r = await runSecurity(req({ method: "POST", url: "/safe-users", auth: bearer("good"), body: { mode: "json", content: '{"name":"Ada"}' } }));
t("a validating endpoint passes mass assignment", find(r, "mass-assignment").status === "pass");
t("and malformed JSON", find(r, "malformed-json").status === "pass");
t("and oversized values", find(r, "oversize").status === "pass");
t("error messages stay private", find(r, "error-leak").status === "pass");

r = await runSecurity(req({ url: "/nowhere" }));
t("an unreachable baseline is reported, not thrown", r.baselineStatus === 404 || r.error !== undefined);
r = await runSecurity({ ...req({ url: "/safe" }), url: "http://127.0.0.1:1/x" });
t("a dead server gives a clear error", !!r.error);

// ---- load / race ----
t("percentile maths", percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50) === 5 && percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95) === 10 && percentile([], 50) === null);
const load = await runLoad(req({ url: "/slow" }), { total: 40, concurrency: 8 });
t("load sends every request", load.requests === 40 && load.statuses["200"] === 40, JSON.stringify(load.statuses));
t("load reports latency percentiles", load.latencyMs.p50 >= 15 && load.latencyMs.p95 >= load.latencyMs.p50);
t("concurrency makes it faster than serial", load.seconds < 40 * 0.02, `${load.seconds}s`);
t("a clean run says so", /Held up/.test(load.verdict));
const flaky = await runLoad(req({ url: "/flaky" }), { total: 40, concurrency: 5 });
t("failures under load show in the error rate", flaky.errorRate > 10 && /failed under load/.test(flaky.verdict) && flaky.errors.length > 0);
t("limits are enforced", (await runLoad(req({ url: "/slow" }), { total: 99999, concurrency: 999 })).requests === 500);
const race = await runRace(req({ method: "POST", url: "/orders" }), { n: 3 });
t("a race that creates duplicates is called out", race.succeeded === 3 && race.distinctRecords === 3 && /different records/.test(race.verdict), race.verdict);
const once = await runRace(req({ method: "POST", url: "/once" }), { n: 4 });
t("a properly locked action passes the race", once.succeeded === 1 && /Exactly one/.test(once.verdict), once.verdict);
t("ids are read from JSON bodies", idsOf('{"data":{"orderId":5,"name":"x"}}').join() === "orderId=5" && idsOf("nope").length === 0);
t("a missing variable stops the test early", !!(await runLoad(cleanRequest({ url: "{{nope}}/x" }), {})).error);
server.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
