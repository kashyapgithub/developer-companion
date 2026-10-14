/**
 * design-tokens.test.mjs — read a live page's look as tokens: via the agent tool and via the editor menu's message.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { launch, ROOT } from "../helpers/launch.mjs";
const { Client } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
const { StdioClientTransport } = await import(ROOT + "/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const client = new Client({ name: "agent", version: "1" });
await client.connect(new StdioClientTransport({ command: "node", args: [ROOT + "/server/server.js"], env: { ...process.env, PORT: "5994", STORE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "dc-tok-")) } }));
const { browser, id } = await launch();
const page = await browser.newPage(); await page.goto("http://127.0.0.1:8777/page");
await page.evaluate(() => { const s = document.createElement("style"); s.textContent = ":root{--brand:#e8590c;--gap:12px}"; document.head.appendChild(s); });
const ed = await browser.newPage(); await ed.goto(`chrome-extension://${id}/editor/editor.html`); await wait(800);
await ed.evaluate(() => chrome.storage.local.set({ serverUrl: "http://127.0.0.1:5994" })); await wait(1500);
await page.bringToFront(); await wait(800);

const r = JSON.parse((await client.callTool({ name: "get_design_tokens", arguments: {} }, undefined, { timeout: 60000 })).content[0].text);
t("agent gets tokens for the page", !!r.tokens && /127\.0\.0\.1/.test(r.page.url));
t("accent is the button's orange", r.tokens.roles.accent === "#e8590c", r.tokens.roles.accent);
t("the 8px radius is found", r.tokens.radii.some((x) => x.radius === "8px"));
t("the button shadow is found", r.tokens.shadows.length >= 1);
t("the 18px button text size is found", r.tokens.fonts.sizes.some((x) => x.size === "18px"));
t("the site's own CSS variables come along", r.tokens.existing_css_variables["--brand"] === "#e8590c");
t("ready-to-paste CSS and Tailwind are included", /--color-accent: #e8590c/.test(r.css) && /module\.exports/.test(r.tailwind));

// The editor menu path: same tokens through the background message.
const m = await ed.evaluate(() => chrome.runtime.sendMessage({ type: "DESIGN_TOKENS" }));
t("editor menu path returns tokens + CSS", m?.ok === true && /--color-accent/.test(m.css), JSON.stringify(m).slice(0, 80));
t("menu has the new item", await ed.$eval("[data-shot='tokens']", (b) => /design tokens/i.test(b.textContent)));

await browser.close(); await client.close();
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
