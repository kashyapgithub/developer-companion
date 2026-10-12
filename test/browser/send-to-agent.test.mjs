/**
 * send-to-agent.test.mjs — the whole "send it to my agent" flow, end to end:
 *
 *   real editor (in Chromium, extension loaded)
 *     → "Send to project" button
 *       → real local server (HTTP)
 *         → real MCP client (what Claude Code / Cursor use) reading it back.
 *
 * Also covers the failure paths a user actually hits: server not running,
 * wrong access code (agent on another machine), and a re-send replacing the
 * previous sketch.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execSync } from "node:child_process";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

// ---- helpers ----------------------------------------------------------------------

/** Starts the real server (HTTP + MCP over stdio) and returns an MCP client for it. */
async function startAgent(port, storeDir, extraEnv = {}) {
  const client = new Client({ name: "agent", version: "1" });
  await client.connect(new StdioClientTransport({
    command: "node", args: [ROOT + "/server/server.js"],
    env: { ...process.env, PORT: String(port), STORE_DIR: storeDir, ...extraEnv },
  }));
  await wait(600);
  return client;
}

/** Calls an MCP tool and returns its content array. */
const call = async (client, name, args = {}) => (await client.callTool({ name, arguments: args })).content;

/** Opens a fresh editor page pointed at a server (mode = MCP, given connection). */
async function openEditor(browser, id, connection) {
  const ed = await browser.newPage(); await ed.setViewport({ width: 1280, height: 800 });
  await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(500);
  await ed.evaluate((c) => chrome.storage.local.set({ uiSketchExportMode: "mcp", connection: c }), connection);
  await ed.reload(); await wait(900);
  return ed;
}

/** Draws a rectangle and types a text label so the sketch has real content. */
async function drawSomething(ed, label) {
  await ed.keyboard.press("r"); await ed.mouse.move(300, 200); await ed.mouse.down();
  await ed.mouse.move(520, 320, { steps: 8 }); await ed.mouse.up(); await wait(150);
  await ed.keyboard.press("t"); await ed.mouse.click(320, 380); await wait(250);
  await ed.keyboard.type(label); await ed.keyboard.press("Enter"); await wait(250);
}

/** Clicks "Send to project" and waits for the status line to settle. */
async function send(ed) {
  await ed.evaluate(() => { document.getElementById("export-status").textContent = ""; });
  await ed.evaluate(() => document.getElementById("export-btn").click());
  await wait(1500);
  return ed.$eval("#export-status", (e) => ({ text: e.textContent, cls: e.className }));
}

// ---- 1. the happy path ------------------------------------------------------------
const store = fs.mkdtempSync(path.join(os.tmpdir(), "dc-send-"));
const agent = await startAgent(5987, store);
const { browser, id } = await launch();
const local = { where: "local", host: "", port: 5987, token: "" };
const ed = await openEditor(browser, id, local);

const before = await call(agent, "get_latest_sketch");
t("agent sees 'nothing sent yet' before the first send", /No sketch has been exported/.test(before[0].text));

await drawSomething(ed, "Login button");
const sent = await send(ed);
t("editor reports success", sent.cls.includes("ok") && sent.text.length > 0, JSON.stringify(sent));

const got = await call(agent, "get_latest_sketch");
const json = JSON.parse(got[0].text);
const image = got.find((c) => c.type === "image");
t("agent receives the sketch JSON with our shapes", JSON.stringify(json).includes("Login button") && JSON.stringify(json).includes("rect"));
t("agent receives a real PNG image", !!image && image.mimeType === "image/png" && Buffer.from(image.data, "base64").subarray(1, 4).toString() === "PNG");

// ---- 2. re-send replaces the previous sketch --------------------------------------
await ed.keyboard.press("v"); await drawSomething(ed, "Second version");
await send(ed);
const second = JSON.stringify(JSON.parse((await call(agent, "get_latest_sketch"))[0].text));
t("re-sending delivers the newer sketch", second.includes("Second version"));

// ---- 3. everything else the agent can ask about, after the same session -----------
const tools = (await agent.listTools()).tools.map((x) => x.name);
t("agent can discover all the tools", ["get_latest_sketch", "get_browser_logs", "get_latest_recording", "get_selected_elements", "get_video_review", "capture_tab", "start_recording", "stop_recording", "interact_with_page", "get_companion_status"].every((n) => tools.includes(n)), tools.join(","));
const status = (await call(agent, "get_companion_status"))[0].text;
t("status tool answers", status.length > 10, status.slice(0, 80));

// ---- 4. server not running ---------------------------------------------------------
const offline = await openEditor(browser, id, { ...local, port: 5999 });
await drawSomething(offline, "x");
const off = await send(offline);
t("server offline → readable error, not a silent failure", off.cls.includes("err") && /Can't reach|reach/i.test(off.text), JSON.stringify(off));

// ---- 5. wrong / right access code (agent on another machine) -----------------------
const ip = (() => { try { return execSync("hostname -I").toString().trim().split(/\s+/).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)); } catch { return null; } })();
if (ip) {
  const lanStore = fs.mkdtempSync(path.join(os.tmpdir(), "dc-lan-"));
  fs.writeFileSync(path.join(lanStore, "config.json"), JSON.stringify({ lan: true, token: "ABCD-2345", port: 5988 }));
  const lanAgent = await startAgent(5988, lanStore);
  const remote = { where: "remote", host: ip, port: 5988, token: "WXYZ-9999" };

  const bad = await openEditor(browser, id, remote);
  await drawSomething(bad, "remote");
  const rejected = await send(bad);
  t("wrong access code → 'Wrong access code' message", rejected.cls.includes("err") && /access code/i.test(rejected.text), JSON.stringify(rejected));
  t("…and nothing reached the agent", /No sketch has been exported/.test((await call(lanAgent, "get_latest_sketch"))[0].text));

  const good = await openEditor(browser, id, { ...remote, token: "abcd2345" }); // case/dash-insensitive
  await drawSomething(good, "remote ok");
  const accepted = await send(good);
  t("right access code → delivered", accepted.cls.includes("ok"), JSON.stringify(accepted));
  t("…and the agent can read it", JSON.stringify(JSON.parse((await call(lanAgent, "get_latest_sketch"))[0].text)).includes("remote ok"));
  await lanAgent.close();
} else {
  t("LAN access-code check skipped (no non-loopback address in this machine)", true);
}

await browser.close(); await agent.close();
for (const [ok, n] of out) console.log((ok ? "PASS " : "FAIL ") + n);
process.exit(out.every((o) => o[0]) ? 0 : 1);
