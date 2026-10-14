/** api-core.test.mjs — variables, JSON paths and assertions of the API client. */
import { ROOT } from "../helpers/paths.mjs";
const v = await import(ROOT + "/server/api/vars.js");
const jp = await import(ROOT + "/server/api/json-path.js");
const as = await import(ROOT + "/server/api/assertions.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

// variables
let r = v.substitute("{{baseUrl}}/users/{{ id }}", { baseUrl: "http://x", id: 7 });
t("substitutes names (spaces allowed)", r.text === "http://x/users/7" && r.missing.length === 0);
r = v.substitute("{{a}} and {{b}}", { a: "1" });
t("unknown names stay and are reported", r.text === "1 and {{b}}" && r.missing.join() === "b");
t("dynamic values work", /^[0-9a-f-]{36}$/.test(v.fill("{{$guid}}", {})) && /^\d{10}$/.test(v.fill("{{$timestamp}}", {})));
t("namesIn lists variables, not dynamic ones", v.namesIn("{{a}}{{$guid}}{{b}}{{a}}").join() === "a,b");
t("rowsToObject skips disabled and blank keys", JSON.stringify(v.rowsToObject([{ key: "a", value: "1" }, { key: "b", value: "2", enabled: false }, { key: " ", value: "x" }])) === '{"a":"1"}');
t("0 and empty string are real values", v.fill("{{z}}|{{e}}", { z: 0, e: "" }) === "0|");

// json path
const data = { data: { items: [{ id: 1 }, { id: 2 }], "odd key": { x: 5 }, token: "t" }, list: [1, 2, 3] };
t("dotted + index", jp.getPath(data, "data.items[1].id") === 2);
t("$ prefix", jp.getPath(data, "$.data.token") === "t");
t("negative index", jp.getPath(data, "list[-1]") === 3);
t("quoted key", jp.getPath(data, "data['odd key'].x") === 5);
t("missing gives undefined", jp.getPath(data, "data.nope.deeper") === undefined && jp.getPath(data, "list[9]") === undefined);
t("malformed path gives undefined", jp.getPath(data, "data..[") === undefined);
t("empty path is the whole thing", jp.getPath(data, "$") === data);

// assertions
const res = { status: 201, headers: { "content-type": "application/json; charset=utf-8" }, bodyText: '{"ok":true,"id":"abc","n":5}', json: { ok: true, id: "abc", n: 5, list: [1, 2] }, durationMs: 120 };
const run = (tests) => as.runAssertions(tests, res);
t("status equals", run([{ type: "status", value: 201 }])[0].pass);
t("status 2xx shorthand", run([{ type: "status", value: "2xx" }])[0].pass && !run([{ type: "status", value: "4xx" }])[0].pass);
t("status in list", run([{ type: "status", op: "in", value: [200, 201] }])[0].pass);
t("header contains (name is case-insensitive)", run([{ type: "header", name: "Content-Type", op: "contains", value: "json" }])[0].pass);
t("header missing fails exists", !run([{ type: "header", name: "x-nope", op: "exists" }])[0].pass);
t("json equals / exists / type", run([{ type: "json", path: "id", op: "equals", value: "abc" }, { type: "json", path: "ok", op: "exists" }, { type: "json", path: "list", op: "type", value: "array" }]).every((x) => x.pass));
t("json gt/lt/matches/contains", run([{ type: "json", path: "n", op: "gt", value: 4 }, { type: "json", path: "n", op: "lt", value: 6 }, { type: "json", path: "id", op: "matches", value: "^a.c$" }, { type: "json", path: "list", op: "contains", value: 2 }]).every((x) => x.pass));
t("body contains", run([{ type: "body", op: "contains", value: '"ok":true' }])[0].pass);
t("time under", run([{ type: "time", op: "lt", value: 500 }])[0].pass && !run([{ type: "time", op: "lt", value: 50 }])[0].pass);
const failed = run([{ type: "json", path: "id", op: "equals", value: "zzz" }])[0];
t("failures report the actual value", !failed.pass && failed.actual === "abc", JSON.stringify(failed));
t("unknown type fails clearly", /unknown test type/.test(run([{ type: "weird" }])[0].actual));
t("disabled tests are skipped", run([{ type: "status", value: 999, enabled: false }]).length === 0);
t("auto names are readable", as.describeTest({ type: "json", path: "data.id", op: "not_exists" }) === "json data.id not exists");
t("custom name wins", as.describeTest({ name: "login ok", type: "status" }) === "login ok");

for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
