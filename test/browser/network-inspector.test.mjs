/**
 * network-inspector.test.mjs — the agent reads what the app's API calls sent and got back.
 * Real page + real extension + real MCP client. Secrets must come back masked.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5990", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-net-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/page");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5990" })); await wait(1500);
await page.bringToFront();

const ask = async (args = {}) => JSON.parse((await client.callTool({ name: "get_network_requests", arguments: args }, undefined, { timeout: 60000 })).content[0].text);

// Warm-up: the first ask makes sure the tab is being watched (retrying while the extension's command loop starts).
for (let i = 0; i < 10; i++) {
  const text = (await client.callTool({ name: "get_network_requests", arguments: { limit: 1 } }, undefined, { timeout: 60000 })).content[0].text;
  if (text.startsWith("{")) break; await wait(1000);
}

// The app makes a good call and a failing one (with a secret header and password in the body).
await page.evaluate(async () => {
  await fetch("/api/ok", { headers: { "X-Trace": "t1" } });
  await fetch("/api/fail", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk" }, body: JSON.stringify({ email: "a@b.co", password: "hunter2", qty: 3 }) });
});
await wait(800);

let r = await ask({ url_contains: "/api/" });
t("agent sees both calls, newest first", r.count === 2 && r.requests[0].url.endsWith("/api/fail"), JSON.stringify(r.requests.map((x) => x.url)));
const fail = r.requests[0], ok = r.requests[1];
t("method, status and timing are there", fail.method === "POST" && fail.status === 500 && typeof fail.durationMs === "number");
t("response body is readable", JSON.parse(fail.responseBody).error === "db exploded");
t("request body is readable, password masked", JSON.parse(fail.requestBody).qty === 3 && JSON.parse(fail.requestBody).password === "[REDACTED]", fail.requestBody);
t("Authorization header is masked", fail.requestHeaders.Authorization === "[REDACTED]" || fail.requestHeaders.authorization === "[REDACTED]", JSON.stringify(fail.requestHeaders));
t("secret fields in a response are masked", JSON.parse(ok.responseBody).token === "[REDACTED]" && JSON.parse(ok.responseBody).items.length === 3);
t("server's request-id header is surfaced", fail.correlationId === "req-fail-1", String(fail.correlationId));

r = await ask({ status: "failed" }); t("status filter failed includes the 500 (and e.g. a favicon 404)", r.requests.some((x) => x.status === 500) && r.requests.every((x) => x.status >= 400 || x.error));
r = await ask({ status: "5xx" }); t("status filter '5xx'", r.count === 1);
r = await ask({ status: "200", url_contains: "/api/" }); t("exact status filter", r.count === 1 && r.requests[0].url.endsWith("/api/ok"));
r = await ask({ method: "post" }); t("method filter (case-insensitive)", r.count === 1 && r.requests[0].method === "POST");
r = await ask({ url_contains: "/api/", include_bodies: false }); t("bodies can be left out", r.requests.every((x) => x.responseBody === "[omitted]" || x.responseBody === null));
r = await ask({ url_contains: "/nothing-here" }); t("no match -> empty list, not an error", r.count === 0);

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
