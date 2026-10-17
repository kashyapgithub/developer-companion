/**
 * lib/os-test.js — Cross-OS Test bridge for the unified background worker.
 *
 * Ported from the standalone "website-cross-operating-system-testing"
 * extension's background.js into Developer Companion's single service
 * worker. Responsibilities:
 *
 *   1. Read saved GitHub credentials from chrome.storage.local (falling
 *      back to the GitHub Dashboard feature's token when the tester's own
 *      PAT is not set).
 *   2. Fire a `repository_dispatch` event to kick off the Actions workflow.
 *   3. Poll the repo's `results` branch until each OS's screenshot exists.
 *   4. Stream each result back to the studio page AS IT ARRIVES over a
 *      long-lived port, instead of waiting for all three and returning
 *      once.
 *
 * Kept in its own module on purpose: a poll can run for several minutes,
 * and doing the work in the service worker means it keeps going even if
 * the user closes the studio window and reopens it later (the port just
 * reconnects).
 */

const GITHUB_API = "https://api.github.com";

const ALL_TEST_COMBINATIONS = [
  { os: "windows", browser: "chromium", label: "Windows · Chrome" },
  { os: "windows", browser: "firefox", label: "Windows · Firefox" },
  { os: "windows", browser: "webkit", label: "Windows · WebKit" },
  { os: "macos", browser: "webkit", label: "macOS · Safari" },
  { os: "macos", browser: "chromium", label: "macOS · Chrome" },
  { os: "macos", browser: "firefox", label: "macOS · Firefox" },
  { os: "linux", browser: "chromium", label: "Linux · Chrome" },
  { os: "linux", browser: "firefox", label: "Linux · Firefox" },
  { os: "linux", browser: "webkit", label: "Linux · WebKit" },
];

const TEST_COMBINATIONS = ALL_TEST_COMBINATIONS;

const getActiveCombinations = (browsers) => {
  if (Array.isArray(browsers) && browsers.length > 0) {
    return ALL_TEST_COMBINATIONS.filter((combo) => browsers.includes(combo.browser));
  }
  // Default to chromium across the 3 OSes if not specified for backwards compatibility
  return ALL_TEST_COMBINATIONS.filter((combo) => combo.browser === "chromium");
};

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * Credentials for the tester tool: its own githubPat when saved, otherwise
 * the token the GitHub Dashboard feature stores under its merged `settings`
 * object (settings.githubToken). Owner/repo must always come from the
 * tester's own settings — they name the target repo with the workflow.
 */
const getCredentials = async () => {
  const { githubPat, repoOwner, repoName, settings } = await chrome.storage.local.get([
    "githubPat",
    "repoOwner",
    "repoName",
    "settings",
  ]);
  const pat = githubPat || settings?.githubToken || "";
  const hasAllFields = Boolean(pat && repoOwner && repoName);
  return hasAllFields ? { githubPat: pat, repoOwner, repoName } : null;
};

const triggerWorkflow = async (credentials, opts) => {
  const { githubPat, repoOwner, repoName } = credentials;
  const testMode = opts.testMode || (opts.targetUrl ? "url" : "repo");
  const targetUrl = opts.targetUrl || "";
  const repoPath = opts.repoPath || "index.html";
  const runTag = opts.runTag;
  const fullPage = opts.fullPage !== false;
  const browsers = Array.isArray(opts.browserList) && opts.browserList.length > 0 ? opts.browserList.join(",") : "chromium";

  let response;
  try {
    response = await fetch(`${GITHUB_API}/repos/${repoOwner}/${repoName}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubPat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "cross-os-test",
        client_payload: {
          test_mode: testMode,
          target_url: targetUrl,
          repo_path: repoPath,
          run_tag: runTag,
          full_page: fullPage,
          browsers,
        },
      }),
    });
  } catch (err) {
    throw new Error(`Network failure connecting to GitHub: ${err.message}`);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("GitHub rejected credentials (401 Unauthorized). Verify your token in Cross-OS settings ⚙.");
    }
    if (response.status === 403) {
      throw new Error("GitHub rejected the trigger (403 Forbidden). Ensure your PAT has Actions: Read & write and Contents: Read & write permissions.");
    }
    if (response.status === 404) {
      throw new Error(`Repository ${repoOwner}/${repoName} not found (404). Check owner and repo names in Cross-OS settings.`);
    }
    throw new Error(`GitHub rejected the trigger (${response.status}). Check the PAT's permissions.`);
  }
};

/**
 * Deliberately returns a data: URL, not a blob: URL from
 * URL.createObjectURL(). Blob URLs are scoped to the execution context
 * that created them — a service worker and a studio page are different
 * contexts in MV3, so a blob: URL made here would be dead on arrival in
 * studio.js.
 */
const tryFetchScreenshot = async ({ githubPat, repoOwner, repoName }, path) => {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${repoOwner}/${repoName}/contents/${path}?ref=results`,
      {
        headers: {
          Authorization: `Bearer ${githubPat}`,
          Accept: "application/vnd.github.raw",
        },
      }
    );

    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    return `data:image/png;base64,${arrayBufferToBase64(arrayBuffer)}`;
  } catch {
    // Transient network drop during polling should not crash the poll loop
    return null;
  }
};

/**
 * Converts raw bytes to base64. Service workers have no FileReader, so this
 * goes through btoa() manually — chunked (not one byte at a time) because a
 * long full-page screenshot can be several MB, and String.fromCharCode
 * called once per byte gets noticeably slow at that size. Chunking also
 * avoids the classic String.fromCharCode.apply(null, hugeArray) stack
 * overflow some naive implementations hit on large inputs.
 */
const arrayBufferToBase64 = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK_SIZE = 8192;
  const chunks = [];

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE)));
  }

  return btoa(chunks.join(""));
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pollAndStream = async (port, credentials, runTag, isAborted, activeCombinations = TEST_COMBINATIONS) => {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const found = new Set();

  while (Date.now() < deadline && found.size < activeCombinations.length && !isAborted()) {
    const pending = activeCombinations.filter((combo) => !found.has(combo.label));

    await Promise.all(
      pending.map(async (combo) => {
        const path = `results/${runTag}/${combo.os}-${combo.browser}.png`;
        const imageUrl = await tryFetchScreenshot(credentials, path);
        if (!imageUrl || isAborted()) return;

        found.add(combo.label);
        port.postMessage({ type: "COMBO_READY", label: combo.label, imageUrl, os: combo.os, browser: combo.browser });
      })
    );

    if (found.size < activeCombinations.length && !isAborted()) await wait(POLL_INTERVAL_MS);
  }

  // Studio window closed before we finished — nothing left to tell it, and
  // posting to a disconnected port would just throw. Stop quietly instead
  // of burning the rest of the 6-minute budget on API calls nobody watches.
  if (isAborted()) return;

  const timedOut = found.size < activeCombinations.length;
  port.postMessage({ type: "RUN_FINISHED", timedOut });
};

const handleConnection = (port) => {
  let aborted = false;
  port.onDisconnect.addListener(() => {
    aborted = true;
  });

  port.onMessage.addListener(async (message) => {
    if (message.type !== "START") return;

    const credentials = await getCredentials();
    if (!credentials) {
      port.postMessage({ type: "ERROR", error: "MISSING_CREDENTIALS" });
      return;
    }

    const runTag = `run-${Date.now()}`;
    const activeCombinations = getActiveCombinations(message.browsers);
    const browserList = [...new Set(activeCombinations.map((c) => c.browser))];

    try {
      port.postMessage({ type: "TRIGGERED", combinations: activeCombinations });
      await triggerWorkflow(credentials, {
        testMode: message.testMode || "url",
        targetUrl: message.targetUrl,
        repoPath: message.repoPath,
        runTag,
        fullPage: message.fullPage,
        browserList,
      });
      await pollAndStream(port, credentials, runTag, () => aborted, activeCombinations);
    } catch (err) {
      // The port may already be gone if the studio closed mid-request —
      // guard the error report itself so that case doesn't throw a second,
      // uglier error on top of the first.
      if (!aborted) {
        try {
          port.postMessage({ type: "ERROR", error: err.message });
        } catch {
          // Port died between the abort flag and this call — nothing to do.
        }
      }
    }
  });
};

/**
 * Registers the port handler on the unified background worker. Call once
 * at import time from background.js.
 */
export function initOsTestBridge() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "cross-os-test") handleConnection(port);
  });
}
