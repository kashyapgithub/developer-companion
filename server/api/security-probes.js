/**
 * security-probes.js — the individual checks of "Security check".
 *
 * Each probe describes ONE question about a request:
 *   id / title      what it checks
 *   applies(req)    false = skip (nothing to test, e.g. no auth on the request)
 *   make(req, ctx)  the changed copy of the request to send (null = no request, judged from the baseline)
 *   judge(res, ctx) { status: "pass"|"fail"|"warn", detail }
 *
 * Request shapes are the saved-request shape from build-request.js.
 * These are the bugs AI-written backends most often ship: missing auth checks, user IDs taken
 * from the client, trusting every field the client sends, and error messages that leak internals.
 */

import { substitute } from "./vars.js";
import { idsOf } from "./load.js";

const AUTH_HEADERS = /^(authorization|cookie|x-api-key|x-auth-token|proxy-authorization)$/i;
const AUTH_PARAMS = /^(token|access_token|api_key|apikey|key)$/i;
const MUTATING = new Set(["POST", "PUT", "PATCH"]);
const PRIVILEGED = { role: "admin", isAdmin: true, is_admin: true, admin: true, verified: true, emailVerified: true };

const clone = (x) => JSON.parse(JSON.stringify(x));
const text = (res) => String(res.body || "");
const is = (res, ...codes) => res.ok && codes.includes(res.status);
const isDenied = (res) => is(res, 401, 403);
const isRejected = (res) => res.ok && res.status >= 400 && res.status < 500;

/** True when the request sends credentials in any form. */
export function hasAuth(req) {
  const a = req.auth?.type;
  return (a && a !== "none") || (req.headers || []).some((h) => h.enabled !== false && AUTH_HEADERS.test(h.key)) || (req.params || []).some((p) => AUTH_PARAMS.test(p.key));
}

/** A copy with every credential removed. */
function withoutAuth(req) {
  const r = clone(req);
  r.auth = { type: "none" };
  r.headers = (r.headers || []).filter((h) => !AUTH_HEADERS.test(h.key));
  r.params = (r.params || []).filter((p) => !AUTH_PARAMS.test(p.key));
  return r;
}

/** A copy that authenticates with `token` instead. */
const withToken = (req, token) => ({ ...withoutAuth(req), auth: { type: "bearer", token } });

/** A copy with one header added (replacing the same name). */
function withHeader(req, key, value) {
  const r = clone(req);
  r.headers = [...(r.headers || []).filter((h) => h.key.toLowerCase() !== key.toLowerCase()), { key, value, enabled: true }];
  return r;
}

/** The JSON body as an object (after variables are filled in), or null. */
function jsonBody(req, vars) {
  if (req.body?.mode !== "json") return null;
  try { const v = JSON.parse(substitute(req.body.content || "", vars).text); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
}
const withJson = (req, obj) => ({ ...clone(req), body: { mode: "json", content: JSON.stringify(obj) } });

/** Replaces every string value in an object (deeply) using `fn`. */
function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

/** Same change applied to the JSON body and to the query params. */
function mutateInputs(req, vars, fn) {
  const r = clone(req);
  const body = jsonBody(req, vars);
  if (body) r.body = { mode: "json", content: JSON.stringify(mapStrings(body, fn)) };
  r.params = (r.params || []).map((p) => ({ ...p, value: fn(substitute(p.value, vars).text) }));
  return r;
}
const hasInputs = (req, vars) => !!jsonBody(req, vars) || (req.params || []).length > 0;

const SQL_ERROR = /sql syntax|sqlstate|ORA-\d{4,5}|sqlite_error|unterminated quoted|pg::|psycopg|mysql_|syntax error at or near/i;
const LEAKS = [/\bat\s+[\w.<>$]+\s+\([^)]*:\d+:\d+\)/, /Traceback \(most recent call last\)/, /node_modules/, /SQLSTATE|ActiveRecord::|org\.hibernate|java\.lang\./, /\/(?:home|usr|var|app|srv)\/[\w\-./]+\.(?:js|ts|py|rb|php|java)\b/];
const SECRETS = [[/AKIA[0-9A-Z]{16}/, "an AWS access key"], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"], [/\b(?:sk_live|rk_live)_[A-Za-z0-9]{10,}/, "a live Stripe key"], [/\bghp_[A-Za-z0-9]{20,}/, "a GitHub token"], [/"password"\s*:\s*"[^"]+"/i, "a password field"]];

/** Finds internals in any response text; used by the final "error messages" check. */
export function findLeaks(bodies) { return bodies.flatMap((b) => LEAKS.filter((re) => re.test(b)).map((re) => re.source.slice(0, 24))); }

const pass = (detail) => ({ status: "pass", detail });
const fail = (detail) => ({ status: "fail", detail });
const warn = (detail) => ({ status: "warn", detail });
const code = (res) => (res.ok ? `HTTP ${res.status}` : res.error);

export const PROBES = [
  {
    id: "no-auth", title: "Works without credentials?",
    applies: (req) => hasAuth(req), make: (req) => withoutAuth(req),
    judge: (res) => isDenied(res) ? pass(`Refused with ${res.status}.`)
      : res.ok && res.status < 400 ? fail(`Answered ${res.status} with the credentials removed. The endpoint isn't checking who is calling.`)
      : res.ok && res.status >= 500 ? fail(`Crashed (${res.status}) when credentials were missing.`) : warn(`Answered ${code(res)} (expected 401 or 403).`),
  },
  {
    id: "bad-token", title: "Rejects a garbage token?",
    applies: (req) => hasAuth(req), make: (req) => withToken(req, "invalid.token.value"),
    judge: (res) => isDenied(res) ? pass(`Refused with ${res.status}.`)
      : res.ok && res.status < 400 ? fail(`Accepted a made-up token (${res.status}). Tokens aren't being verified.`)
      : res.ok && res.status >= 500 ? fail(`Crashed (${res.status}) on a bad token.`) : warn(`Answered ${code(res)} (expected 401 or 403).`),
  },
  {
    id: "other-user", title: "Can another user read this? (IDOR)",
    applies: (req, ctx) => hasAuth(req) && !!ctx.otherToken, make: (req, ctx) => withToken(req, ctx.otherToken),
    judge: (res, ctx) => (isDenied(res) || is(res, 404)) ? pass(`Refused with ${res.status}.`)
      : res.ok && res.status < 300 ? (text(res) === text(ctx.baseline) ? fail("A different user's token got exactly the same data. Access is not limited to the owner.") : warn("A different user's token got a 2xx answer. Check it only shows that user's own data."))
      : warn(`Answered ${code(res)}.`),
    skipDetail: "Set an environment variable named otherToken (a second user's token) to test this.",
  },
  {
    id: "mass-assignment", title: "Ignores fields it shouldn't accept?",
    applies: (req, ctx) => MUTATING.has(req.method) && !!jsonBody(req, ctx.vars), make: (req, ctx) => withJson(req, { ...jsonBody(req, ctx.vars), ...PRIVILEGED }),
    judge: (res) => {
      if (isRejected(res)) return pass(`Rejected extra fields (${res.status}).`);
      if (res.ok && res.status >= 500) return fail(`Crashed (${res.status}) on extra fields.`);
      let echoed = [];
      try { const j = JSON.parse(res.body); const flat = j?.data && typeof j.data === "object" ? j.data : j; echoed = Object.keys(PRIVILEGED).filter((k) => flat?.[k] === PRIVILEGED[k]); } catch { /* not JSON */ }
      return echoed.length ? fail(`Accepted and echoed privileged fields: ${echoed.join(", ")}. Whitelist the fields the client may set.`)
        : res.ok ? warn("Accepted extra fields (role, isAdmin…) without complaint. Read the record back to make sure they weren't stored.") : warn(`Answered ${code(res)}.`);
    },
  },
  {
    id: "malformed-json", title: "Handles broken JSON?",
    applies: (req) => req.body?.mode === "json" && MUTATING.has(req.method), make: (req) => ({ ...clone(req), body: { mode: "json", content: '{"broken": ' } }),
    judge: (res) => isRejected(res) ? pass(`Rejected with ${res.status}.`) : res.ok && res.status >= 500 ? fail(`Crashed (${res.status}) instead of answering 400.`) : res.ok ? fail(`Accepted broken JSON (${res.status}).`) : warn(`Answered ${code(res)}.`),
  },
  {
    id: "oversize", title: "Limits very long values?",
    applies: (req, ctx) => hasInputs(req, ctx.vars), make: (req, ctx) => mutateInputs(req, ctx.vars, () => "A".repeat(50_000)),
    judge: (res) => isRejected(res) ? pass(`Rejected with ${res.status}.`) : res.ok && res.status >= 500 ? fail(`Crashed (${res.status}) on a 50 KB value.`) : res.ok ? warn(`Accepted 50 KB values (${res.status}). Add maximum lengths.`) : warn(`Connection failed: ${res.error}`),
  },
  {
    id: "injection", title: "Survives hostile input?",
    applies: (req, ctx) => hasInputs(req, ctx.vars), make: (req, ctx) => mutateInputs(req, ctx.vars, () => `'"><script>alert(1)</script>' OR '1'='1`),
    judge: (res) => {
      if (res.ok && res.status >= 500) return fail(`Crashed (${res.status}) on quotes and script tags.`);
      if (res.ok && SQL_ERROR.test(text(res))) return fail("The response shows a database error. Input likely reaches a query unescaped.");
      if (res.ok && /html/i.test(res.headers?.["content-type"] || "") && text(res).includes("<script>alert(1)</script>")) return fail("The script tag came back unescaped in an HTML response (XSS).");
      return pass(res.ok ? `Handled it (${res.status}).` : "Rejected the connection.");
    },
  },
  {
    // Sends the SAME request twice with the same Idempotency-Key (the safe way to retry a payment or order).
    id: "idempotency", title: "Safe to retry? (Idempotency-Key)", repeat: 2,
    applies: (req) => MUTATING.has(req.method), make: (req) => withHeader(req, "Idempotency-Key", `dc-probe-${Math.random().toString(36).slice(2, 10)}`),
    judge: (res, ctx) => {
      const a = res, b = ctx.second;
      if (!(a.ok && a.status < 300) || !b?.ok) return warn(`Couldn't compare: answered ${code(a)} then ${b ? code(b) : "nothing"}.`);
      const ida = idsOf(a.body).join("|"), idb = idsOf(b.body).join("|");
      if (b.status === 409 || b.status === 422) return pass(`The retry was refused (${b.status}), so nothing was done twice.`);
      if (ida && idb && ida !== idb) return warn(`The same Idempotency-Key created two different records (${ida} and ${idb}). A retry after a timeout would do the action twice. Store the key and return the first result.`);
      return a.body === b.body ? pass("The retry returned the identical result.") : warn("The retry answered differently. Make sure a retry returns the first result.");
    },
  },
  {
    // The token of a user who logged out / whose session expired should be dead. Needs the variable expiredToken.
    id: "expired-token", title: "Rejects an old (logged-out) token?",
    applies: (req, ctx) => hasAuth(req) && !!ctx.expiredToken, make: (req, ctx) => withToken(req, ctx.expiredToken),
    skipDetail: "Set an environment variable named expiredToken (a token from before logout) to test this.",
    judge: (res) => isDenied(res) ? pass(`Refused with ${res.status}.`) : res.ok && res.status < 400 ? fail(`An old token still works (${res.status}). Logging out or expiry doesn't revoke it.`) : warn(`Answered ${code(res)}.`),
  },
  {
    id: "headers", title: "Safe response headers?",
    applies: () => true, make: () => null,
    judge: (_res, ctx) => {
      const h = ctx.baseline.headers || {}, issues = [];
      const cors = h["access-control-allow-origin"];
      if (cors === "*" && /true/i.test(h["access-control-allow-credentials"] || "")) return fail("CORS allows any origin together with credentials.");
      if (cors === "*" && hasAuth(ctx.request)) issues.push("CORS allows any website to read this authenticated API (access-control-allow-origin: *)");
      if (!h["x-content-type-options"]) issues.push("missing x-content-type-options: nosniff");
      if (/^https:/i.test(ctx.baseline.finalUrl || "") && !h["strict-transport-security"]) issues.push("missing strict-transport-security");
      if (h["x-powered-by"]) issues.push(`reveals its stack (x-powered-by: ${h["x-powered-by"]})`);
      return issues.length ? warn(issues.join("; ") + ".") : pass("Headers look fine.");
    },
  },
  {
    id: "secrets", title: "Leaks secrets in the response?",
    applies: () => true, make: () => null,
    judge: (_res, ctx) => { const hit = SECRETS.find(([re]) => re.test(text(ctx.baseline))); return hit ? warn(`The response contains ${hit[1]}.`) : pass("Nothing secret-looking in the response."); },
  },
];
