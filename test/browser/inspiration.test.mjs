/**
 * inspiration.test.mjs — the inspiration library, end to end:
 * editor (real extension) -> real server -> real MCP client.
 *
 * Save an image from the canvas, make a folder in the UI, file the image,
 * write a note, ask the "agent" for it by folder name, put it back on the
 * canvas, auto-save captures, delete, and the bridge-offline message.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import zlib from "node:zlib";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

/** Writes a small solid-colour PNG to disk (so the file picker has something real to upload). */
function makePng(file, [r, g, b]) {
  const w = 64, h = 48, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1); raw[i] = 0; raw.set([r, g, b], i + 1 + x * 3); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-insp-e2e-"));
const red = path.join(dir, "red.png"), blue = path.join(dir, "blue.png"); makePng(red, [200, 40, 40]); makePng(blue, [40, 70, 200]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5989", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-store-")) } }));
await wait(600);
const ask = async (args = {}) => (await client.callTool({ name: "get_inspiration", arguments: args })).content;

const { browser, id } = await launch();
const ed = await browser.newPage(); await ed.setViewport({ width: 1280, height: 800 });
await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(500);
await ed.evaluate(() => chrome.storage.local.set({ connection: { where: "local", host: "", port: 5989, token: "" } }));
await ed.reload(); await wait(900);

const click = (sel) => ed.evaluate((s) => document.querySelector(s).click(), sel);
const imageCount = () => ed.evaluate(() => window.__uiSketch.controller.state.shapes.filter((s) => s.type === "image").length);
const cards = () => ed.$$eval(".insp-card", (c) => c.length);
const upload = async (file) => { await (await ed.$("#image-picker")).uploadFile(file); await wait(700); };

// ---- 1. empty state, tool is listed, agent told how to fill it ----
await click("#tab-inspiration"); await wait(500);
t("Inspiration tab opens and starts empty", (await cards()) === 0 && /Nothing saved yet/.test(await ed.$eval("#insp-status", (e) => e.textContent)));
t("agent gets a helpful empty answer", /No saved inspiration/.test((await ask())[0].text));

// ---- 2. save the selected image from the Design panel ----
await click("#tab-design"); await upload(red);
t("save button shows for a selected image", await ed.$eval("#save-inspo-btn", (b) => !b.closest(".row").hidden));
await click("#save-inspo-btn"); await wait(900);
await click("#tab-inspiration"); await wait(600);
t("image is saved and appears as a card", (await cards()) === 1);

// ---- 3. make a folder in the UI and file the image there ----
await click("#insp-new-folder"); await ed.type("#insp-name-input", "Dashboards"); await ed.keyboard.press("Enter"); await wait(700);
t("new folder chip is created and selected", await ed.$$eval(".insp-chip", (c) => c.some((x) => x.classList.contains("active") && x.textContent.startsWith("Dashboards"))));
await click("[data-folder='']"); await wait(300); // Unsorted
await click(".insp-card"); await wait(300);
t("detail strip opens for the selected card", await ed.$eval("#insp-detail", (d) => !d.hidden));
await ed.select("#insp-folder-select", await ed.$eval("#insp-folder-select option:nth-child(2)", (o) => o.value)); await wait(700);
await ed.$eval("#insp-note", (n) => { n.value = "Dense table, great spacing"; n.dispatchEvent(new Event("change", { bubbles: true })); }); await wait(600);

// ---- 4. the agent can ask for it by folder name ----
const got = await ask({ folder: "dashboards" });
const meta = JSON.parse(got[0].text);
t("agent finds it by folder name", meta.items.length === 1 && meta.items[0].folderName === "Dashboards", JSON.stringify(meta.items[0] || {}));
t("agent sees the note", meta.items[0]?.note === "Dense table, great spacing");
t("agent receives the image itself", got.some((c) => c.type === "image" && c.mimeType === "image/png"));
t("search by note text works", JSON.parse((await ask({ query: "spacing" }))[0].text).items.length === 1);

// ---- 5. put it back on the canvas (and it must not re-save itself) ----
await click("#screenshot-btn"); await click("#insp-autosave"); await wait(300); // auto-save ON
t("auto-save switch is remembered", await ed.evaluate(() => new Promise((r) => chrome.storage.local.get(["inspirationAutoSave"], (v) => r(v.inspirationAutoSave === true)))));
const before = await imageCount(); await click("#insp-use"); await wait(900);
t("Add to canvas places the image", (await imageCount()) === before + 1);
t("…tagged as inspiration for the agent", await ed.evaluate(() => window.__uiSketch.controller.state.shapes.filter((s) => s.type === "image").some((s) => s.meta?.kind === "inspiration")));
t("…and is not re-saved by auto-save", JSON.parse((await ask({ limit: 30 }))[0].text).items.length === 1);

// ---- 6. auto-save picks up a brand-new capture ----
await upload(blue); await wait(800);
t("auto-save keeps a new upload", JSON.parse((await ask({ limit: 30 }))[0].text).items.length === 2);

if (process.env.INSP_SHOT) { await click("#tab-inspiration"); await wait(400); await ed.screenshot({ path: process.env.INSP_SHOT }); }
// ---- 7. folder delete keeps images; item delete removes them ----
await ed.evaluate(() => [...document.querySelectorAll(".insp-chip")].find((c) => c.textContent.startsWith("Dashboards")).click()); await wait(300);
t("folder actions appear for a custom folder", await ed.$eval("#insp-folder-actions", (e) => !e.hidden));
await click("#insp-delete-folder"); await wait(700);
const lib = JSON.parse((await ask({ limit: 30 }))[0].text);
t("deleting a folder keeps its images (now Unsorted)", lib.items.length === 2 && lib.items.every((i) => i.folderName === "Unsorted"));
await click("#insp-folders [data-folder='__all__']"); await wait(300); await click(".insp-card"); await wait(300); await click("#insp-delete"); await wait(700);
t("deleting an image removes it", (await cards()) === 1 && JSON.parse((await ask({ limit: 30 }))[0].text).items.length === 1);

// ---- 8. bridge offline -> readable message ----
await ed.evaluate(() => chrome.storage.local.set({ connection: { where: "local", host: "", port: 5999, token: "" } }));
await ed.reload(); await wait(800); await click("#tab-inspiration"); await wait(800);
t("bridge offline -> readable message", /Can't reach/.test(await ed.$eval("#insp-status", (e) => e.textContent)), await ed.$eval("#insp-status", (e) => e.textContent));

await browser.close(); await client.close();
for (const [ok, n] of out) console.log((ok ? "PASS " : "FAIL ") + n);
process.exit(out.every((o) => o[0]) ? 0 : 1);
