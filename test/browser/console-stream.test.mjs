/**
 * console-stream.test.mjs — the Stream console button + watch_console, end to end.
 * Real extension, real page logging to its console, real MCP client following along.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5983", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-stream-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/page");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
// Settings say: console is NOT forwarded. Streaming must override that; off must respect it.
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5983", forwardConfig: { console: false, exceptions: true, browserLog: true, networkFailures: true, networkRaw: false } }));
await wait(1500); await page.bringToFront(); await wait(1500);

const watch = async (args = {}) => JSON.parse((await client.callTool({ name: "watch_console", arguments: args }, undefined, { timeout: 90000 })).content[0].text);
const say = (msg) => page.evaluate((m) => console.log(m), msg);
// Make sure the debugger is attached before we measure (the first agent call on a tab attaches it).
await client.callTool({ name: "get_network_requests", arguments: { limit: 1 } }, undefined, { timeout: 60000 }); await wait(1000);

// ---- OFF: console.log is not forwarded (settings respected) ----
let w = await watch({ wait_seconds: 0 });
t("first call starts from now with a cursor", typeof w.cursor === "number" && w.count === 0 && /from now/i.test(w.note || ""));
await say("quiet line while off"); await wait(2500);
w = await watch({ cursor: w.cursor, wait_seconds: 0 });
t("while OFF a plain console.log does not reach the agent", !w.lines.some((l) => /quiet line/.test(l)), JSON.stringify(w.lines));
let cursor = w.cursor;

// ---- the button ----
t("button exists and starts off", (await ed.$eval("#stream-btn", (b) => b.getAttribute("aria-pressed"))) === "false");
await ed.evaluate(() => document.getElementById("stream-btn").click()); await wait(600);
t("clicking turns it on (pressed + red state)", (await ed.$eval("#stream-btn", (b) => b.getAttribute("aria-pressed") === "true" && b.classList.contains("active"))));
t("flag is saved so other windows agree", (await ed.evaluate(() => chrome.storage.local.get("dcStreamConsole"))).dcStreamConsole === true);

// ---- ON: lines arrive live, and the long poll returns early ----
const t0 = Date.now();
const pending = watch({ cursor, wait_seconds: 30 });          // the agent is already waiting...
await wait(800); await say("hello from the app"); await page.evaluate(() => console.warn("careful now"));
w = await pending;                                              // ...and is woken by the new lines
const took = Date.now() - t0;
t("watch_console returns when output arrives, not after 30s", took < 6000 && w.count >= 1, `${took}ms`);
const seen = [...w.lines];
if (!seen.some((l) => /careful now/.test(l))) seen.push(...(await watch({ cursor: w.cursor, wait_seconds: 3 })).lines);
t("plain console.log reaches the agent while streaming", seen.some((l) => /hello from the app/.test(l)), JSON.stringify(seen).slice(0, 160));
t("warnings carry their level", seen.some((l) => / warn \[127\.0\.0\.1\] careful now/.test(l)), seen.join(" | ").slice(0, 160));
cursor = w.cursor;

await page.evaluate(() => { setTimeout(() => { throw new Error("kaboom in handler"); }, 10); });
await wait(1200);
w = await watch({ cursor, wait_seconds: 5 });
t("uncaught errors arrive with a short stack", w.lines.some((l) => /error \[.*\] .*kaboom/.test(l)) , JSON.stringify(w.lines).slice(0, 160));
cursor = w.cursor;

// cursor continuity: nothing repeated
w = await watch({ cursor, wait_seconds: 0 });
t("no repeats when continuing from the cursor", w.count === 0);
await say("filter me out"); await page.evaluate(() => console.error("only errors please")); await wait(1500);
w = await watch({ cursor, wait_seconds: 3, min_level: "error" });
t("min_level filters out lower levels", w.lines.some((l) => /only errors please/.test(l)) && !w.lines.some((l) => /filter me out/.test(l)), JSON.stringify(w.lines).slice(0, 160));
cursor = w.cursor;

// ---- turn OFF again ----
await ed.evaluate(() => document.getElementById("stream-btn").click()); await wait(600);
t("clicking again turns it off", (await ed.$eval("#stream-btn", (b) => b.getAttribute("aria-pressed"))) === "false");
await say("after off line"); await wait(2500);
w = await watch({ cursor, wait_seconds: 0 });
t("after OFF plain console.log stops reaching the agent", !w.lines.some((l) => /after off line/.test(l)), JSON.stringify(w.lines));

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
