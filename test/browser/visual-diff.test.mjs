/**
 * visual-diff.test.mjs — the agent saves a baseline, edits the page, and sees exactly what moved.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5993", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-vd-e2e-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.setViewport({ width: 1000, height: 700 }); await page.goto("http://127.0.0.1:8777/page");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5993" })); await wait(1500);
await page.bringToFront(); await page.setViewport({ width: 1000, height: 700 }); await wait(500); // set after bringToFront: the viewport must stay fixed between captures

const vd = async (args = {}) => { await page.setViewport({ width: 1000, height: 700 }); await wait(400); /* keep the viewport identical for every capture */ const r = await client.callTool({ name: "visual_diff", arguments: { name: "home", max_width: 1000, ...args } }, undefined, { timeout: 90000 }); return { json: JSON.parse(r.content[0].text), image: r.content.find((c) => c.type === "image") }; };

let r = await vd();
t("first call saves a baseline and shows it", r.json.saved === true && /Baseline saved/.test(r.json.message) && r.image?.mimeType === "image/png");
r = await vd(); t("same page again: no visual change", /No visual change/.test(r.json.verdict) && r.json.regions.length === 0, r.json.verdict);

// The "agent's edit": recolour the button and add a banner at the bottom of the view.
await page.evaluate(() => {
  document.querySelector("#save").style.background = "#1c7ed6";
  const b = document.createElement("div"); b.id = "banner"; b.textContent = "New banner"; b.style.cssText = "position:absolute;left:0;top:420px;width:600px;height:90px;background:#2f9e44;color:#fff;font:700 30px system-ui";
  document.body.appendChild(b);
});
await wait(300);
r = await vd();
t("verdict says something changed", /changed in \d+ region/.test(r.json.verdict), r.json.verdict);
t("changed regions include the recoloured button (near the top)", r.json.regions.some((g) => g.y < 200), JSON.stringify(r.json.regions));
t("…and the new banner (around y=420)", r.json.regions.some((g) => g.y <= 430 && g.y + g.h >= 500 && g.w >= 400), JSON.stringify(r.json.regions));
t("returns a diff image", r.image?.mimeType === "image/png" && Buffer.from(r.image.data, "base64").subarray(1, 4).toString() === "PNG");
t("size is unchanged", r.json.size_changed === false);

r = await vd({ update_baseline: true }); t("update_baseline accepts the new look", r.json.saved === true && /updated/i.test(r.json.message));
r = await vd(); t("after accepting, no change", /No visual change/.test(r.json.verdict), r.json.verdict);
r = await vd({ name: "other" }); t("a different name has its own baseline", r.json.saved === true);

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
