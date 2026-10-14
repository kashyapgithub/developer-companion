/**
 * state-format.js — turns raw page-state reads into a safe, size-capped report.
 *
 * Pure functions (no browser APIs) so they are easy to test. Rules:
 *  - values under sensitive-looking keys, and token-shaped values, are masked;
 *  - JSON strings are parsed so the agent sees structure, not escaped text;
 *  - long values are cut and marked, and the whole report is capped.
 */

import { redactDeep, REDACTED } from "../redact.js";

const SENSITIVE_KEY = /token|auth|secret|passw|pwd|session|cookie|credential|api[-_]?key|private|bearer|jwt/i;
const MAX_VALUE_CHARS = 1500;
const MAX_ENTRIES = 60;

/** Cuts long text and says how much was dropped. */
export function clip(text, max = MAX_VALUE_CHARS) {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max)}… [+${s.length - max} chars]` : s;
}

/** One stored value: parse JSON when possible, mask secrets, cap the size. */
export function shapeValue(key, raw) {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  let value = raw;
  try { value = JSON.parse(raw); } catch { /* plain string */ }
  value = redactDeep(value);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_VALUE_CHARS ? clip(text) : value;
}

/** A key/value map (localStorage or sessionStorage) -> shaped map with an entry cap. */
export function shapeStorage(map = {}) {
  const keys = Object.keys(map);
  const out = {};
  for (const k of keys.slice(0, MAX_ENTRIES)) out[k] = shapeValue(k, map[k]);
  if (keys.length > MAX_ENTRIES) out["…"] = `${keys.length - MAX_ENTRIES} more keys not shown`;
  return out;
}

/** Framework globals (e.g. __NEXT_DATA__): masked and size-capped. */
export function shapeGlobals(globals = {}) {
  const out = {};
  for (const [name, value] of Object.entries(globals)) {
    const safe = redactDeep(value);
    const text = JSON.stringify(safe) ?? "";
    out[name] = text.length > 4000 ? { truncated: clip(text, 4000) } : safe;
  }
  return out;
}

/** Full raw read -> final report. Cookie VALUES are never included, only names. */
export function buildPageState(raw) {
  return {
    page: raw.page,
    local_storage: shapeStorage(raw.localStorage),
    session_storage: shapeStorage(raw.sessionStorage),
    cookie_names: (raw.cookieNames || []).slice(0, MAX_ENTRIES),
    framework_state: shapeGlobals(raw.globals),
    note: "Cookie values and anything that looks like a secret are never included. HttpOnly cookies are invisible to pages.",
  };
}
