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
await w.click("#stop"); await wait(3500);
const result = await w.$eval("#result", (e) => e.textContent);
t("window reports success", /Sent: 2 moments/.test(result), result);

const res = await client.callTool({ name: "get_video_review", arguments: {} });
const doc = JSON.parse(res.content[0].text);
t("agent sees both moments", doc.moments.length === 2, JSON.stringify(doc.moments[0]));
t("expected vs actual carried over", /full width/.test(doc.moments[0].expected) && /nothing happens/.test(doc.moments[0].actual));
t("frames come back as images", res.content.filter((c) => c.type === "image").length === 2);
t("video file saved and non-empty", doc.video_file && fs.statSync(doc.video_file).size > 2000, doc.video_file);
t("log recording id is linked", !!doc.log_recording_id);
await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
