/**
 * launch.mjs — starts a real Chromium with the real extension loaded.
 *
 * The extension is copied to a temp folder first, with its manifest widened to
 * all sites, because tests can't click Chrome's permission prompts. Set
 * CHROMIUM_PATH to use a specific Chromium (branded Chrome 137+ ignores
 * --load-extension, so use Chromium proper).
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { ROOT } from "./paths.mjs";
import { startStatic } from "./static.mjs";

export { ROOT, startStatic };
export const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

/** Copies the extension (minus .git, node_modules, tests) and grants it all-site access. */
function makeExtensionCopy() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "dc-ext-"));
  execSync(`cd "${ROOT}" && tar --exclude=.git --exclude=node_modules --exclude=test -cf - . | tar -xf - -C "${dest}"`);
  const file = path.join(dest, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  manifest.host_permissions = ["<all_urls>"];
  delete manifest.optional_host_permissions;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return dest;
}

/** Plain Chromium, no extension (for pure-UI tests of the editor page). */
export function launchPlain() {
  startStatic();
  return puppeteer.launch({ executablePath: CHROMIUM, headless: true, args: ["--no-sandbox"] });
}

/** Chromium with the extension. Resolves to { browser, id } (id = the extension id). */
export async function launch() {
  startStatic();
  const ext = makeExtensionCopy();
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM, headless: true,
    args: ["--no-sandbox", "--disable-background-networking", "--no-first-run", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=1280,800"],
  });
  const worker = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes("background.js"), { timeout: 20000 });
  return { browser, id: new URL(worker.url()).host };
}
