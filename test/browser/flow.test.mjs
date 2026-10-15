/**
 * flow.test.mjs — "Explain flow to agent" end to end: build a flowchart with the panel in the real editor,
 * send it to a real bridge, and read it back through the MCP tool like an agent would.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const agent = new Client({ name: "agent", version: "1" });
await agent.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5976", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-flow-")) } }));
await wait(900);
const first = await agent.callTool({ name: "get_latest_flow", arguments: {} });
t("before anything is sent the tool says so", /No flow has been sent/.test(first.content[0].text));

const { browser, id } = await launch();
const ed = await browser.newPage(); await ed.setViewport({ width: 1300, height: 850 });
await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ connection: { where: "local", host: "", port: 5976, token: "" }, serverUrl: "http://127.0.0.1:5976" })); await wait(400);
await ed.reload(); await wait(800);
const errors = []; ed.on("pageerror", (e) => errors.push(e.message));

await ed.click("#flow-btn"); await wait(200);
t("the panel opens", await ed.$eval("#flow-panel", (e) => !e.classList.contains("hidden")));
t("sending is disabled while empty", await ed.$eval("#flow-send", (b) => b.disabled));

const kind = (k) => ed.click(`.flow-kind[data-kind="${k}"]`);
const rename = (text) => ed.evaluate((x) => { const c = window.__uiSketch.controller; const s = c.state.selection[0]; s.text = x; c.select([s.id], { expand: false }); }, text);
await kind("start"); await rename("User signs up");
await kind("decision"); await rename("Code correct?");
await kind("step"); await rename("Create account");          // first exit of the decision: Yes
await ed.evaluate(() => { const c = window.__uiSketch.controller; c.select([c.state.shapes.find((s) => s.flowKind === "decision").id], { expand: false }); });
await kind("step"); await rename("Show error");              // second exit: No
await ed.evaluate(() => { const c = window.__uiSketch.controller; c.select([c.state.shapes.find((s) => s.text === "Create account").id], { expand: false }); });
await kind("end"); await rename("Done");
await wait(500);

const shapes = await ed.evaluate(() => window.__uiSketch.controller.state.shapes.map((s) => ({ type: s.type, kind: s.flowKind, text: s.text, label: s.label })));
t("five blocks and four arrows were drawn", shapes.filter((s) => s.kind).length === 5 && shapes.filter((s) => s.type === "connector").length === 4);
t("the decision's exits are labelled Yes and No", shapes.filter((s) => s.type === "connector" && s.label).map((s) => s.label).join() === "Yes,No");
t("the panel shows the live summary", /5 blocks · 4 arrows/.test(await ed.$eval("#flow-summary", (e) => e.textContent)));
t("Mermaid preview is filled", /flowchart TD/.test(await ed.$eval("#flow-mermaid", (e) => e.textContent)));
t("a dead end that isn't marked End is reported", /"Show error" is a dead end/.test(await ed.$eval("#flow-issues", (e) => e.textContent)));
t("new blocks stay in view", await ed.evaluate(() => { const e = window.__uiSketch; const last = e.controller.state.shapes.filter((s) => s.flowKind).pop(); const b = e.engine.toScreen(last.x + last.w, last.y + last.h); return b.y < innerHeight - 80 && b.y > 0; }));

await ed.type("#flow-notes", "Lock the account after 3 wrong codes.");
await ed.click("#flow-send"); await wait(1200);
t("the status confirms", /Sent/.test(await ed.$eval("#flow-status", (e) => e.textContent)), await ed.$eval("#flow-status", (e) => e.textContent));
await ed.screenshot({ path: process.env.FLOW_SHOT || "/dev/null" });

// What the agent receives.
const got = await agent.callTool({ name: "get_latest_flow", arguments: {} });
const text = got.content.find((c) => c.type === "text").text;
t("the agent gets the user's explanation", text.includes("Lock the account after 3 wrong codes."));
t("and the Mermaid flowchart", text.includes('n2{"Code correct?"}') || /\{"Code correct\?"\}/.test(text));
t("with the Yes / No exits", /-->\|"Yes"\|/.test(text) && /-->\|"No"\|/.test(text));
t("and a picture", got.content.some((c) => c.type === "image"));

// A sloppy flow is reported honestly.
await ed.evaluate(() => { const c = window.__uiSketch.controller; const d = c.state.shapes.find((s) => s.flowKind === "decision"); c.state.shapes.filter((s) => s.type === "connector" && s.fromId === d.id && s.label === "No").forEach((s) => { s.label = ""; }); c.select([], {}); });
await ed.click("#flow-btn"); await ed.click("#flow-btn"); await wait(400);
t("missing exit labels show up as an issue", /without a label/.test(await ed.$eval("#flow-issues", (e) => e.textContent)));
await ed.click("#flow-send"); await wait(1000);
const again = (await agent.callTool({ name: "get_latest_flow", arguments: {} })).content[0].text;
t("and the agent is told about it", /exits without a label/.test(again));
t("no script errors", errors.length === 0, errors.join(" | "));

await browser.close(); await agent.close().catch(() => {});
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
