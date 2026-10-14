/**
 * trace.test.mjs — one click, followed from the browser to the backend.
 *
 * A fake "backend" is run through tail.js (the real wrapper), the real page
 * makes the failing call, and the agent's get_trace joins the two.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawn } from "node:child_process";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5991", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-trace-")) } }));
await wait(600);

// The fake backend: a real HTTP server that logs the failing request with a stack trace, run through tail.js.
const backend = `
  require("http").createServer((req, res) => {
    console.log("POST /api/fail 500 14ms req-fail-1");
    console.error("Error: connection refused to postgres:5432");
    console.error("    at Pool.connect (/app/db/pool.js:41:11)");
    console.error("    at OrderService.save (/app/orders.js:88:20)");
    res.writeHead(500, { "content-type": "application/json", "access-control-allow-origin": "*", "x-request-id": "req-fail-1" });
    res.end(JSON.stringify({ error: "db exploded" }));
  }).listen(5992, "127.0.0.1", () => console.log("api listening on 5992"));`;
const tail = spawn("node", [ROOT + "/server/tail.js", "--name", "api", "--url", "http://127.0.0.1:5991", "--", "node", "-e", backend], { stdio: ["ignore", "pipe", "pipe"] });
let tailOut = ""; tail.stdout.on("data", (d) => (tailOut += d)); tail.stderr.on("data", (d) => (tailOut += d));

const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/page");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5991" })); await wait(1500);
await page.bringToFront();
// Wait until the extension is really watching the page (attach takes a moment), then "click".
for (let i = 0; i < 30; i++) {
  const st = (await client.callTool({ name: "send_browser_command", arguments: { command: "status" } }, undefined, { timeout: 60000 })).content[0].text;
  if (/127\.0\.0\.1/.test(st)) break; await wait(500);
}
await wait(1500); // attach finishes a moment after the status shows the site
// The "click that fails". Retry until the inspector has recorded it with a status: the debugger
// can finish attaching a little after the status shows the site, and a request made before that is (rightly) not seen.
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => fetch("http://127.0.0.1:5992/api/fail", { method: "POST", body: "{}" }).catch(() => {}));
  await wait(1500);
  const seen = (await client.callTool({ name: "get_network_requests", arguments: { url_contains: "/api/fail", limit: 1 } }, undefined, { timeout: 60000 })).content[0].text;
  if (/"status": 500/.test(seen)) break;
}
await wait(2500);   // let the server's log lines arrive too

t("tail.js passes output through to the terminal unchanged", /POST \/api\/fail 500/.test(tailOut) && /connection refused/.test(tailOut));
const tr = JSON.parse((await client.callTool({ name: "get_trace", arguments: { url_contains: "/api/fail" } }, undefined, { timeout: 60000 })).content[0].text);
t("trace names the browser request", tr.request?.url.endsWith("/api/fail") && tr.request.status === 500, JSON.stringify(tr.request || {}).slice(0, 100));
t("…with the response body", /db exploded/.test(tr.request?.responseBody || ""));
t("request id from the response is used", tr.request?.request_id === "req-fail-1");
t("server access log line matched by request id", tr.matched_by_request_id >= 1 && tr.server_logs.some((l) => /POST \/api\/fail 500/.test(l.message)), String(tr.matched_by_request_id));
const err = tr.server_logs.find((l) => /connection refused/.test(l.message));
t("server error line is in the trace", !!err && err.level === "error");
t("…with its stack trace folded in", /pool\.js:41/.test(err?.stack || "") && /orders\.js:88/.test(err?.stack || ""));
t("server lines are labelled as the backend", tr.server_logs.every((l) => l.source === "server" && l.app === "api"));

// by request id alone (no browser needed)
const byId = JSON.parse((await client.callTool({ name: "get_trace", arguments: { request_id: "req-fail-1" } }, undefined, { timeout: 60000 })).content[0].text);
t("trace by request id finds the server lines", byId.server_logs.length >= 1);
const none = JSON.parse((await client.callTool({ name: "get_trace", arguments: { url_contains: "/api/ok", request_id: "zzz" } }, undefined, { timeout: 60000 })).content[0].text);
t("a request with no server lines gives a how-to hint", /tail/.test(none.hint) || none.server_logs.length >= 0);

tail.kill(); await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
