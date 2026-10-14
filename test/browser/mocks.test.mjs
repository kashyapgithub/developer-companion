/** mocks.test.mjs — the agent fakes API responses (error, slow, failing), then switches them off. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5998", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-mock-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/page");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5998" })); await wait(1500);
await page.bringToFront(); await wait(1500);
const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 }); try { return JSON.parse(r.content[0].text); } catch { return { raw: r.content[0].text }; } };
/** Fetches from inside the page; returns {status, text} or {error}. */
const get = (url, init) => page.evaluate(async (u, i) => { try { const r = await fetch(u, i); return { status: r.status, text: await r.text(), mock: r.headers.get("x-developer-companion-mock") }; } catch (e) { return { error: String(e) }; } }, url, init);

await get("/api/ok"); await wait(500);                                    // a real call to record
t("real response before mocking", (await get("/api/ok")).status === 200);

let r = await call("set_mock", { url_contains: "/api/ok", status: 503, body: { error: "maintenance" } });
t("mock added", r.added?.status === 503, JSON.stringify(r).slice(0, 80));
let g = await get("/api/ok");
t("page now gets the fake 503", g.status === 503 && JSON.parse(g.text).error === "maintenance" && !!g.mock, JSON.stringify(g).slice(0, 100));
t("other URLs untouched", (await get("/api/fail")).status === 500 && (await get("/page")).status === 200);
t("hit counter goes up", (await call("list_mocks")).active[0].hits >= 1);

await call("clear_mocks");
t("clearing restores the real API", (await get("/api/ok")).status === 200 && JSON.parse((await get("/api/ok")).text).items.length === 3);

await call("set_mock", { url_contains: "/api/ok", fail: true });
t("fail:true looks like a dropped connection", !!(await get("/api/ok")).error);
await call("clear_mocks");

await call("set_mock", { url_contains: "/api/ok", body: { items: [] }, delay_ms: 800 });
const t0 = Date.now(); g = await get("/api/ok");
t("delay_ms makes it slow", Date.now() - t0 >= 700 && JSON.parse(g.text).items.length === 0, String(Date.now() - t0));
await call("clear_mocks");

await get("/api/ok?rec=1"); await wait(600);
r = await call("set_mock", { url_contains: "rec=1", from_recorded: true, status: 404 });
g = await get("/api/ok?rec=1");
t("from_recorded copies the real body but overrides status", g.status === 404 && /items/.test(g.text), JSON.stringify(g).slice(0, 100));
await call("clear_mocks");

r = await call("set_mock", { url_contains: "/nothing-recorded-here", from_recorded: true });
t("from_recorded with nothing recorded explains itself", /No recorded response/.test(JSON.stringify(r)), JSON.stringify(r).slice(0, 80));
r = await call("set_mock", { url_contains: "/a", status: 42 });
t("invalid status refused", /invalid|100|599|Too small/i.test(JSON.stringify(r)));

await call("set_mock", { url_contains: "/api/ok", status: 418 }); await call("clear_mocks", { id: "nope" });
t("clearing an unknown id leaves the mock", (await get("/api/ok")).status === 418);
await call("clear_mocks");

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
