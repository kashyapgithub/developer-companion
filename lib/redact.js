/**
 * redact.js — masks secrets before captured data leaves the browser.
 *
 * localStorage snapshots often hold auth tokens. Any key whose NAME looks
 * sensitive has its value replaced, and values that look like JWTs or
 * well-known API keys are masked even under innocent key names.
 */

const SENSITIVE_KEY = /token|auth|secret|passw|pwd|session|cookie|credential|api[-_]?key|private|bearer|jwt/i;
const SECRET_VALUE = /^(eyJ[\w-]+\.[\w-]+\.[\w-]+|gh[pousr]_\w{20,}|sk-[\w-]{20,}|AIza[\w-]{30,})$/;

export const REDACTED = "[REDACTED]";

/** @param {Record<string, unknown>} snapshot flat key/value map */
export function redactSnapshot(snapshot) {
  const out = {};
  for (const [key, value] of Object.entries(snapshot || {})) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const sensitive = SENSITIVE_KEY.test(key) || SECRET_VALUE.test((text || "").trim());
    out[key] = sensitive ? REDACTED : value;
  }
  return out;
}
