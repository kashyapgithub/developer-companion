/**
 * postman.js — import Postman v2.1 collections and environments (so you can leave Postman).
 *
 * What comes across: folders (flattened into a "Folder / Sub" label), method, URL, query params,
 * headers, bodies (raw json/text, urlencoded), bearer/basic/api-key auth, and {{variables}}.
 * What can't: Postman scripts (pre-request and test scripts are JavaScript). They are counted
 * and reported so nothing disappears silently; declarative Tests can be re-added in the UI.
 */

import crypto from "node:crypto";

const newId = () => crypto.randomBytes(6).toString("hex");

/** Postman rows ({key,value,disabled}) -> our rows. */
const rows = (list = []) => list.filter((r) => r && r.key !== undefined).map((r) => ({ key: String(r.key), value: String(r.value ?? ""), enabled: !r.disabled }));

/** Postman auth block -> our auth. */
function convertAuth(auth) {
  if (!auth || auth.type === "noauth") return { type: "none" };
  const get = (name) => (auth[auth.type] || []).find((x) => x.key === name)?.value ?? "";
  if (auth.type === "bearer") return { type: "bearer", token: String(get("token")) };
  if (auth.type === "basic") return { type: "basic", username: String(get("username")), password: String(get("password")) };
  if (auth.type === "apikey") return { type: "apikey", key: String(get("key")), value: String(get("value")), in: get("in") === "query" ? "query" : "header" };
  return { type: "none" };
}

/** Postman body -> our body. */
function convertBody(body) {
  if (!body) return { mode: "none" };
  if (body.mode === "raw") return { mode: body.options?.raw?.language === "json" || /^\s*[{[]/.test(body.raw || "") ? "json" : "text", content: body.raw || "" };
  if (body.mode === "urlencoded") return { mode: "form", form: rows(body.urlencoded) };
  return { mode: "none", unsupported: body.mode };    // form-data / file / graphql: noted, not converted
}

/** The URL as one string, plus the query rows (kept separate so they stay editable). */
function convertUrl(url) {
  if (typeof url === "string") return { url, params: [] };
  const raw = url?.raw || "";
  const query = rows(url?.query);
  return { url: query.length ? raw.split("?")[0] : raw, params: query };
}

/** Walks the item tree, producing flat requests and counting what couldn't be converted. */
function walk(items, folder, out, notes) {
  for (const item of items || []) {
    if (item.item) { walk(item.item, folder ? `${folder} / ${item.name}` : item.name, out, notes); continue; }
    if (!item.request) continue;
    const r = item.request;
    const { url, params } = convertUrl(r.url);
    const body = convertBody(r.body);
    if (body.unsupported) notes.unsupportedBodies++;
    if ((item.event || []).some((e) => e.script?.exec?.some((l) => String(l).trim()))) notes.scripts++;
    out.push({
      id: newId(), name: item.name || `${r.method} ${url}`, folder: folder || "", method: String(r.method || "GET").toUpperCase(), url, params,
      headers: rows(r.header), auth: convertAuth(r.auth), body: body.unsupported ? { mode: "none" } : body, tests: [], extract: [],
    });
  }
}

/** @returns {{collection:{id,name,variables,requests}, notes:{requests:number, scripts:number, unsupportedBodies:number}}} */
export function importPostmanCollection(json) {
  if (!json?.info || !Array.isArray(json.item)) throw new Error("That doesn't look like a Postman collection (v2.1 JSON export).");
  const notes = { scripts: 0, unsupportedBodies: 0 };
  const requests = [];
  walk(json.item, "", requests, notes);
  const variables = Object.fromEntries((json.variable || []).filter((v) => v.key).map((v) => [v.key, String(v.value ?? "")]));
  return { collection: { id: newId(), name: json.info.name || "Imported collection", variables, requests }, notes: { requests: requests.length, ...notes } };
}

/** @returns {{id,name,variables}} */
export function importPostmanEnvironment(json) {
  if (!Array.isArray(json?.values)) throw new Error("That doesn't look like a Postman environment export.");
  const variables = Object.fromEntries(json.values.filter((v) => v.key && v.enabled !== false).map((v) => [v.key, String(v.value ?? "")]));
  return { id: newId(), name: json.name || "Imported environment", variables };
}

/** Tells which kind of Postman file this is: "collection", "environment" or null. */
export function detectPostmanKind(json) {
  if (json?.info && Array.isArray(json.item)) return "collection";
  if (Array.isArray(json?.values)) return "environment";
  return null;
}
