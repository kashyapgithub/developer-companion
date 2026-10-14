/**
 * tab-capture-window.test.mjs — "Capture this tab" when the editor is in its OWN window
 * (no web page beside it). It must find the page in the other window instead of failing.
 */
import { launch } from "../helpers/launch.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, id } = await launch(); const R = []; const t = (n, c, x = "") => R.push([c, n + (x ? " — " + x : "")]);
const page = await browser.newPage(); await page.setViewport({ width: 1000, height: 700 }); await page.goto("http://127.0.0.1:8777/page");
const boot = await browser.newPage(); await boot.goto(`chrome-extension://${id}/editor/editor.html`); await wait(600);
// Open the editor in a separate popup window, the way an app-style window would.
await boot.evaluate((u) => chrome.windows.create({ url: u, type: "popup", width: 1100, height: 800 }), `chrome://extensions/`.replace("chrome://extensions/", `chrome-extension://${id}/editor/editor.html?win=1`));
let ed = null; for (let i = 0; i < 30 && !ed; i++) { await wait(300); ed = (await browser.pages()).find((p) => p.url().includes("win=1")); }
t("editor opened in its own window", !!ed);
await boot.close(); await wait(300);
await ed.bringToFront(); await wait(500);
const res = await ed.evaluate(() => chrome.runtime.sendMessage({ type: "CAPTURE_TAB" }));
t("capture finds the page in the other window", res?.ok === true && /8777\/page/.test(res.url || ""), res?.error || res?.url);
await browser.close();
for (const [c, n] of R) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(0);
