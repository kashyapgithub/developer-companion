/**
 * inspiration.js
 * --------------------------------------------------------------------------
 * The inspiration library: screenshots from around the web, sorted into
 * folders, kept for later ("make it feel like these").
 *
 * On disk (inside the store dir, so it survives reinstalling the extension):
 *   inspiration/index.json     { folders: [...], items: [...] }
 *   inspiration/<id>.png|jpg   one image file per item
 *
 * Items with folder "" live in "Unsorted". Everything here is plain
 * synchronous file work; the HTTP routes and the MCP tool just call it.
 * -------------------------------------------------------------------------- */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getStoreDir } from "./config.js";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_NAME = 80;
const MAX_NOTE = 2000;
const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
export const UNSORTED = "";

// ---- paths + index ----------------------------------------------------------------

const rootDir = () => path.join(getStoreDir(), "inspiration");
const indexPath = () => path.join(rootDir(), "index.json");
const newId = () => crypto.randomBytes(6).toString("hex");
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

/** Reads the index; a missing or corrupt file means an empty library. */
function loadIndex() {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(), "utf8"));
    return { folders: Array.isArray(raw.folders) ? raw.folders : [], items: Array.isArray(raw.items) ? raw.items : [] };
  } catch { return { folders: [], items: [] }; }
}

/** Writes the index atomically (temp file + rename) so a crash can't leave half a file. */
function saveIndex(index) {
  fs.mkdirSync(rootDir(), { recursive: true });
  const tmp = indexPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, indexPath());
}

/** Applies `change` to a fresh copy of the index, saves it, and returns whatever `change` returned. */
function mutate(change) {
  const index = loadIndex();
  const result = change(index);
  saveIndex(index);
  return result;
}

// ---- folders ----------------------------------------------------------------------

export function createFolder(name) {
  const clean = clip(name, MAX_NAME);
  if (!clean) throw new Error("Folder name is required");
  return mutate((index) => {
    const existing = index.folders.find((f) => f.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing; // same name = same folder
    const folder = { id: newId(), name: clean, createdAt: new Date().toISOString() };
    index.folders.push(folder);
    return folder;
  });
}

export function renameFolder(id, name) {
  const clean = clip(name, MAX_NAME);
  if (!clean) throw new Error("Folder name is required");
  return mutate((index) => {
    const folder = index.folders.find((f) => f.id === id);
    if (!folder) throw new Error("No such folder");
    folder.name = clean;
    return folder;
  });
}

/** Deleting a folder never deletes images: its items move back to Unsorted. */
export function deleteFolder(id) {
  return mutate((index) => {
    index.folders = index.folders.filter((f) => f.id !== id);
    for (const item of index.items) if (item.folder === id) item.folder = UNSORTED;
    return true;
  });
}

// ---- items ------------------------------------------------------------------------

/** Parses "data:image/png;base64,…" into { mime, buffer }, or throws a readable error. */
function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(dataUrl || "");
  if (!m) throw new Error("Only PNG, JPEG or WebP images can be saved");
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Image is too large (15MB max)");
  return { mime: m[1], buffer };
}

/** True if `id` is a real folder (or Unsorted). */
const folderExists = (index, id) => id === UNSORTED || index.folders.some((f) => f.id === id);

export function addItem({ dataUrl, title, url, note, folder = UNSORTED }) {
  const { mime, buffer } = parseDataUrl(dataUrl);
  return mutate((index) => {
    const id = newId();
    const file = `${id}.${EXT_BY_MIME[mime]}`;
    fs.mkdirSync(rootDir(), { recursive: true });
    fs.writeFileSync(path.join(rootDir(), file), buffer);
    const item = {
      id, file, folder: folderExists(index, folder) ? folder : UNSORTED,
      title: clip(title, MAX_NAME) || "Untitled", url: clip(url, 500), note: clip(note, MAX_NOTE),
      bytes: buffer.length, createdAt: new Date().toISOString(),
    };
    index.items.unshift(item); // newest first
    return item;
  });
}

/** Changes folder, title and/or note; anything not provided stays as it was. */
export function updateItem(id, { folder, title, note }) {
  return mutate((index) => {
    const item = index.items.find((i) => i.id === id);
    if (!item) throw new Error("No such image");
    if (folder !== undefined) { if (!folderExists(index, folder)) throw new Error("No such folder"); item.folder = folder; }
    if (title !== undefined) item.title = clip(title, MAX_NAME) || item.title;
    if (note !== undefined) item.note = clip(note, MAX_NOTE);
    return item;
  });
}

export function deleteItem(id) {
  return mutate((index) => {
    const item = index.items.find((i) => i.id === id);
    if (!item) return false;
    try { fs.rmSync(path.join(rootDir(), path.basename(item.file)), { force: true }); } catch { /* already gone */ }
    index.items = index.items.filter((i) => i.id !== id);
    return true;
  });
}

// ---- reading ----------------------------------------------------------------------

/** Everything the panel needs: folders (with counts) and items. */
export function listLibrary() {
  const { folders, items } = loadIndex();
  const count = (id) => items.filter((i) => i.folder === id).length;
  return {
    folders: folders.map((f) => ({ ...f, count: count(f.id) })),
    unsorted: count(UNSORTED),
    items,
  };
}

/** The image bytes + type for one item, or null. */
export function readItemImage(id) {
  const item = loadIndex().items.find((i) => i.id === id);
  if (!item) return null;
  try {
    const file = path.basename(item.file);
    return { buffer: fs.readFileSync(path.join(rootDir(), file)), mime: MIME_BY_EXT[file.split(".").pop()] || "image/png" };
  } catch { return null; }
}

/**
 * Finds items for the agent. `folder` matches a folder name (case-insensitive) or id;
 * `query` matches title, note and URL. Returns metadata only; the caller attaches images.
 */
export function searchItems({ folder, query, limit = 12 } = {}) {
  const { folders, items } = loadIndex();
  let pool = items;
  if (folder) {
    const want = String(folder).toLowerCase();
    const match = folders.find((f) => f.id === folder || f.name.toLowerCase() === want);
    pool = match ? items.filter((i) => i.folder === match.id) : (want === "unsorted" ? items.filter((i) => i.folder === UNSORTED) : []);
  }
  if (query) {
    const q = String(query).toLowerCase();
    pool = pool.filter((i) => `${i.title} ${i.note} ${i.url}`.toLowerCase().includes(q));
  }
  const nameOf = (id) => folders.find((f) => f.id === id)?.name || "Unsorted";
  return { folders: folders.map((f) => f.name), items: pool.slice(0, limit).map((i) => ({ ...i, folderName: nameOf(i.folder) })) };
}
