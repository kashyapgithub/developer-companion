/** vitals.test.mjs — real Core Web Vitals from a real tab: a page with a late layout shift and a slow click. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "t", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5986", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-vit-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.setViewport({ width: 1000, height: 700 }); await page.goto("http://127.0.0.1:8777/vitals");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5986" })); await wait(1500);
await page.bringToFront(); await wait(900);

const vitals = async (args = {}) => JSON.parse((await client.callTool({ name: "get_vitals", arguments: args }, undefined, { timeout: 60000 })).content[0].text);

let v = await vitals({ reload: true });
t("it reports the page", /vitals/.test(v.page?.url || ""), JSON.stringify(v).slice(0, 100));
t("layout shift is measured with its element", v.metrics.cls.value > 0.01 && /h1|button/.test(JSON.stringify(v.attribution.cls.shifts)), JSON.stringify(v.attribution.cls));
t("LCP is measured with an element", v.metrics.lcpMs.value > 0 && !!v.attribution.lcp.selector, JSON.stringify(v.attribution.lcp));
t("INP says it needs an interaction", v.metrics.inpMs.value === null && /INP needs an interaction/.test(v.notes.join()));

await page.click("#slow"); await wait(600);
v = await vitals({ save_baseline: "slow-page" });
t("after a real click INP is measured", v.metrics.inpMs.value >= 300, JSON.stringify(v.attribution.inp));
t("the slow handler is blamed on processing", v.attribution.inp.processingMs >= 250 && /event handler itself is slow/.test(v.fix_first.join()));
t("baseline is saved", v.saved_baseline === "slow-page");

v = await vitals({ compare_to: "slow-page" });
t("comparing with itself says no change", v.comparison.verdict === "same", v.comparison.summary);
v = await vitals({ compare_to: "nope" });
t("an unknown baseline is a clear message", /No baseline named/.test(v.comparison.error));

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
