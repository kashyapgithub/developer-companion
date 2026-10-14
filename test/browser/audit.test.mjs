/** audit.test.mjs — accessibility + performance scan finds planted problems and reports load metrics. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5997", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-audit-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/a11y");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5997" })); await wait(1500);
await page.bringToFront(); await wait(1500);

const r = JSON.parse((await client.callTool({ name: "audit_page", arguments: {} }, undefined, { timeout: 60000 })).content[0].text);
const by = r.accessibility.by_rule;
t("missing lang found", by["missing-lang"] === 1, JSON.stringify(by));
t("image without alt found", by["image-alt"] === 1);
t("nameless button found", by["button-name"] === 1);
t("unlabelled field found", by["form-label"] === 1);
t("heading jump found", by["heading-order"] === 1);
t("low contrast text found", by["color-contrast"] >= 1);
t("serious issues come first", r.accessibility.issues[0].severity === "serious");
t("issues carry a selector", r.accessibility.issues.some((i) => i.selector === "button#nameless"));
t("performance metrics present", r.performance.requests >= 0 && r.performance.domNodes > 5 && r.performance.loadMs > 0, JSON.stringify(r.performance).slice(0, 100));
t("verdict keys exist", "lcp" in r.performance.verdicts && "cls" in r.performance.verdicts);

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
