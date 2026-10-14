/**
 * handoff.test.mjs — real flow: server A holds a session; the editor's Export button downloads it;
 * server B (empty) gets it through Import; the agent on B can read it. Also the export_handoff MCP tool.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const storeA = fs.mkdtempSync(path.join(os.tmpdir(), "dc-hoA-")); const storeB = fs.mkdtempSync(path.join(os.tmpdir(), "dc-hoB-"));
const mcp = async (port, store) => { const c = new Client({ name: "agent", version: "1" }); await c.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: String(port), STORE_DIR: store } })); return c; };
const agentA = await mcp(5981, storeA); const agentB = await mcp(5982, storeB);
await wait(1000);
const post = (port, p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
await post(5981, "/xray", { page: { url: "http://x", title: "T" }, elements: [{ selector: "button#save", screenshot: PNG }] });
await post(5981, "/inspiration/folders", { name: "Landing pages" });
const folder = (await (await fetch("http://127.0.0.1:5981/inspiration")).json()).folders[0];
await post(5981, "/inspiration/items", { dataUrl: PNG, title: "Stripe hero", folder: folder.id });

// The editor, connected to A, downloads the bundle.
const { browser, id } = await launch();
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
const client = await ed.target().createCDPSession();
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-dl-"));
await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir, eventsEnabled: true }).catch(() => client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir }));
await ed.evaluate(() => chrome.storage.local.set({ connection: { where: "local", host: "", port: 5981, token: "" }, serverUrl: "http://127.0.0.1:5981" })); await wait(500);
await ed.evaluate(() => document.getElementById("handoff-export-btn").click());
let file = null; for (let i = 0; i < 40 && !file; i++) { await wait(250); file = fs.readdirSync(dlDir).find((f) => f.endsWith(".json")); }
t("Export handoff downloads a json file", !!file, file);
const bundle = JSON.parse(fs.readFileSync(path.join(dlDir, file), "utf8"));
t("bundle holds the X-ray and the inspiration image", bundle.xray.doc.elements.length === 1 && bundle.inspiration.items.length === 1);
t("status line tells the user", /saved/i.test(await ed.$eval("#screenshot-status", (e) => e.textContent)));

// Point the editor at B and import through the real file input.
await ed.evaluate(() => chrome.storage.local.set({ connection: { where: "local", host: "", port: 5982, token: "" } })); await wait(500);
const input = await ed.$("#handoff-file"); await input.uploadFile(path.join(dlDir, file)); await wait(2000);
const status = await ed.$eval("#screenshot-status", (e) => e.textContent);
t("Import handoff reports what came in", /Imported: .*X-ray elements.*inspiration images/.test(status), status);

// The agent on B now sees the session.
const xr = await agentB.callTool({ name: "get_selected_elements", arguments: {} });
const x = xr.content.map((c) => c.text || "").join(" ");
const libB = await (await fetch("http://127.0.0.1:5982/inspiration")).json();
t("server B has the folder and image", libB.folders[0]?.name === "Landing pages" && libB.items[0]?.title === "Stripe hero");
t("server B's X-ray is back", x.includes("button#save"));
t("a non-handoff file is refused with a clear message", await (async () => {
  fs.writeFileSync(path.join(dlDir, "bad.json"), '{"hello":1}');
  await (await ed.$("#handoff-file")).uploadFile(path.join(dlDir, "bad.json")); await wait(1200);
  return /isn't a Developer Companion/.test(await ed.$eval("#screenshot-status", (e) => e.textContent));
})());

// The MCP tool writes the same bundle to a file the agent can hand over.
const r = JSON.parse((await agentA.callTool({ name: "export_handoff", arguments: { include_inspiration: false } })).content[0].text);
t("export_handoff tool writes a file and lists contents", fs.existsSync(r.file) && r.contains.xray_elements === 1 && r.contains.inspiration_images === 0, JSON.stringify(r.contains));

await browser.close(); await agentA.close(); await agentB.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
