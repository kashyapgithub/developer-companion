/**
 * page-state.test.mjs — the agent reads a page's storage, cookie names and framework globals, with secrets masked.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5996", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-state-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/page");
await page.evaluate(() => {
  localStorage.setItem("theme", "dark");
  localStorage.setItem("authToken", "super-secret-value");
  localStorage.setItem("cart", JSON.stringify({ items: [1, 2], apiKey: "k-123" }));
  sessionStorage.setItem("step", "3");
  document.cookie = "sid=cookie-secret-999; path=/";
  window.__NEXT_DATA__ = { props: { user: "ana", password: "hunter2" } };
});
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5996" })); await wait(1500);
await page.bringToFront(); await wait(1500);

const raw = (await client.callTool({ name: "get_page_state", arguments: {} }, undefined, { timeout: 60000 })).content[0].text;
const r = JSON.parse(raw);
t("localStorage plain value is shown", r.local_storage.theme === "dark");
t("sensitive key value is masked", r.local_storage.authToken === "[REDACTED]");
t("JSON value parsed and nested secret masked", r.local_storage.cart.items.length === 2 && r.local_storage.cart.apiKey === "[REDACTED]");
t("sessionStorage is read", r.session_storage.step === "3" || r.session_storage.step === 3);
t("cookie names listed, values never", r.cookie_names.includes("sid") && !raw.includes("cookie-secret-999"));
t("framework global is read with secrets masked", r.framework_state.__NEXT_DATA__.props.user === "ana" && r.framework_state.__NEXT_DATA__.props.password === "[REDACTED]");
t("no secret anywhere in the output", !raw.includes("super-secret-value") && !raw.includes("hunter2") && !raw.includes("k-123"));

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
