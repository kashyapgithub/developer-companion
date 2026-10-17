// -----------------------------------------------------------------------------
// capture.js
//
// A single, OS-agnostic script: it takes the target URL, output path, and
// capture mode from environment variables (set differently per-OS by the
// workflow) and produces one screenshot — full page or viewport-only,
// depending on what the extension's toggle sent. Any rendering differences
// between the resulting images across the matrix ARE the cross-OS visual
// differences you're checking for — same script, same browser engine,
// different real hardware.
// -----------------------------------------------------------------------------

const { chromium, firefox, webkit } = require("playwright");

const TARGET_URL = process.env.TARGET_URL;
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? "screenshot-output.png";
const BROWSER_TYPE = (process.env.BROWSER || "chromium").toLowerCase();

const BROWSERS = { chromium, firefox, webkit };

// GitHub Actions passes booleans through client_payload as the strings
// "true"/"false" (JSON booleans get stringified for env vars), so this
// compares against the string explicitly rather than truthiness. Defaults
// to true (full page) if the value is missing for any reason.
const CAPTURE_FULL_PAGE = process.env.FULL_PAGE !== "false";

// A fixed viewport keeps screenshots comparable across OSes — otherwise a
// difference in default window size would look like a rendering bug.
const VIEWPORT = { width: 1440, height: 900 };

/** Guards against running with no target — fails loudly instead of silently. */
const assertTargetUrlProvided = () => {
  if (!TARGET_URL) {
    throw new Error("TARGET_URL environment variable is required.");
  }
};

/** Launches the specified browser, navigates to the target, and saves a screenshot. */
const captureScreenshot = async () => {
  const launcher = BROWSERS[BROWSER_TYPE];
  if (!launcher) {
    throw new Error(`Unsupported browser: "${BROWSER_TYPE}". Supported browsers: ${Object.keys(BROWSERS).join(", ")}`);
  }

  // Recommended container/CI flags for Chromium
  const launchOptions = {};
  if (BROWSER_TYPE === "chromium") {
    launchOptions.args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
  }

  const browser = await launcher.launch(launchOptions);
  // ignoreHTTPSErrors: true allows testing staging sites, local dev tunnels, and self-signed certs
  const context = await browser.newContext({
    viewport: VIEWPORT,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  let navigationFailed = false;
  let navigationError = null;

  try {
    // Attempt standard page load with 35s timeout
    try {
      await page.goto(TARGET_URL, { waitUntil: "load", timeout: 35_000 });
      // Best-effort wait for network to settle, up to 4s
      await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
    } catch (err) {
      console.warn(`Initial load wait failed (${err.message}). Checking if page rendered partially...`);
      navigationError = err;

      // If page URL is still about:blank or totally failed, mark as failed navigation
      const currentUrl = page.url();
      if (!currentUrl || currentUrl === "about:blank") {
        navigationFailed = true;
      } else {
        // Page has started rendering; wait 2s for stabilization
        await page.waitForTimeout(2_000).catch(() => {});
      }
    }

    if (navigationFailed) {
      console.warn("Navigation completely failed. Generating error diagnostic screenshot...");
      const safeUrl = String(TARGET_URL).replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const safeMsg = String(navigationError?.message || "Unknown navigation error").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body { margin: 0; background: #121318; color: #edeef2; font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; }
            .card { background: #1d1f27; border: 1px solid #333745; border-radius: 12px; padding: 2.5rem; max-width: 640px; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
            h2 { color: #f87171; margin: 0 0 0.8rem; font-size: 1.35rem; display: flex; align-items: center; gap: 0.5rem; }
            p { color: #9aa0b4; font-size: 0.95rem; line-height: 1.5; margin: 0.5rem 0; word-break: break-all; }
            .url-tag { font-family: monospace; background: #0c0d12; border: 1px solid #2a2e3b; padding: 0.4rem 0.6rem; border-radius: 6px; color: #6fe3c4; display: block; margin: 0.75rem 0; font-size: 0.85rem; }
            .error-box { font-family: monospace; background: rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding: 0.6rem 0.8rem; border-radius: 4px; color: #fca5a5; font-size: 0.8rem; margin-top: 1rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>⚠️ Page Navigation Failed</h2>
            <p>The runner could not reach the target URL:</p>
            <div class="url-tag">${safeUrl}</div>
            <div class="error-box">${safeMsg}</div>
          </div>
        </body>
        </html>
      `;
      await page.setContent(errorHtml);
      await page.screenshot({ path: OUTPUT_PATH, fullPage: false });
      return;
    }

    // Wait for web fonts to complete rendering (max 3s)
    await Promise.race([
      page.evaluate(() => document.fonts?.ready),
      new Promise((res) => setTimeout(res, 3_000)),
    ]).catch(() => {});

    // Try full-page screenshot if requested, falling back to viewport on canvas buffer error
    try {
      await page.screenshot({ path: OUTPUT_PATH, fullPage: CAPTURE_FULL_PAGE });
    } catch (shotErr) {
      console.warn(`Full-page capture failed (${shotErr.message}), falling back to viewport capture...`);
      await page.screenshot({ path: OUTPUT_PATH, fullPage: false });
    }
  } finally {
    await browser.close().catch(() => {});
  }
};

const main = async () => {
  assertTargetUrlProvided();
  await captureScreenshot();
  console.log(`Screenshot saved to ${OUTPUT_PATH}`);
};

main().catch((err) => {
  console.error("Capture failed:", err.message);
  process.exit(1);
});
