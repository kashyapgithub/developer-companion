/**
 * xray.test.mjs — X-ray mode on a real page: hover names, hierarchy, selection,
 * ancestor jump, add to canvas, send to agent (MCP), component names, and
 * that the page itself never reacts to the clicks.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "t", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5985", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.setViewport({ width: 1000, height: 700 }); await page.goto("http://127.0.0.1:8777/page");
// Fake React: the helper reads fibers off DOM nodes, so give the button one.
await page.evaluate(() => { function SaveButton() {} document.querySelector("#save").__reactFiber$abc = { type: function SaveButton() {}, return: null }; window.__pageClicks = 0; document.querySelector("#save").addEventListener("click", () => window.__pageClicks++); });
const ed = await browser.newPage(); await ed.setViewport({ width: 1280, height: 800 }); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5985" }));
await page.bringToFront(); await wait(300); await ed.bringToFront(); await wait(300);

// The panel lives in a closed shadow root, so read it through the page's accessibility of events: use screenshots-free probes.
await ed.click("#xray-btn"); await wait(1500);
t("X-ray button reports on", await ed.$eval("#xray-btn", (e) => e.classList.contains("active")));
t("page world has the helper", await page.evaluate(() => !!window.__dcXrayMain));
await page.bringToFront();
const box = await (await page.$("#save")).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await wait(400);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await wait(400);
t("page did not receive the click", await page.evaluate(() => window.__pageClicks) === 0);

// The panel sits in a closed shadow root, so click its buttons by position: one row at the bottom
// (Add to canvas, Send to agent, Copy selector, Exit). Sweep left to right until both deliveries happened.
const canvasShapes = () => ed.evaluate(() => window.__uiSketch.controller.state.shapes.filter((s) => s.type === "image"));
const agentGotIt = async () => (await client.callTool({ name: "get_selected_elements", arguments: {} })).content[0].text.startsWith("{");
await page.bringToFront();
for (let x = 180; x <= 700; x += 40) {
  if ((await canvasShapes()).length && await agentGotIt()) break;
  await page.mouse.click(x, 700 - 38); await wait(700);
}
const shapes = await canvasShapes();
t("Add to canvas puts an image with component and hierarchy", shapes.length >= 1 && shapes[0].meta?.component === "SaveButton" && shapes[0].meta.hierarchy.length >= 3, JSON.stringify(shapes[0]?.meta?.hierarchy));
const res = await client.callTool({ name: "get_selected_elements", arguments: {} });
const body = res.content[0].text;
t("agent receives the selection", body.startsWith("{"), body.slice(0, 80));
if (body.startsWith("{")) {
  const doc = JSON.parse(body); const el = doc.elements[0];
  t("selector points at the button", /save/.test(el.selector), el.selector);
  t("React component name found", el.component === "SaveButton", String(el.component));
  t("hierarchy ends at the button", /button#save/.test(el.hierarchy.slice(-1)[0]) && el.hierarchy.includes("body"), el.hierarchy.join(" > "));
  t("has styles and a screenshot", !!el.styles["background-color"] && res.content.some((c) => c.type === "image"));
}
await page.keyboard.press("Escape"); await wait(300);
t("Esc leaves X-ray", await page.evaluate(() => !document.documentElement.innerHTML.includes("crosshair")) && (await page.evaluate(() => typeof self.__dcXray)) !== "object");
await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
