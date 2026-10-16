/**
 * api-window.test.mjs — the API client popup in real Chromium, talking to a real bridge:
 * opens from the editor button, sends a request, runs tests, saves, imports curl, uses an environment,
 * and lists captured browser traffic.
 */
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { spawn } from "node:child_process";
import { launch, ROOT } from "../helpers/launch.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const target = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, path: req.url, n: 7 })); });
await new Promise((r) => target.listen(5975, "127.0.0.1", r));
const bridge = spawn("node", [ROOT + "/server/server.js"], { env: { ...process.env, PORT: "5974", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-apiw-")) }, stdio: "ignore" });
await wait(1200);

const { browser, id } = await launch();
const boot = await browser.newPage();
await boot.goto(`chrome-extension://${id}/editor/editor.html`); await wait(600);
await boot.evaluate(() => chrome.storage.local.set({ connection: { where: "local", host: "", port: 5974, token: "" }, serverUrl: "http://127.0.0.1:5974" })); await wait(400);

// 1. The top-bar button opens a popup window (not a tab).
await boot.click("#api-btn");
let win = null; for (let i = 0; i < 30 && !win; i++) { await wait(300); win = (await browser.pages()).find((p) => p.url().endsWith("api/api.html")); }
t("the API button opens the client", !!win);
const kind = await boot.evaluate(async () => (await chrome.windows.getAll()).map((w) => w.type));
t("it is a popup window", kind.includes("popup"), kind.join(","));
const errors = []; win.on("pageerror", (e) => errors.push(e.message));
await win.bringToFront(); await wait(800);
await win.reload(); await wait(800);

// 2. Send a request typed by hand.
await win.type("#url", "127.0.0.1:5975/hello?x=1");
await win.click("#send"); await wait(1200);
const bar = await win.$eval("#resp-bar", (e) => e.textContent);
t("sending shows the status", /200/.test(bar), bar);
t("the JSON body is pretty-printed", /"n": 7/.test(await win.$eval("#resp-body", (e) => e.textContent)));
t("history lists the call", /hello/.test(await win.$eval("#history", (e) => e.textContent)));

// 3. Tests: one passes, one fails.
await win.evaluate(() => window.__dcApi.editor.set({ method: "GET", url: "127.0.0.1:5975/t", name: "check", tests: [{ type: "status", op: "equals", value: 200 }, { type: "json", op: "equals", path: "n", value: 8 }] }));
await win.click("#send"); await wait(1000);
t("tests report 1 of 2", /1\/2 tests/.test(await win.$eval("#resp-bar", (e) => e.textContent)));
t("the Tests tab shows the failure", /✗/.test(await win.$eval("#resp-tests", (e) => e.textContent)));

// 4. Save into a collection that is created on the fly.
await win.click("#save"); await wait(900);
t("saving creates a collection and lists the request", /check/.test(await win.$eval("#tree", (e) => e.textContent)));
t("the unsaved marker clears", (await win.$eval("#dirty", (e) => e.textContent)) === "");

// 5. Environment with {{baseUrl}}.
await win.click("#env-new"); await wait(300);
await win.type("#dlg-env input", "Local");
const keys = await win.$$("#dlg-env .kv-key"); await keys[0].type("baseUrl");
const vals = await win.$$("#dlg-env .kv-value"); await vals[0].type("http://127.0.0.1:5975");
await win.evaluate(() => [...document.querySelectorAll("#dlg-env button")].find((b) => b.textContent === "Save").click()); await wait(900);
t("the new environment is selected", (await win.$eval("#env-select", (e) => e.selectedOptions[0]?.textContent)) === "Local");
await win.evaluate(() => window.__dcApi.editor.set({ method: "GET", url: "{{baseUrl}}/from-env", name: "env", tests: [] }));
await win.click("#send"); await wait(1000);
t("{{baseUrl}} is filled from the environment", /from-env/.test(await win.$eval("#resp-body", (e) => e.textContent)));

// 6. Import a curl command through the dialog.
await win.click("#import-btn"); await wait(300);
await win.type("#dlg-import textarea", "curl -X POST http://127.0.0.1:5975/orders -H 'Content-Type: application/json' -d '{\"a\":1}'");
await win.evaluate(() => [...document.querySelectorAll("#dlg-import button")].find((b) => b.textContent === "Import").click()); await wait(900);
t("the curl import appears in the sidebar", /\/orders/.test(await win.$eval("#tree", (e) => e.textContent)));

// 7. Copy as curl works from the form (server builds it).
const curl = await win.evaluate(async () => { const { api } = await import("./modules/client.js"); return (await api.curl(window.__dcApi.editor.get(), "")).curl; });
t("the form converts to a curl command", /^curl /.test(curl) && /from-env/.test(curl), curl);

// 8. Browser traffic list (the app page makes a fetch the service worker records).
const app = await browser.newPage(); await app.goto("http://127.0.0.1:8777/page");
const cap = await win.evaluate(() => chrome.runtime.sendMessage({ type: "API_CAPTURED" }));
t("captured traffic answers with a list", cap?.ok === true && Array.isArray(cap.items));

// 8b. Security check, load test and double-submit from the toolbar.
await win.evaluate(() => window.__dcApi.editor.set({ method: "GET", url: "127.0.0.1:5975/probe?x=1", name: "probe", auth: { type: "bearer", token: "abc" } }));
await win.click("#security-btn"); await wait(2500);
const secText = await win.$eval("#dlg-report", (e) => e.textContent);
t("Security check shows its findings", /Works without credentials/.test(secText) && /fail/.test(secText), secText.slice(0, 80));
await win.evaluate(() => document.getElementById("dlg-report").close());
await win.click("#load-btn"); await wait(2500);
t("Load test shows latency", /p50/.test(await win.$eval("#dlg-report", (e) => e.textContent)));
await win.evaluate(() => document.getElementById("dlg-report").close());
await win.click("#race-btn"); await wait(1500);
t("Double-submit test shows the verdict", /Sent at the same instant/.test(await win.$eval("#dlg-report", (e) => e.textContent)));
await win.evaluate(() => document.getElementById("dlg-report").close());

// 9. Errors are friendly, and the page threw nothing.
await win.evaluate(() => window.__dcApi.editor.set({ method: "GET", url: "{{nope}}/x" }));
await win.click("#send"); await wait(700);
t("a missing variable is explained", /Missing variable/.test(await win.$eval("#resp-body", (e) => e.textContent)));
t("no script errors in the window", errors.length === 0, errors.join(" | "));

await browser.close(); bridge.kill(); target.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
