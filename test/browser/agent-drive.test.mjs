/**
 * agent-drive.test.mjs — the agent records a session and drives the page by itself:
 * start_recording -> interact_with_page (fill, click, navigate) -> stop_recording -> get_latest_recording.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "t", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5984", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/page");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5984" })); await wait(1500);

const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 }); return r; };
const json = (r) => JSON.parse(r.content[0].text);

let r = json(await call("start_recording")); t("agent starts a recording", r.status === "done" && r.result.recording, JSON.stringify(r).slice(0, 90));
r = json(await call("interact_with_page", { action: "fill", selector: "#pw", value: "abc" }));
t("fill works", r.status === "done" && await page.$eval("#pw", (e) => e.value) === "abc");
await page.evaluate(() => document.querySelector("#save").addEventListener("click", () => { window.__clicked = true; setTimeout(() => { throw new Error("save exploded"); }, 0); }));
r = json(await call("interact_with_page", { action: "click", selector: "#save" }));
t("click works", r.status === "done" && await page.evaluate(() => window.__clicked === true));
r = json(await call("interact_with_page", { action: "click", selector: "#nope" })); t("missing element is a clear error", r.status === "failed" && /No element/.test(r.result.error));
r = json(await call("interact_with_page", { action: "navigate", url: "https://example.com/" })); t("navigation off the allowlist is refused", r.status === "failed" && /allowed/.test(r.result.error));
r = json(await call("interact_with_page", { action: "navigate", url: "http://127.0.0.1:8777/page?step=2" })); t("navigation on an allowed site works", r.status === "done");
r = json(await call("stop_recording")); t("agent stops and the session is saved", r.status === "done" && r.result.ok, JSON.stringify(r.result).slice(0, 90));
const rec = JSON.parse((await call("get_latest_recording")).content[0].text);
const msgs = rec.rows.map((x) => x.message);
t("recording holds the agent's click", msgs.some((m) => /clicked button#save/.test(m)));
t("recording holds the error it caused", msgs.some((m) => /save exploded/.test(m)));
t("recording holds the navigation", msgs.some((m) => /step=2/.test(m)));
r = json(await call("stop_recording")); t("stopping when idle is a clear error", r.status === "failed");

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
