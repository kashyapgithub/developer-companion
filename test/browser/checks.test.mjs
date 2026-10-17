/**
 * checks.test.mjs — acceptance checks in a real tab: an agent calls run_checks with Given/When/Then text,
 * the extension clicks and types with real input events, and failures come back with evidence.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "t", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5985", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-chk-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/shop");
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5985" })); await wait(1500);
await page.bringToFront();

const run = async (args) => { const r = await client.callTool({ name: "run_checks", arguments: args }, undefined, { timeout: 120000 }); return { r, data: JSON.parse(r.content[0].text) }; };

let { data } = await run({ scenarios: `Scenario: Sign in works
Given I open /shop
When I type "a@b.co" into #email
And I click "Sign in"
Then I see "Welcome back"
And the url contains /dashboard
And POST /api/login returned 200
And there are no console errors` });
t("a correct sign-in flow passes with real clicks and typing", data.passed === 1, JSON.stringify(data.results?.[0]?.steps?.filter((s) => s.status !== "passed")));

({ data } = await run({ scenarios: `Scenario: Enter key submits
Given I open /shop
When I type "a@b.co" into #email
And I press Enter
Then I see "Welcome back"` }));
t("pressing Enter works", data.passed === 1, JSON.stringify(data.results?.[0]?.steps));

let res = await run({ timeout_ms: 1200, scenarios: `Scenario: Wrong email
Given I open /shop
When I type "nope@x.io" into #email
And I click "Sign in"
Then I see "Welcome back"
And the url contains /dashboard` });
const bad = res.data.results[0];
t("a wrong sign-in fails at the right step", res.data.failed === 1 && bad.failedStep === 'I see "Welcome back"' && bad.steps[4].status === "skipped");
t("evidence: failed request with its status", bad.evidence.failedRequests.some((q) => /api\/login/.test(q.url) && q.status === 401), JSON.stringify(bad.evidence.failedRequests));
t("evidence: what the page said instead", /Wrong email/.test(bad.evidence.textSnippet));
t("evidence: a screenshot arrives as an image", res.r.content.some((c) => c.type === "image"));

({ data } = await run({ timeout_ms: 800, scenarios: `Scenario: No errors
Given I open /shop
When I click "Explode"
Then there are no console errors` }));
t("console errors are caught", data.failed === 1 && /boom happened/.test(JSON.stringify(data.results[0])), JSON.stringify(data.results[0].steps));

({ data } = await run({ timeout_ms: 800, checks: [{ name: "structured", steps: [{ do: "goto", url: "/shop" }, { do: "click", selector: "#nope" }] }] }));
t("a missing element is a clear failure", /No element matches #nope/.test(JSON.stringify(data.results[0].steps)));

({ data } = await run({ checks: [{ name: "off-site", steps: [{ do: "goto", url: "https://example.com/" }] }] }));
t("going off the allowed sites is refused", /allowed/.test(JSON.stringify(data.results[0].steps)));

res = await client.callTool({ name: "run_checks", arguments: { scenarios: "Given juggle" } });
t("an unreadable scenario explains itself", /Couldn't read/.test(res.content[0].text));

// recording -> check
await client.callTool({ name: "start_recording", arguments: {} });
await client.callTool({ name: "interact_with_page", arguments: { action: "navigate", url: "http://127.0.0.1:8777/shop" } });
await client.callTool({ name: "interact_with_page", arguments: { action: "click", selector: "#go" } });
await client.callTool({ name: "stop_recording", arguments: {} }); await wait(800);
const draft = (await client.callTool({ name: "checks_from_recording", arguments: {} })).content[0].text;
t("a recording becomes a draft scenario", /Given I open \/shop/.test(draft) && /I click/.test(draft) && /no console errors/.test(draft), draft.slice(0, 200));

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
