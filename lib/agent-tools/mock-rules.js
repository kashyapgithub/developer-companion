/**
 * mock-rules.js — the rule book for API mocks. Pure (no browser APIs), so it is easy to test.
 *
 * A rule says: "requests whose URL contains X (and optionally method M) get this fake
 * response instead of going to the network". Rules live per tab, in memory only.
 */

const MAX_RULES_PER_TAB = 20;
const MAX_DELAY_MS = 10000;
const MAX_BODY_BYTES = 200000;

/** tabId -> rule[] (newest first, so a newer rule wins over an older, broader one). */
const byTab = new Map();
let nextId = 1;

/** UTF-8 string -> base64 (works in service workers and Node). */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Checks a rule spec from the agent. Returns { rule } or { error }. */
export function validateSpec(spec = {}) {
  if (!spec.url_contains || typeof spec.url_contains !== "string") return { error: "url_contains is required (part of the URL to intercept)." };
  const status = spec.status === undefined ? 200 : Number(spec.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) return { error: "status must be a number from 100 to 599." };
  const isObject = spec.body !== undefined && typeof spec.body !== "string";
  const bodyText = spec.body === undefined ? "" : isObject ? JSON.stringify(spec.body) : spec.body;
  if (bodyText.length > MAX_BODY_BYTES) return { error: `body is too large (max ${MAX_BODY_BYTES} characters).` };
  return {
    rule: {
      url_contains: spec.url_contains,
      method: spec.method ? String(spec.method).toUpperCase() : null,
      status, bodyText,
      contentType: spec.content_type || (isObject || /^\s*[{[]/.test(bodyText) ? "application/json" : "text/plain"),
      headers: spec.headers && typeof spec.headers === "object" ? spec.headers : {},
      delayMs: Math.max(0, Math.min(Number(spec.delay_ms) || 0, MAX_DELAY_MS)),
      fail: !!spec.fail,
    },
  };
}

/** Adds a rule for a tab. Returns the stored rule (with id) or { error }. */
export function addRule(tabId, spec) {
  const checked = validateSpec(spec);
  if (checked.error) return checked;
  const list = byTab.get(tabId) || [];
  if (list.length >= MAX_RULES_PER_TAB) return { error: `Too many mocks on this tab (max ${MAX_RULES_PER_TAB}). Clear some first.` };
  const rule = { id: `mock-${nextId++}`, hits: 0, ...checked.rule };
  byTab.set(tabId, [rule, ...list]);
  return { rule };
}

/** The rules for a tab, newest first. */
export function listRules(tabId) { return byTab.get(tabId) || []; }

/** Removes one rule (by id) or all of a tab's rules. Returns how many were removed. */
export function clearRules(tabId, id) {
  const list = byTab.get(tabId) || [];
  const keep = id ? list.filter((r) => r.id !== id) : [];
  if (keep.length) byTab.set(tabId, keep); else byTab.delete(tabId);
  return list.length - keep.length;
}

/** First rule that matches a request, or null. Counts the hit. */
export function matchRule(tabId, url, method) {
  const rule = listRules(tabId).find((r) => url.includes(r.url_contains) && (!r.method || r.method === String(method).toUpperCase()));
  if (rule) rule.hits++;
  return rule || null;
}

/** Rule -> arguments for CDP Fetch.fulfillRequest. */
export function toFulfillParams(rule) {
  const headers = { "content-type": rule.contentType, "access-control-allow-origin": "*", "x-developer-companion-mock": rule.id, ...rule.headers };
  return {
    responseCode: rule.status,
    responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value: String(value) })),
    body: toBase64(rule.bodyText),
  };
}

/** Public view of a rule (no internals). */
export function describeRule(r) {
  return { id: r.id, url_contains: r.url_contains, method: r.method, status: r.status, fail: r.fail, delay_ms: r.delayMs, content_type: r.contentType, body_preview: r.bodyText.slice(0, 200), hits: r.hits };
}
