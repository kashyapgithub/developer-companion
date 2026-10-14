/**
 * build-request.js — turns a saved request (what you edit in the UI) into the exact
 * HTTP call to make: variables filled in, query params added, auth and body applied.
 * Pure: nothing is sent here.
 *
 * A saved request looks like:
 *   { name, method, url, params:[{key,value,enabled}], headers:[...],
 *     auth:{type:"none|bearer|basic|apikey", token, username, password, key, value, in:"header|query"},
 *     body:{mode:"none|json|text|form", content, form:[{key,value,enabled}]},
 *     tests:[...], extract:[{var, from}] }
 */

import { substitute, rowsToObject } from "./vars.js";

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

/** Header lookup/override that ignores case. */
function setHeader(headers, name, value, { onlyIfMissing = false } = {}) {
  const existing = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (existing && onlyIfMissing) return;
  if (existing) delete headers[existing];
  headers[name] = value;
}

/** "localhost:3000/x" -> "http://localhost:3000/x" (people type it without the scheme). */
export function withScheme(url) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`;
}

/**
 * @param {object} req saved request
 * @param {Record<string,string>} vars variables in scope
 * @returns {{method:string, url:string, headers:Record<string,string>, body:string|undefined, missing:string[]}}
 */
export function buildRequest(req, vars = {}) {
  const missing = [];
  const fill = (text) => { const r = substitute(text, vars); for (const m of r.missing) if (!missing.includes(m)) missing.push(m); return r.text; };
  const fillRows = (rows) => rowsToObject((rows || []).map((r) => ({ ...r, key: fill(r.key), value: fill(r.value) })));

  const method = String(req.method || "GET").toUpperCase();
  const url = new URL(withScheme(fill(req.url || "").trim()));
  for (const [k, v] of Object.entries(fillRows(req.params))) url.searchParams.append(k, v);

  const headers = fillRows(req.headers);
  const auth = req.auth || { type: "none" };
  if (auth.type === "bearer" && auth.token) setHeader(headers, "Authorization", `Bearer ${fill(auth.token)}`);
  if (auth.type === "basic") setHeader(headers, "Authorization", `Basic ${Buffer.from(`${fill(auth.username)}:${fill(auth.password)}`).toString("base64")}`);
  if (auth.type === "apikey" && auth.key) {
    if (auth.in === "query") url.searchParams.set(fill(auth.key), fill(auth.value));
    else setHeader(headers, fill(auth.key), fill(auth.value));
  }

  let body;
  const b = req.body || { mode: "none" };
  if (!METHODS_WITHOUT_BODY.has(method)) {
    if (b.mode === "json") { body = fill(b.content ?? ""); setHeader(headers, "Content-Type", "application/json", { onlyIfMissing: true }); }
    else if (b.mode === "text") { body = fill(b.content ?? ""); setHeader(headers, "Content-Type", "text/plain", { onlyIfMissing: true }); }
    else if (b.mode === "form") { body = new URLSearchParams(fillRows(b.form)).toString(); setHeader(headers, "Content-Type", "application/x-www-form-urlencoded", { onlyIfMissing: true }); }
  }
  return { method, url: url.toString(), headers, body: body === "" ? undefined : body, missing };
}
