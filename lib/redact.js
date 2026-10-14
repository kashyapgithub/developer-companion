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

// ---- deep redaction for request/response bodies and headers -------------------------

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;
const JWT_IN_TEXT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g;

/** Header map with secrets masked (names are matched case-insensitively). */
export function redactHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) out[name] = SENSITIVE_HEADER.test(name) || SENSITIVE_KEY.test(name) ? REDACTED : value;
  return out;
}

/** Masks values under sensitive-looking keys at any depth (objects and arrays). */
export function redactDeep(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") {
    return typeof value === "string" && SECRET_VALUE.test(value.trim()) ? REDACTED : value;
  }
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactDeep(v, depth + 1);
  return out;
}

/**
 * Redacts a request/response body given as text: JSON is masked by key,
 * form-encoded bodies by parameter name, anything else only for token-shaped strings.
 */
export function redactBodyText(text) {
  if (typeof text !== "string" || !text) return text;
  const trimmed = text.trim();
  if (/^[\[{]/.test(trimmed)) {
    try { return JSON.stringify(redactDeep(JSON.parse(trimmed))); } catch { /* not JSON after all */ }
  }
  if (/^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(trimmed)) {
    return trimmed.split("&").map((pair) => {
      const [k, ...rest] = pair.split("=");
      return SENSITIVE_KEY.test(decodeURIComponent(k)) ? `${k}=${REDACTED}` : `${k}=${rest.join("=")}`;
    }).join("&");
  }
  return text.replace(JWT_IN_TEXT, REDACTED);
}
