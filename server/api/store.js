/**
 * store.js — where the API client keeps its collections, environments and history.
 *
 * Plain files inside the store dir (so the extension window and the agent see the same thing):
 *   api/state.json     { collections:[{id,name,variables,requests:[…]}], environments:[{id,name,variables}], activeEnvironmentId }
 *   api/history.json   the last runs (summaries only, newest first)
 * Every write goes through mutate(): read -> change -> atomic save.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getStoreDir } from "../config.js";

const HISTORY_MAX = 50;
const newId = () => crypto.randomBytes(6).toString("hex");
const dir = () => path.join(getStoreDir(), "api");
const statePath = () => path.join(dir(), "state.json");
const historyPath = () => path.join(dir(), "history.json");

const EMPTY = () => ({ collections: [], environments: [], activeEnvironmentId: "" });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** The whole state (missing or corrupt file = empty). */
export function getState() {
  const s = readJson(statePath(), EMPTY());
  return { collections: s.collections || [], environments: s.environments || [], activeEnvironmentId: s.activeEnvironmentId || "" };
}

/** Applies `change` to a fresh copy of the state, saves it, returns what `change` returned. */
function mutate(change) {
  const state = getState();
  const result = change(state);
  writeJson(statePath(), state);
  return result;
}

const findCollection = (state, id) => { const c = state.collections.find((x) => x.id === id); if (!c) throw new Error("No such collection"); return c; };

// ---- collections ------------------------------------------------------------------

export function createCollection(name) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) throw new Error("Collection name is required");
  return mutate((s) => { const c = { id: newId(), name: clean, variables: {}, requests: [] }; s.collections.push(c); return c; });
}
export function renameCollection(id, name) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) throw new Error("Collection name is required");
  return mutate((s) => { const c = findCollection(s, id); c.name = clean; return c; });
}
export function deleteCollection(id) {
  return mutate((s) => { s.collections = s.collections.filter((c) => c.id !== id); return true; });
}
/** Adds a ready-made collection (from a Postman import); gives it a unique name if needed. */
export function addCollection(collection) {
  return mutate((s) => {
    let name = collection.name, n = 2;
    while (s.collections.some((c) => c.name === name)) name = `${collection.name} (${n++})`;
    const c = { ...collection, name }; s.collections.push(c); return c;
  });
}

// ---- requests ----------------------------------------------------------------------

/** Keeps only the fields a saved request is allowed to have (and gives it an id). */
export function cleanRequest(r) {
  return {
    id: r.id || newId(), name: String(r.name || "").slice(0, 120) || `${r.method || "GET"} ${r.url || ""}`.trim(), folder: String(r.folder || "").slice(0, 120),
    method: String(r.method || "GET").toUpperCase(), url: String(r.url || ""),
    params: Array.isArray(r.params) ? r.params : [], headers: Array.isArray(r.headers) ? r.headers : [],
    auth: r.auth && typeof r.auth === "object" ? r.auth : { type: "none" },
    body: r.body && typeof r.body === "object" ? r.body : { mode: "none" },
    tests: Array.isArray(r.tests) ? r.tests : [], extract: Array.isArray(r.extract) ? r.extract : [],
  };
}

/** Adds or replaces a request (matched by id) in a collection. */
export function saveRequest(collectionId, request) {
  return mutate((s) => {
    const c = findCollection(s, collectionId);
    const clean = cleanRequest(request);
    const i = c.requests.findIndex((x) => x.id === clean.id);
    if (i >= 0) c.requests[i] = clean; else c.requests.push(clean);
    return clean;
  });
}
export function deleteRequest(collectionId, requestId) {
  return mutate((s) => { const c = findCollection(s, collectionId); c.requests = c.requests.filter((r) => r.id !== requestId); return true; });
}
/** A request by id from any collection (or by "Collection name/request name"). */
export function findRequest(ref) {
  const { collections } = getState();
  for (const c of collections) for (const r of c.requests) if (r.id === ref || `${c.name}/${r.name}` === ref) return { collection: c, request: r };
  return null;
}

// ---- environments --------------------------------------------------------------------

export function saveEnvironment(env) {
  return mutate((s) => {
    const clean = { id: env.id || newId(), name: String(env.name || "").trim().slice(0, 80) || "Environment", variables: sanitizeVars(env.variables) };
    const i = s.environments.findIndex((e) => e.id === clean.id);
    if (i >= 0) s.environments[i] = clean; else s.environments.push(clean);
    if (!s.activeEnvironmentId) s.activeEnvironmentId = clean.id;
    return clean;
  });
}
export function deleteEnvironment(id) {
  return mutate((s) => { s.environments = s.environments.filter((e) => e.id !== id); if (s.activeEnvironmentId === id) s.activeEnvironmentId = s.environments[0]?.id || ""; return true; });
}
export function setActiveEnvironment(id) {
  return mutate((s) => { if (id && !s.environments.some((e) => e.id === id)) throw new Error("No such environment"); s.activeEnvironmentId = id || ""; return id || ""; });
}
/** Merges values (e.g. a token pulled from a login response) into the active environment. */
export function mergeIntoActiveEnvironment(values) {
  if (!values || !Object.keys(values).length) return false;
  return mutate((s) => {
    let env = s.environments.find((e) => e.id === s.activeEnvironmentId);
    if (!env) { env = { id: newId(), name: "Default", variables: {} }; s.environments.push(env); s.activeEnvironmentId = env.id; }
    Object.assign(env.variables, sanitizeVars(values));
    return true;
  });
}

const sanitizeVars = (v) => Object.fromEntries(Object.entries(v || {}).filter(([k]) => k.trim()).map(([k, val]) => [k.trim(), String(val ?? "")]));

/** Variables in scope for a request: collection variables, then the active environment on top. */
export function variablesFor(collectionId, state = getState()) {
  const env = state.environments.find((e) => e.id === state.activeEnvironmentId);
  const col = state.collections.find((c) => c.id === collectionId);
  return { ...(col?.variables || {}), ...(env?.variables || {}) };
}

// ---- history ---------------------------------------------------------------------------

export const getHistory = () => readJson(historyPath(), []);
export function addHistory(entry) {
  const list = [{ at: new Date().toISOString(), ...entry }, ...getHistory()].slice(0, HISTORY_MAX);
  writeJson(historyPath(), list);
}
export const clearHistory = () => writeJson(historyPath(), []);
