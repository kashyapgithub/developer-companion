/**
 * vars.js — {{variable}} substitution for the API client.
 *
 * Variables come from the active environment (and values extracted from earlier
 * responses). A few dynamic ones are built in: {{$timestamp}}, {{$isoTimestamp}},
 * {{$guid}}, {{$randomInt}}. Unknown names are left as they are and reported, so
 * a typo shows up as "missing variable" instead of a silent blank.
 */

import crypto from "node:crypto";

const PLACEHOLDER = /\{\{\s*([\w$.\-]+)\s*\}\}/g;

/** Built-in dynamic values, evaluated fresh each time. */
const DYNAMIC = {
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $guid: () => crypto.randomUUID(),
  $randomInt: () => String(Math.floor(Math.random() * 1000)),
};

/** Replaces every {{name}} in `text`. Returns the new text and the names that had no value. */
export function substitute(text, vars = {}) {
  const missing = [];
  const out = String(text ?? "").replace(PLACEHOLDER, (whole, name) => {
    if (name in DYNAMIC) return DYNAMIC[name]();
    if (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== undefined && vars[name] !== null) return String(vars[name]);
    if (!missing.includes(name)) missing.push(name);
    return whole;
  });
  return { text: out, missing };
}

/** Just the text (when you don't care about missing names). */
export const fill = (text, vars) => substitute(text, vars).text;

/** All variable names a piece of text refers to (dynamic ones excluded). */
export function namesIn(text) {
  const names = new Set();
  for (const m of String(text ?? "").matchAll(PLACEHOLDER)) if (!(m[1] in DYNAMIC)) names.add(m[1]);
  return [...names];
}

/** Turns [{key,value,enabled}] rows into a plain {key: value} object, skipping disabled/empty-key rows. */
export function rowsToObject(rows = []) {
  const o = {};
  for (const r of rows) if (r && r.enabled !== false && String(r.key ?? "").trim()) o[String(r.key).trim()] = r.value ?? "";
  return o;
}
