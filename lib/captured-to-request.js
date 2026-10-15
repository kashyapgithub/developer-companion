/**
 * captured-to-request.js — turns a request recorded from the browser (see agent-tools/network-store.js)
 * into a saved API-client request. Pure, so it is easy to test.
 *
 * Secrets were masked as "[REDACTED]" when the traffic was recorded, so they are never copied:
 *   - an Authorization header becomes bearer/basic auth with a {{token}} / {{password}} placeholder
 *   - other masked headers are dropped
 *   - masked values inside a JSON body stay as "[REDACTED]" so you can see what must be filled in
 */

import { REDACTED } from "./redact.js";

/** Headers the browser adds on its own; they only add noise to a hand-made request. */
const BROWSER_NOISE = /^(host|connection|content-length|accept-encoding|accept-language|user-agent|origin|referer|cookie|sec-.*|upgrade-insecure-requests|priority|:.*)$/i;

/** Splits "https://x.com/a?b=1&c=2" into the URL without query + param rows. */
export function splitUrl(raw) {
  try {
    const u = new URL(raw);
    const params = [...u.searchParams].map(([key, value]) => ({ key, value, enabled: true }));
    return { url: u.origin + u.pathname, params };
  } catch { return { url: raw, params: [] }; }
}

/** Auth block + remaining headers from the recorded headers. */
export function authAndHeaders(recorded = {}) {
  let auth = { type: "none" };
  const headers = [];
  for (const [name, value] of Object.entries(recorded)) {
    if (/^authorization$/i.test(name)) {
      auth = /^basic/i.test(String(value)) ? { type: "basic", username: "{{username}}", password: "{{password}}" } : { type: "bearer", token: "{{token}}" };
    } else if (!BROWSER_NOISE.test(name) && value !== REDACTED) headers.push({ key: name, value: String(value), enabled: true });
  }
  return { auth, headers };
}

/** Body block guessed from the recorded body text and content type. */
export function bodyFrom(text, headers = {}) {
  if (!text) return { mode: "none" };
  const type = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] || "";
  if (/json/i.test(type) || /^\s*[{[]/.test(text)) return { mode: "json", content: text };
  if (/x-www-form-urlencoded/i.test(type)) {
    return { mode: "form", form: [...new URLSearchParams(text)].map(([key, value]) => ({ key, value, enabled: true })) };
  }
  return { mode: "text", content: text };
}

/** One recorded entry -> a saved-request draft (no id; the server adds one). */
export function capturedToRequest(entry) {
  const { url, params } = splitUrl(entry.url);
  const { auth, headers } = authAndHeaders(entry.requestHeaders);
  const path = (() => { try { return new URL(entry.url).pathname; } catch { return entry.url; } })();
  return { name: `${entry.method} ${path}`.slice(0, 120), folder: "", method: entry.method, url, params, headers, auth, body: bodyFrom(entry.requestBody, entry.requestHeaders), tests: [], extract: [] };
}

/** Only calls your app made to APIs (fetch/XHR), not images, scripts and fonts. */
export const isApiCall = (entry) => ["Fetch", "XHR"].includes(entry.type);
