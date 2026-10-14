/**
 * video-review.test.mjs — record, pause, annotate, resume, mark, stop, and the agent reads it.
 * Uses a canvas stream as the "screen" so no picker is needed.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const store = fs.mkdtempSync(path.join(os.tmpdir(), "dc-"));
const client = new Client({ name: "t", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5986", STORE_DIR: store } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/page");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
const w = await browser.newPage(); await w.setViewport({ width: 420, height: 680 });
await w.goto(`chrome-extension://${id}/video/video.html`); await wait(500);
await w.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5986" }));

t("starts on the idle screen", await w.$eval("#idle", (e) => !e.hidden));
// A moving canvas stands in for the shared screen.
await w.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 640; c.height = 360; const g = c.getContext("2d"); let n = 0;
  setInterval(() => { g.fillStyle = `hsl(${(n += 9) % 360} 70% 50%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = "#fff"; g.font = "40px sans-serif"; g.fillText("Save changes", 180, 190); }, 66);
  await new Promise((r) => setTimeout(r, 200));
  await window.__dcVideo.begin(c.captureStream(15));
});
await wait(2200);
t("recording screen shows a running timer", await w.$eval("#live", (e) => !e.hidden) && (await w.$eval("#timer", (e) => e.textContent)) >= "00:01");
t("logs started alongside", !!(await w.evaluate(() => window.__dcVideo.state().logRecordingId)));

await w.click("#pause"); await wait(300);
t("pause shows the exact frame", await w.$eval("#paused", (e) => !e.hidden) && await w.$eval("#frame", (e) => e.src.startsWith("data:image/jpeg")));
const frozen = await w.$eval("#timer", (e) => e.textContent); await wait(1500);
t("timer is frozen while paused", frozen === await w.$eval("#timer", (e) => e.textContent), frozen);
await w.type("#expected", "Button should be full width and blue");
await w.type("#actual", "It is small and nothing happens on click");
await w.click("#save-moment"); await wait(500);
t("saving resumes recording", await w.$eval("#live", (e) => !e.hidden));
await wait(800); await w.click("#mark"); await wait(300);
t("two moments recorded", (await w.evaluate(() => window.__dcVideo.state().moments)).length === 2);
// "Draw on it": a paused frame lands on the editor's canvas, with the notes attached.
await w.click("#pause"); await wait(300); await w.type("#expected", "Make it blue");
await w.click("#to-canvas"); await wait(1000);
const shapes = await ed.evaluate(() => window.__uiSketch.controller.state.shapes.filter((s) => s.type === "image"));
t("Draw on it adds the frame to the canvas (once)", shapes.length === 1 && shapes[0].meta?.kind === "video-frame" && shapes[0].meta.expected === "Make it blue", `count=${shapes.length} ` + JSON.stringify(shapes[0]?.meta));
await w.click("#discard"); await wait(300);
t("discard resumes without saving a moment", (await w.evaluate(() => window.__dcVideo.state().moments)).length === 2);

// ---- annotating a paused frame: draw an arrow + box, save, agent sees them burned in ----
{
  const w2 = w;
  await w2.click("#pause"); await wait(400);
  const box = await w2.$eval("#ann-canvas", (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const drag = async (x1, y1, x2, y2) => { await w2.mouse.move(box.x + box.w * x1, box.y + box.h * y1); await w2.mouse.down(); await w2.mouse.move(box.x + box.w * (x1 + x2) / 2, box.y + box.h * (y1 + y2) / 2, { steps: 4 }); await w2.mouse.move(box.x + box.w * x2, box.y + box.h * y2, { steps: 4 }); await w2.mouse.up(); };
  await drag(0.1, 0.1, 0.5, 0.5);                                         // arrow (default tool)
  await w2.evaluate(() => document.querySelector("[data-ann-tool=box]").click());
  await drag(0.55, 0.55, 0.9, 0.9);                                       // box
  const px = () => w2.$eval("#ann-canvas", (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  const both = await px();
  t("drawing paints the overlay", both > 200, String(both));
  await w2.evaluate(() => document.getElementById("ann-undo").click());
  const afterUndo = await px();
  t("undo removes the last mark", afterUndo > 0 && afterUndo < both, String(afterUndo));
  await w2.evaluate(() => document.querySelector("[data-ann-tool=box]").click());
  await drag(0.55, 0.55, 0.9, 0.9);
  await w2.type("#expected", "Highlight is in the wrong place");
  await w2.click("#save-moment"); await wait(800);
  const saved = (await w2.evaluate(() => window.__dcVideo.state().moments)).at(-1);
  t("moment carries a note of what was drawn", saved.annotations === "1 arrow, 1 box", saved.annotations);
  t("saved frame has the red marks burned in", await w2.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90) red++;
    return red > 150;
  }, saved.frame));
}
await w.click("#stop"); await wait(3500);
const result = await w.$eval("#result", (e) => e.textContent);
t("window reports success", /Sent: 3 moments/.test(result), result);

const res = await client.callTool({ name: "get_video_review", arguments: {} });
const doc = JSON.parse(res.content[0].text);
t("agent sees both moments", doc.moments.length === 3, JSON.stringify(doc.moments[0]));
t("expected vs actual carried over", /full width/.test(doc.moments[0].expected) && /nothing happens/.test(doc.moments[0].actual));
t("frames come back as images", res.content.filter((c) => c.type === "image").length === 3);
t("video file saved and non-empty", doc.video_file && fs.statSync(doc.video_file).size > 2000, doc.video_file);
t("agent is told what was drawn", /1 arrow, 1 box/.test(JSON.stringify(doc.moments[2])) && res.content.some((c) => c.type === "text" && /drew on this frame/.test(c.text)));
t("log recording id is linked", !!doc.log_recording_id);
await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
