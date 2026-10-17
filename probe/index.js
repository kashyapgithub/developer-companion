/**
 * developer-companion-probe — tell Developer Companion how many database queries each request ran.
 *
 * Why: the classic AI-written-backend slowness is the N+1 query (one query for a list, then one more for every
 * item). A browser can't see inside your server, so this tiny helper adds two response headers:
 *
 *     x-dc-queries: 23        how many queries this request ran
 *     x-dc-query-ms: 41       time spent in them
 *
 * Developer Companion's API client reads them (and the agent's api_run gets them), warns on an N+1 shape, and
 * you can add a test "Queries < 10". Zero dependencies, works with Express, Fastify (via hook), Koa or plain http.
 *
 *   import { queryCounter, instrument, count } from "developer-companion-probe";
 *   app.use(queryCounter());                         // 1. once, before your routes
 *   instrument(pool);                                // 2. once per db client (pg, mysql2, knex…): wraps .query
 *   // Prisma: prisma.$on("query", (e) => count(Number(e.duration)));
 *   // anything else: call count(ms) each time you run a query.
 *
 * Only switch it on in development (queryCounter({ enabled: process.env.NODE_ENV !== "production" })).
 */

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();
export const HEADER_COUNT = "x-dc-queries";
export const HEADER_MS = "x-dc-query-ms";

/** Records one query for the request being handled (a no-op outside a request). */
export function count(ms = 0) {
  const s = store.getStore();
  if (s) { s.queries += 1; s.ms += Number(ms) || 0; }
}

/**
 * Express / Connect / Koa-style middleware (req, res, next). Adds the headers just before they are sent.
 * @param {{ enabled?: boolean }} [options]
 */
export function queryCounter({ enabled = true } = {}) {
  return function dcQueryCounter(req, res, next) {
    if (!enabled) return next();
    const state = { queries: 0, ms: 0 };
    const writeHead = res.writeHead;
    res.writeHead = function (...args) {
      if (!res.headersSent) { res.setHeader(HEADER_COUNT, String(state.queries)); res.setHeader(HEADER_MS, String(Math.round(state.ms))); }
      return writeHead.apply(this, args);
    };
    store.run(state, next);
  };
}

/**
 * Wraps the query methods of a database client so each call is counted and timed. Returns the same object.
 * Works for promise-returning and callback-style methods.
 * Also understands synchronous SQLite clients (better-sqlite3, node:sqlite): it wraps `exec` and every statement
 * returned by `prepare` (`run`, `get`, `all`, `iterate`).
 * @param {object} client e.g. a pg Pool, mysql2 pool, knex instance, better-sqlite3 database
 * @param {string[]} [methods]
 */
export function instrument(client, methods) {
  if (!methods && typeof client?.query !== "function" && typeof client?.prepare === "function") return instrumentSqlite(client);
  for (const name of methods || ["query"]) {
    const original = client?.[name];
    if (typeof original !== "function" || original.__dcWrapped) continue;
    const wrapped = function (...args) {
      const started = performance.now();
      const done = () => count(performance.now() - started);
      const last = args[args.length - 1];
      if (typeof last === "function") { args[args.length - 1] = function (...cbArgs) { done(); return last.apply(this, cbArgs); }; return original.apply(this, args); }
      const result = original.apply(this, args);
      if (result && typeof result.then === "function") result.then(done, done); else done();
      return result;
    };
    wrapped.__dcWrapped = true;
    client[name] = wrapped;
  }
  return client;
}

/** SQLite style: db.exec(sql) and db.prepare(sql).run/get/all/iterate(...). Each execution counts as one query. */
function instrumentSqlite(db) {
  const timed = (fn, self, args) => { const started = performance.now(); try { return fn.apply(self, args); } finally { count(performance.now() - started); } };
  if (typeof db.exec === "function" && !db.exec.__dcWrapped) {
    const exec = db.exec; db.exec = function (...a) { return timed(exec, this, a); }; db.exec.__dcWrapped = true;
  }
  const prepare = db.prepare;
  if (prepare.__dcWrapped) return db;
  db.prepare = function (...a) {
    const stmt = prepare.apply(this, a);
    for (const name of ["run", "get", "all", "iterate"]) {
      const original = stmt[name];
      if (typeof original === "function") stmt[name] = function (...args) { return timed(original, this, args); };
    }
    return stmt;
  };
  db.prepare.__dcWrapped = true;
  return db;
}
