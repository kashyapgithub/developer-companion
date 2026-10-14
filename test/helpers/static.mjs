/**
 * static.mjs — a tiny web server for the browser tests.
 *
 * Serves a demo page at /page (a button, a password field, a tall body) and
 * the repo's own files, so the editor can also be opened as a plain page.
 * Safe to start more than once: if the port is taken, it assumes another
 * test already started it.
 */
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { ROOT } from "./paths.mjs";

export const STATIC_PORT = 8777;
const TYPES = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };
const DEMO_PAGE = "<html><body style='height:2000px'><h1>Host page</h1><div style='padding:20px'><button id='save' class='primary' style='background:#e8590c;color:#fff;border:0;border-radius:8px;padding:14px 28px;font:600 18px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.25)'>Save changes</button><input type=password value='hunter2' id='pw'></div></body></html>";

export function startStatic() {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname === "/page") { res.setHeader("content-type", "text/html"); return res.end(DEMO_PAGE); }
    // A page that overflows sideways on narrow screens (for the responsive test) and one that doesn't.
    if (pathname === "/wide") { res.setHeader("content-type", "text/html"); return res.end("<html><body style='margin:0'><div style='width:900px;height:200px;background:#e8590c;color:#fff;font:700 32px system-ui'>Fixed 900px banner</div></body></html>"); }
    if (pathname === "/fluid") { res.setHeader("content-type", "text/html"); return res.end("<html><body style='margin:0'><div style='height:200px;background:#1c7ed6;color:#fff;font:700 32px system-ui'>Fluid banner</div></body></html>"); }
    // A page with deliberate accessibility problems (for the audit test).
    if (pathname === "/a11y") { res.setHeader("content-type", "text/html"); return res.end("<html><head></head><body><h1>Shop</h1><h3>Skipped a level</h3><img src='data:image/gif;base64,R0lGODlhAQABAAAAACw=' width=40 height=40><button id='nameless'></button><input id='email' type='text'><p style='color:#bbb;background:#fff;font:16px system-ui'>Faint grey text</p><a href='/x'>ok link</a></body></html>"); }
    // Fake API for the network/trace/mock tests.
    if (pathname === "/api/ok") { res.setHeader("content-type", "application/json"); res.setHeader("x-request-id", "req-ok-1"); return res.end(JSON.stringify({ items: [1, 2, 3], token: "abc123secret" })); }
    if (pathname === "/api/fail") { res.statusCode = 500; res.setHeader("content-type", "application/json"); res.setHeader("x-request-id", "req-fail-1"); return res.end(JSON.stringify({ error: "db exploded", detail: "connection refused" })); }
    const file = path.join(ROOT, pathname.replace(/^\/ext\//, "/"));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  });
  server.on("error", () => {}); // port already served by an earlier call
  server.listen(STATIC_PORT, "127.0.0.1");
  server.unref();               // never keeps a finished test alive
  return server;
}
