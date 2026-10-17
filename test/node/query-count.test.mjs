/** query-count.test.mjs — the optional backend probe and how the API client reads it (N+1 detection). */
import http from "node:http";
import { queryCounter, instrument, count } from "../../probe/index.js";
import { readQueries, queryAdvice } from "../../server/api/query-count.js";
import { runRequest } from "../../server/api/runner.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

// A fake database client (promise style) and a callback style one, both instrumented.
const db = instrument({ async query(sql) { await new Promise((r) => setTimeout(r, 2)); return { rows: sql.includes("authors") ? [{ name: "A" }] : [1, 2, 3, 4, 5] }; } });
const cb = instrument({ query(sql, done) { setTimeout(() => done(null, []), 1); } });
t("instrument keeps returning the same client", typeof db.query === "function" && db.query.__dcWrapped === true);
instrument(db); t("wrapping twice doesn't double count", true);

const mw = queryCounter();
const server = http.createServer((req, res) => mw(req, res, async () => {
  if (req.url === "/n-plus-one") {
    const { rows } = await db.query("select * from posts");
    const authors = []; for (const _ of rows) authors.push((await db.query("select * from authors")).rows[0]);   // one query per post
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ posts: rows.map((r, i) => ({ id: r, author: authors[i] })) }));
  }
  if (req.url === "/joined") { await db.query("select posts join authors"); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ posts: [1, 2, 3, 4, 5] })); }
  if (req.url === "/callback") { await new Promise((r) => cb.query("x", r)); res.writeHead(200); return res.end("ok"); }
  count(5); count(5);                                   // manual counting (e.g. Prisma events)
  res.writeHead(200); res.end("plain");
}));
await new Promise((r) => server.listen(5980, "127.0.0.1", r));
const get = (p, tests = []) => runRequest({ method: "GET", url: `http://127.0.0.1:5980${p}`, tests, extract: [] }, {});

let r = await get("/n-plus-one");
t("every query of the request is counted", r.queries.count === 6, JSON.stringify(r.queries));
t("time spent in queries is reported", r.queries.ms >= 6);
t("an N+1 shape is flagged in plain words", /looks like an N\+1/.test(r.queryAdvice || ""), r.queryAdvice);
r = await get("/joined");
t("one query for a list is fine", r.queries.count === 1 && r.queryAdvice === undefined);
r = await get("/callback"); t("callback-style clients are counted", r.queries.count === 1);
r = await get("/other"); t("manual count() works", r.queries.count === 2 && r.queries.ms === 10);

r = await get("/n-plus-one", [{ type: "queries", op: "lt", value: 4 }]);
t("a 'queries < 4' test fails on the N+1 endpoint", r.testsPassed === false && r.tests[0].actual === 6);
r = await get("/joined", [{ type: "queries", op: "lt", value: 4 }]);
t("and passes on the joined one", r.testsPassed === true);

const plain = http.createServer((q, s) => s.end("hi")); await new Promise((x) => plain.listen(5981, "127.0.0.1", x));
r = await runRequest({ method: "GET", url: "http://127.0.0.1:5981/", tests: [{ type: "queries", op: "lt", value: 4 }], extract: [] }, {});
t("a server without the probe gives a clear reason", r.queries === undefined && /doesn't report query counts/.test(r.tests[0].actual));
t("readQueries ignores missing or junk headers", readQueries({}) === undefined && readQueries({ "x-dc-queries": "abc" }) === undefined);
t("many queries without a list still warn", /a lot/.test(queryAdvice({ count: 40 }, { id: 1 })));
const off = http.createServer((q, s) => queryCounter({ enabled: false })(q, s, () => s.end("x"))); await new Promise((x) => off.listen(5982, "127.0.0.1", x));
r = await runRequest({ method: "GET", url: "http://127.0.0.1:5982/", tests: [], extract: [] }, {}); t("enabled:false adds no headers", r.queries === undefined);
// A REAL database: node:sqlite, with a classic N+1 loop and a joined query.
const { DatabaseSync } = await import("node:sqlite");
const sqlite = instrument(new DatabaseSync(":memory:"));
sqlite.exec("create table authors(id integer primary key, name text); create table posts(id integer primary key, author_id integer, title text)");
for (let i = 1; i <= 6; i++) { sqlite.prepare("insert into authors(name) values (?)").run("a" + i); sqlite.prepare("insert into posts(author_id,title) values (?,?)").run(i, "t" + i); }
const dbServer = http.createServer((req, res) => mw(req, res, () => {
  let posts;
  if (req.url === "/real-n1") { posts = sqlite.prepare("select * from posts").all().map((p) => ({ ...p, author: sqlite.prepare("select * from authors where id = ?").get(p.author_id) })); }
  else posts = sqlite.prepare("select p.*, a.name as author from posts p join authors a on a.id = p.author_id").all();
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ posts }));
}));
await new Promise((x) => dbServer.listen(5983, "127.0.0.1", x));
const real = (p) => runRequest({ method: "GET", url: `http://127.0.0.1:5983${p}`, tests: [], extract: [] }, {});
r = await real("/real-n1");
t("real SQLite: the N+1 loop is counted (1 + 6 queries) and flagged", r.queries.count === 7 && /N\+1/.test(r.queryAdvice || ""), JSON.stringify(r.queries));
r = await real("/real-joined");
t("real SQLite: the JOIN is one query and not flagged", r.queries.count === 1 && !r.queryAdvice, JSON.stringify(r.queries));
dbServer.close();
server.close(); plain.close(); off.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
