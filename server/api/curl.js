/**
 * curl.js — convert between a curl command and a saved request.
 *
 * parseCurl:  "curl -X POST https://x/api -H 'A: b' -d '{...}'"  ->  saved request
 * toCurl:     a built request (from build-request.js)            ->  curl command
 * Handles the flags people actually paste from browser DevTools: -X, -H, -d/--data*, -u, -b, --url, -G.
 */

/** Splits a shell-ish command into words, honouring '…' and "…" quotes and backslash line breaks. */
export function shellWords(input) {
  const text = String(input).replace(/\\\r?\n/g, " ").trim();
  const words = []; let cur = "", quote = null, has = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && /["\\$`]/.test(text[i + 1] || "")) cur += text[++i];
      else cur += c;
    } else if (c === "'" || c === '"') { quote = c; has = true; }
    else if (c === "\\" && i + 1 < text.length) { cur += text[++i]; has = true; }   // \x outside quotes means x (this is how '\'' appears)
    else if (/\s/.test(c)) { if (has || cur) { words.push(cur); cur = ""; has = false; } }
    else if (c === "$" && text[i + 1] === "'") { quote = "'"; has = true; i++; }   // $'…' as shells print it
    else cur += c;
  }
  if (has || cur) words.push(cur);
  return words;
}

const DATA_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode"]);

/** @returns {object} a saved request ({name, method, url, headers, body, auth, params:[], tests:[], extract:[]}) */
export function parseCurl(command) {
  const words = shellWords(command);
  if (words[0] === "curl") words.shift();
  let method = "", url = "", getMode = false;
  const headers = [], data = [];
  let auth = { type: "none" };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "-X" || w === "--request") method = (words[++i] || "").toUpperCase();
    else if (w === "-H" || w === "--header") {
      const h = words[++i] || ""; const at = h.indexOf(":");
      if (at > 0) headers.push({ key: h.slice(0, at).trim(), value: h.slice(at + 1).trim(), enabled: true });
    } else if (DATA_FLAGS.has(w)) data.push(words[++i] ?? "");
    else if (w === "-u" || w === "--user") { const [username, ...rest] = (words[++i] || "").split(":"); auth = { type: "basic", username, password: rest.join(":") }; }
    else if (w === "-b" || w === "--cookie") headers.push({ key: "Cookie", value: words[++i] || "", enabled: true });
    else if (w === "-G" || w === "--get") getMode = true;
    else if (w === "--url") url = words[++i] || "";
    else if (w.startsWith("-")) { /* flags like -s, -k, -L, --compressed: no effect on the saved request */ }
    else if (!url) url = w;
  }
  if (!url) throw new Error("No URL found in that curl command.");
  const bodyText = data.join("&");
  const ct = headers.find((h) => h.key.toLowerCase() === "content-type")?.value || "";
  const mode = !bodyText ? "none" : /json/i.test(ct) || /^\s*[{[]/.test(bodyText) ? "json" : "text";   // form-encoded stays text; its Content-Type header is kept
  const bearer = headers.findIndex((h) => h.key.toLowerCase() === "authorization" && /^bearer\s+/i.test(h.value));
  if (bearer >= 0) { auth = { type: "bearer", token: headers[bearer].value.replace(/^bearer\s+/i, "") }; headers.splice(bearer, 1); }
  const effectiveMethod = method || (getMode ? "GET" : bodyText ? "POST" : "GET");
  let params = [];
  if (getMode && bodyText) { params = Array.from(new URLSearchParams(bodyText), ([key, value]) => ({ key, value, enabled: true })); }
  return {
    name: `${effectiveMethod} ${safePath(url)}`, method: effectiveMethod, url, params, headers, auth,
    body: getMode ? { mode: "none" } : { mode, content: bodyText }, tests: [], extract: [],
  };
}

function safePath(url) { try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`).pathname || "/"; } catch { return url; } }

/** Single-quote a value for a POSIX shell. */
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** @param {{method:string, url:string, headers:Record<string,string>, body?:string}} built */
export function toCurl(built) {
  const parts = ["curl", "-X", built.method, quote(built.url)];
  for (const [k, v] of Object.entries(built.headers || {})) parts.push("-H", quote(`${k}: ${v}`));
  if (built.body) parts.push("--data-raw", quote(built.body));
  return parts.join(" ");
}
