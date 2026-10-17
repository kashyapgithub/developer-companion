/**
 * postman-scripts.js — turns the COMMON Postman scripts into this client's declarative tests and Extract rules,
 * so an imported collection keeps its checks. Postman scripts are JavaScript; we never run them, we only
 * recognise the usual one-line patterns:
 *
 *   pm.response.to.have.status(200)            pm.expect(pm.response.code).to.eql(200)
 *   pm.expect(pm.response.responseTime).to.be.below(500)
 *   const data = pm.response.json();           pm.expect(data.user.name).to.eql("Ada")
 *   pm.expect(data.items).to.be.an("array")    pm.expect(data).to.have.property("id")
 *   pm.environment.set("token", data.token)    pm.collectionVariables.set("id", pm.response.json().id)
 *
 * Anything else is returned in `ignored` so the import can say exactly what was left behind.
 */

const STRUCTURE = /^(\}\)?;?|\);?|\{|\/\/.*|console\.\w+\(.*|)$/;
const CHAIN_NOISE = new Set(["to", "be", "been", "is", "that", "which", "deep", "and", "at", "of", "with", "same"]);
const OPS = { eql: "equals", equal: "equals", equals: "equals", eq: "equals", include: "contains", includes: "contains", contain: "contains", contains: "contains",
  match: "matches", matches: "matches", above: "gt", greaterThan: "gt", gt: "gt", below: "lt", lessThan: "lt", lt: "lt", a: "type", an: "type", oneOf: "in" };

/** The text of the first balanced (...) starting at `from` (which must point at "("), or null. */
function balanced(src, from) {
  let depth = 0, quote = "";
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return { inner: src.slice(from + 1, i), end: i + 1 };
  }
  return null;
}

/** A JS literal -> value, or undefined when it isn't a simple literal. */
function literal(src) {
  const s = String(src ?? "").trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(["'`])(.*)\1$/s.test(s)) return s.slice(1, -1);
  if (s === "true") return true; if (s === "false") return false; if (s === "null") return null;
  if (/^\[.*\]$/s.test(s)) { try { return JSON.parse(s.replace(/'/g, '"')); } catch { return undefined; } }
  const re = /^\/(.+)\/[gimsuy]*$/.exec(s);
  return re ? re[1] : undefined;
}

/** A path in JS syntax (.a.b[0]) -> our JSON path (a.b[0]). */
const toPath = (js) => js.replace(/^\./, "").replace(/\?\./g, ".").replace(/\["([^"]+)"\]|\['([^']+)'\]/g, (_, a, b) => `["${a ?? b}"]`);

/** Turns an access expression into { kind, ... } or null. `vars` are names bound to pm.response.json(). */
function accessor(expr, vars) {
  const e = expr.trim().replace(/;$/, "");
  if (e === "pm.response.code") return { type: "status" };
  if (e === "pm.response.responseTime") return { type: "time" };
  if (/^pm\.response\.text\(\)$/.test(e)) return { type: "body" };
  let m = /^pm\.response\.headers\.get\(\s*(["'])(.+?)\1\s*\)$/.exec(e);
  if (m) return { type: "header", name: m[2] };
  m = /^pm\.response\.json\(\)((?:\.|\[|\?\.).*)?$/.exec(e);
  if (m) return { type: "json", path: toPath(m[1] || "") };
  for (const v of vars) { if (e === v) return { type: "json", path: "" }; if (e.startsWith(v) && /^[.[?]/.test(e.slice(v.length))) return { type: "json", path: toPath(e.slice(v.length)) }; }
  return null;
}

/** pm.expect(<actual>)<chain>(<args>) -> a test, or null. */
function convertExpect(line, vars) {
  const start = line.indexOf("pm.expect(");
  if (start < 0) return null;
  const arg = balanced(line, start + "pm.expect".length);
  if (!arg) return null;
  const actual = accessor(arg.inner, vars);
  if (!actual) return null;
  const rest = line.slice(arg.end).replace(/;?\s*$/, "");
  const m = /^\.([\w.]+?)(?:\(([\s\S]*)\))?$/.exec(rest);
  if (!m) return null;
  const words = m[1].split(".").filter((w) => !CHAIN_NOISE.has(w));
  const negated = words[0] === "not"; if (negated) words.shift();
  const key = words.join(".");
  const args = m[2];
  let test = { type: actual.type, ...(actual.path !== undefined ? { path: actual.path } : {}), ...(actual.name ? { name: undefined } : {}) };
  if (actual.type === "header") test = { type: "header", name: actual.name };

  if (key === "exist" || key === "ok" || key === "undefined" || key === "null") {
    const wantExists = key === "exist" || key === "ok" ? !negated : negated;
    return { ...test, op: wantExists ? "exists" : "not_exists" };
  }
  if (key === "have.property" && actual.type === "json") {
    const [name, value] = splitArgs(args || "");
    const prop = literal(name); if (typeof prop !== "string") return null;
    const path = actual.path ? `${actual.path}.${prop}` : prop;
    return value === undefined ? { type: "json", path, op: negated ? "not_exists" : "exists" } : (literal(value) === undefined ? null : { type: "json", path, op: negated ? "not_equals" : "equals", value: literal(value) });
  }
  if ((key === "have.lengthOf" || key === "have.length" || key === "lengthOf") && actual.type === "json") {
    const n = literal(args); return n === undefined ? null : { type: "json", path: actual.path ? `${actual.path}.length` : "length", op: negated ? "not_equals" : "equals", value: n };
  }
  const op = OPS[key];
  if (!op) return null;
  const value = literal(args);
  if (value === undefined) return null;
  if (negated && op !== "equals" && op !== "contains") return null;
  return { ...test, op: negated ? (op === "equals" ? "not_equals" : null) : op, value };
}
/** Splits "a, b" at the top-level comma. */
function splitArgs(src) { const i = src.indexOf(","); return i < 0 ? [src.trim()] : [src.slice(0, i).trim(), src.slice(i + 1).trim()]; }

/** pm.response.to.have.status(200) and friends. */
function convertResponseAssert(line) {
  let m = /^pm\.response\.to\.have\.status\(\s*(\d{3})\s*\)/.exec(line);
  if (m) return { type: "status", op: "equals", value: Number(m[1]) };
  if (/^pm\.response\.to\.be\.(ok|success)\b/.test(line)) return { type: "status", op: "equals", value: "2xx" };
  m = /^pm\.response\.to\.have\.header\(\s*(["'])(.+?)\1\s*\)/.exec(line);
  if (m) return { type: "header", name: m[2], op: "exists" };
  m = /^pm\.response\.to\.have\.jsonBody\(\s*(["'])(.+?)\1\s*\)/.exec(line);
  if (m) return { type: "json", path: toPath(m[2]), op: "exists" };
  return null;
}

/** pm.environment.set("name", <expr>) -> { var, from } */
function convertSet(line, vars) {
  const m = /^pm\.(?:environment|collectionVariables|globals|variables)\.set\(\s*(["'])(.+?)\1\s*,\s*([\s\S]+)\)\s*;?$/.exec(line);
  if (!m) return null;
  const a = accessor(m[3], vars);
  if (!a || (a.type !== "json" && a.type !== "header")) return null;
  return { var: m[2], from: a.type === "header" ? `header:${a.name.toLowerCase()}` : a.path };
}

/**
 * @param {string[]} lines  the script's lines (Postman's script.exec)
 * @returns {{tests: object[], extract: object[], ignored: string[]}}
 */
export function convertScript(lines = []) {
  const tests = [], extract = [], ignored = [], vars = new Set();
  let testName = "";
  for (const raw of lines) {
    let line = String(raw).trim();
    if (STRUCTURE.test(line)) continue;
    let m = /^(?:const|let|var)?\s*(\w+)\s*=\s*pm\.response\.json\(\)\s*;?$/.exec(line);
    if (m) { vars.add(m[1]); continue; }
    // pm.test("name", function () {   /   pm.test("name", () => {   (possibly with the body on the same line)
    m = /^pm\.test\(\s*(["'`])(.*?)\1\s*,\s*(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{?\s*([\s\S]*)$/.exec(line);
    if (m) { testName = m[2]; line = m[3].replace(/\}?\s*\)\s*;?\s*$/, "").trim(); if (!line) continue; }
    const t = convertResponseAssert(line) || convertExpect(line, vars);
    // (a header test already uses `name` for the header, so only the other kinds take the pm.test title)
    if (t && t.op !== null) { tests.push({ ...t, ...(testName && t.type !== "header" ? { name: testName } : {}) }); continue; }
    const s = convertSet(line, vars);
    if (s) { extract.push(s); continue; }
    ignored.push(line.slice(0, 120));
  }
  return { tests, extract, ignored };
}
