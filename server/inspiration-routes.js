/**
 * inspiration-routes.js — the HTTP side of the inspiration library.
 *
 *   GET    /inspiration                 folders + items
 *   GET    /inspiration/image/:id       the image itself
 *   POST   /inspiration/folders         { name }
 *   PATCH  /inspiration/folders/:id     { name }
 *   DELETE /inspiration/folders/:id     (images move to Unsorted)
 *   POST   /inspiration/items           { dataUrl, title, url, note, folder }
 *   PATCH  /inspiration/items/:id       { folder?, title?, note? }
 *   DELETE /inspiration/items/:id
 *
 * Called from server.js after the origin / access-code checks, so every route
 * here is already authorised. Returns true when it handled the request.
 */

import * as lib from "./inspiration.js";

/** Runs `fn`, answering 200 with its result or 400 with the error message. */
function reply(res, respondJson, fn) {
  try { respondJson(res, 200, { ok: true, ...fn() }); }
  catch (err) { respondJson(res, 400, { ok: false, error: err.message || String(err) }); }
}

export function handleInspiration(req, res, pathname, { readJsonBody, respondJson }) {
  if (pathname !== "/inspiration" && !pathname.startsWith("/inspiration/")) return false;
  const parts = pathname.split("/").filter(Boolean); // ["inspiration", kind?, id?]
  const [, kind, id] = parts;
  const body = (fn) => readJsonBody(req, res, (payload) => reply(res, respondJson, () => fn(payload)));

  if (req.method === "GET" && !kind) { reply(res, respondJson, () => lib.listLibrary()); return true; }

  if (req.method === "GET" && kind === "image" && id) {
    const img = lib.readItemImage(id);
    if (!img) { respondJson(res, 404, { ok: false, error: "No such image" }); return true; }
    res.writeHead(200, { "Content-Type": img.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.end(img.buffer);
    return true;
  }

  if (kind === "folders") {
    if (req.method === "POST" && !id) { body((p) => ({ folder: lib.createFolder(p.name) })); return true; }
    if (req.method === "PATCH" && id) { body((p) => ({ folder: lib.renameFolder(id, p.name) })); return true; }
    if (req.method === "DELETE" && id) { reply(res, respondJson, () => ({ deleted: lib.deleteFolder(id) })); return true; }
  }

  if (kind === "items") {
    if (req.method === "POST" && !id) { body((p) => ({ item: lib.addItem(p) })); return true; }
    if (req.method === "PATCH" && id) { body((p) => ({ item: lib.updateItem(id, p) })); return true; }
    if (req.method === "DELETE" && id) { reply(res, respondJson, () => ({ deleted: lib.deleteItem(id) })); return true; }
  }

  respondJson(res, 404, { ok: false, error: "Unknown inspiration route" });
  return true;
}
