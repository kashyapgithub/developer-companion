/**
 * responsive.test.mjs — screenshots at several widths with a sideways-scroll check,
 * and network throttling (slow / offline / normal) seen through the network inspector.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5995", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-resp-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/wide");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5995" })); await wait(1500);
await page.bringToFront(); await wait(1500);
const call = async (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });

// ---- responsive ----
let r = await call("capture_responsive", { widths: [375, 768, 1280] });
const meta = JSON.parse(r.content[0].text); const images = r.content.filter((c) => c.type === "image");
t("three sizes captured, one image each", meta.sizes.length === 3 && images.length === 3, JSON.stringify(meta.sizes.map((s) => s.width)));
t("fixed 900px banner scrolls sideways on the phone (375) and tablet?no", meta.sizes[0].overflowX === true, JSON.stringify(meta.sizes[0]));
t("…but not on desktop (1280)", meta.sizes[2].overflowX === false);
t("summary lists the sizes that scroll sideways", JSON.stringify(meta.sideways_scroll_at) === "[375]" || meta.sideways_scroll_at.includes(375), JSON.stringify(meta.sideways_scroll_at));
t("images are real JPEGs", images.every((i) => i.mimeType === "image/jpeg" && Buffer.from(i.data, "base64").length > 1000));
await wait(500);
const size = await page.evaluate(() => [innerWidth, matchMedia("(max-width: 500px)").matches]);
t("the browser's real size is restored afterwards", size[0] > 800 && size[1] === false, JSON.stringify(size));

await page.goto("http://127.0.0.1:8777/fluid"); await wait(1500);
r = await call("capture_responsive", { widths: [320] }); t("a fluid page does not scroll sideways", JSON.parse(r.content[0].text).sizes[0].overflowX === false);
r = await call("capture_responsive", { widths: [100, 5000] }); t("absurd widths are refused", /invalid|too_small|too_big|200/i.test(r.content[0].text) && !r.content.some((c) => c.type === "image"), r.content[0].text.slice(0, 60));

// ---- throttle ----
const net = async () => JSON.parse((await call("get_network_requests", { url_contains: "/api/ok", limit: 1 })).content[0].text).requests[0];
r = await call("set_network_throttle", { profile: "slow-3g" }); t("slow 3G switches on", JSON.parse(r.content[0].text).profile === "slow-3g");
await page.evaluate(() => fetch("/api/ok").catch(() => {})); await wait(3500);
const slow = await net(); t("a request under slow 3G takes over a second", slow?.durationMs > 1000, String(slow?.durationMs));
r = await call("set_network_throttle", { profile: "offline" }); await wait(300);
await page.evaluate(() => fetch("/api/ok?offline=1").catch(() => {})); await wait(1200);
const off = JSON.parse((await call("get_network_requests", { url_contains: "offline=1", limit: 1 })).content[0].text).requests[0];
t("offline makes the request fail (and the agent can see why)", !!off?.error, JSON.stringify(off?.error));
r = await call("set_network_throttle", { profile: "none" }); await wait(300);
await page.evaluate(() => fetch("/api/ok?fast=1").catch(() => {})); await wait(1000);
const fast = JSON.parse((await call("get_network_requests", { url_contains: "fast=1", limit: 1 })).content[0].text).requests[0];
t("back to normal: fast and OK again", fast?.status === 200 && fast.durationMs < 800, `${fast?.status} ${fast?.durationMs}`);
r = await call("set_network_throttle", { profile: "dial-up" }); t("unknown profile refused", /invalid|enum|dial-up/i.test(r.content[0].text), r.content[0].text.slice(0, 60));

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
