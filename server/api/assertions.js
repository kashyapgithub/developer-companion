/**
 * assertions.js — the "Tests" of the API client: simple checks on a response.
 *
 *   { type: "status", op: "equals", value: 200 }          also value "2xx", op "in" with [200,201]
 *   { type: "header", name: "content-type", op: "contains", value: "json" }
 *   { type: "json",   path: "data.id", op: "exists" }     ops: equals, not_equals, exists, not_exists,
 *   { type: "json",   path: "items", op: "type", value: "array" }       contains, gt, lt, matches, type
 *   { type: "body",   op: "contains", value: "ok" }
 *   { type: "time",   op: "lt", value: 500 }               response time in ms
 *
 * No scripting on purpose: declarative checks are safe to run for the agent and easy to read.
 */

import { getPath } from "./json-path.js";

/** Compares an actual value with an expected one using `op`. */
export function compare(op, actual, expected) {
  switch (op) {
    case "equals": return looseEqual(actual, expected);
    case "not_equals": return !looseEqual(actual, expected);
    case "exists": return actual !== undefined && actual !== null;
    case "not_exists": return actual === undefined || actual === null;
    case "contains": return typeof actual === "string" ? actual.includes(String(expected)) : Array.isArray(actual) ? actual.some((x) => looseEqual(x, expected)) : false;
    case "gt": return Number(actual) > Number(expected);
    case "lt": return Number(actual) < Number(expected);
    case "matches": try { return new RegExp(String(expected)).test(String(actual)); } catch { return false; }
    case "type": return typeOf(actual) === String(expected);
    case "in": return Array.isArray(expected) && expected.some((x) => looseEqual(actual, x));
    default: return false;
  }
}

/** 200 == "200", but objects must match exactly (by JSON). */
function looseEqual(a, b) {
  if (typeof a === "object" && a !== null) return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}

/** "array" | "object" | "null" | "string" | "number" | "boolean" | "undefined". */
export function typeOf(v) {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

/** Status shorthand: "2xx" matches 200-299. */
function statusMatches(status, op, value) {
  if (typeof value === "string" && /^\dxx$/i.test(value)) {
    const hit = String(status)[0] === value[0];
    return op === "not_equals" ? !hit : hit;
  }
  return compare(op, status, value);
}

/** One-line description of a test, used as its name when none is given. */
export function describeTest(t) {
  const target = t.type === "json" ? `json ${t.path}` : t.type === "header" ? `header ${t.name}` : t.type;
  const val = t.value === undefined ? "" : ` ${JSON.stringify(t.value)}`;
  return t.name || `${target} ${String(t.op || "equals").replace("_", " ")}${val}`;
}

/**
 * Runs every test against a response.
 * @param {object[]} tests
 * @param {{status:number, headers:Record<string,string>, bodyText:string, json:any, durationMs:number}} res
 * @returns {{name:string, pass:boolean, actual?:any}[]}
 */
export function runAssertions(tests = [], res) {
  return tests.filter((t) => t && t.enabled !== false).map((t) => {
    let actual, pass;
    switch (t.type) {
      case "status": actual = res.status; pass = statusMatches(res.status, t.op || "equals", t.value); break;
      case "header": actual = res.headers[String(t.name).toLowerCase()]; pass = compare(t.op || "exists", actual, t.value); break;
      case "json": actual = getPath(res.json, t.path); pass = compare(t.op || "exists", actual, t.value); break;
      case "body": actual = undefined; pass = compare(t.op || "contains", res.bodyText, t.value); break;
      case "time": actual = res.durationMs; pass = compare(t.op || "lt", res.durationMs, t.value); break;
      default: return { name: describeTest(t), pass: false, actual: `unknown test type "${t.type}"` };
    }
    const shown = typeof actual === "string" && actual.length > 120 ? actual.slice(0, 120) + "…" : actual;
    return { name: describeTest(t), pass: !!pass, ...(pass ? {} : { actual: shown }) };
  });
}
