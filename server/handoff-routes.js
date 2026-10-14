/**
 * handoff-routes.js — the HTTP side of session handoff.
 *
 *   GET  /handoff[?inspiration=0]   downloads the bundle (JSON)
 *   POST /handoff/import            body = a bundle; restores it
 *
 * Called from server.js after the origin / access-code checks. Returns true when handled.
 */

import { buildBundle, describeBundle, importBundle } from "./handoff.js";

export function handleHandoff(req, res, pathname, searchParams, { readJsonBody, respondJson }) {
  if (pathname === "/handoff" && req.method === "GET") {
    const bundle = buildBundle({ inspiration: searchParams.get("inspiration") !== "0" });
    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="developer-companion-handoff.json"' });
    res.end(JSON.stringify(bundle));
    return true;
  }
  if (pathname === "/handoff/summary" && req.method === "GET") {
    respondJson(res, 200, { ok: true, contains: describeBundle(buildBundle({ inspiration: true })) });
    return true;
  }
  if (pathname === "/handoff/import" && req.method === "POST") {
    readJsonBody(req, res, (bundle) => {
      try { respondJson(res, 200, { ok: true, ...importBundle(bundle) }); }
      catch (err) { respondJson(res, 400, { ok: false, error: err.message || String(err) }); }
    });
    return true;
  }
  return false;
}
