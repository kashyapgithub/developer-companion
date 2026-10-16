/**
 * motion.test.mjs — the 3D motion window end to end: draw two curves with the real mouse (one on the front
 * plane, one on the floor), label and color them, send, and read them back through the MCP tool like an agent.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const agent = new Client({ name: "agent", version: "1" });
await agent.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5978", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-motion-")) } }));
await wait(900);
t("before anything is sent the tool says so", /No motion has been sent/.test((await agent.callTool({ name: "get_latest_motion", arguments: {} })).content[0].text));

const { browser, id } = await launch();
const page = await browser.newPage(); await page.setViewport({ width: 1300, height: 800 });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/motion/motion.html`); await wait(500);
await page.evaluate(() => chrome.storage.local.set({ connection: { where: "local", host: "", port: 5978, token: "" }, serverUrl: "http://127.0.0.1:5978" })); await wait(300);
await page.reload(); await wait(700);

t("sending is disabled while empty", await page.$eval("#send", (b) => b.disabled));
const box = await (await page.$("#view")).boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
const drag = async (pts) => { await page.mouse.move(pts[0].x, pts[0].y); await page.mouse.down(); for (const p of pts.slice(1)) { await page.mouse.move(p.x, p.y, { steps: 4 }); } await page.mouse.up(); await wait(150); };

// 1. A curve on the front plane (an arc).
await drag([at(0.3, 0.6), at(0.35, 0.5), at(0.42, 0.42), at(0.5, 0.4), at(0.58, 0.45)]);
let n = await page.evaluate(() => window.__dcMotion.scene.curves.length);
t("drawing with the mouse makes a curve", n === 1);
t("a card appears in the side list", (await page.$$(".curve-card")).length === 1);

// 2. Another on the floor plane (depth), after switching planes.
await page.select("#plane", "floor");
await drag([at(0.6, 0.75), at(0.55, 0.8), at(0.5, 0.86)]);
const doc = await page.evaluate(() => { const s = window.__dcMotion.scene; s.curves[0].label = "Card entrance"; s.curves[0].color = "#e5645a"; s.curves[1].label = "Logo drift"; s.curves[1].target = ".logo"; s.curves[1].color = "#4aa3ff"; s.curves[1].durationMs = 1500; window.__dcMotion.changed(true); return window.__dcMotion.buildMotionDoc(); });
t("two curves with their own labels and colors", doc.curves.length === 2 && doc.curves[0].color === "#e5645a" && doc.curves[1].label === "Logo drift");
t("the floor curve really moves in depth (z changes)", Math.abs(doc.curves[1].end.z - doc.curves[1].start.z) > 20, JSON.stringify([doc.curves[1].start, doc.curves[1].end]));
t("the front curve stays flat in depth", Math.abs(doc.curves[0].end.z - doc.curves[0].start.z) < 1);
t("keyframes use translate3d", /translate3d\(/.test(doc.curves[1].keyframes) && /@keyframes motion-logo-drift/.test(doc.curves[1].keyframes));
t("the CSS preview is filled", /motion-card-entrance/.test(await page.$eval("#css-preview", (e) => e.textContent)));

// 3. Orbit with the right mouse button, then undo.
const before = await page.evaluate(() => window.__dcMotion.scene.camera.yaw);
await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down({ button: "right" }); await page.mouse.move(box.x + 380, box.y + 320, { steps: 5 }); await page.mouse.up({ button: "right" });
t("right-drag turns the view", (await page.evaluate(() => window.__dcMotion.scene.camera.yaw)) !== before);
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await wait(150);
t("Ctrl+Z removes the last curve", await page.evaluate(() => window.__dcMotion.scene.curves.length) === 1);
await page.keyboard.down("Control"); await page.keyboard.up("Control");

// Re-draw the second curve (undo has no redo).
await page.select("#plane", "floor");
await drag([at(0.6, 0.75), at(0.55, 0.8), at(0.5, 0.86)]);
await page.evaluate(() => { const s = window.__dcMotion.scene; s.curves[0].label = "Card entrance"; s.curves[0].color = "#e5645a"; s.curves[1].label = "Logo drift"; s.curves[1].target = ".logo"; s.curves[1].color = "#4aa3ff"; window.__dcMotion.changed(true); });

await page.type("#notes", "Card flies in, logo drifts toward the user.");
await page.click("#send"); await wait(1200);
t("the status confirms", /Sent 2 curves/.test(await page.$eval("#status", (e) => e.textContent)), await page.$eval("#status", (e) => e.textContent));
await page.screenshot({ path: process.env.MOTION_SHOT || "/dev/null" });

const got = await agent.callTool({ name: "get_latest_motion", arguments: {} });
const text = got.content.find((c) => c.type === "text").text;
t("the agent gets the user's words", text.includes("logo drifts toward the user"));
t("each curve by label and color", text.includes("Card entrance") && text.includes("Logo drift") && text.includes("#4aa3ff"));
t("with CSS keyframes and the axes explained", /@keyframes motion-logo-drift/.test(text) && /y DOWN/.test(text));
t("and a picture", got.content.some((c) => c.type === "image"));

// Persistence: closing and reopening keeps the drawing.
await page.reload(); await wait(800);
t("the drawing survives closing the window", await page.evaluate(() => window.__dcMotion.scene.curves.length) === 2);
t("no script errors", errors.length === 0, errors.join(" | "));

await browser.close(); await agent.close();
for (const [c, nme] of out) console.log((c ? "PASS " : "FAIL ") + nme);
process.exit(0);
