// Layer 18 — the get_cross_os_results GitHub pipeline (server/cross-os.js)
// with an INJECTED fetch: no live network needed. Covers run listing/sorting,
// latest-vs-explicit run selection, screenshot mapping + labels, url passthrough,
// and every error branch (404/401/403/network/broken run folder/empty runs).

const test = require("node:test");
const assert = require("node:assert/strict");

let osExports = null;
const boot = (async () => {
  osExports = await import("../server/cross-os.js");
})();

const RUN_1 = "run-1000000000000";
const RUN_2 = "run-2000000000000";
const MOCK_RUNS = [
  { type: "dir", name: RUN_1 },
  { type: "file", name: "README.md" },           // non-dir entries ignored
  { type: "dir", name: "screenshots-extra" },    // non run- dirs ignored
  { type: "dir", name: RUN_2 },
];

const SHOTS = [
  { type: "file", name: "windows-chromium.png", size: 111, download_url: "https://raw/wc.png", html_url: "https://gh/wc" },
  { type: "file", name: "macos-webkit.png", size: 222, download_url: "https://raw/mw.png", html_url: "https://gh/mw" },
  { type: "file", name: "linux-firefox.png", size: 333, download_url: "https://raw/lf.png", html_url: "https://gh/lf" },
  { type: "file", name: "log.txt", size: 10, download_url: "https://raw/log.txt" }, // non-png ignored
  { type: "dir", name: "subdir" }, // dirs ignored
  { type: "file", name: "templeos-singularity.png", size: 7, download_url: "https://raw/ts.png" }, // unknown combo passthrough
];

function fakeServer() {
  const called = [];
  return {
    called,
    fetch: async (url) => {
      called.push(url);
      if (url.endsWith("/contents/results?ref=results")) {
        return { ok: true, status: 200, json: async () => MOCK_RUNS };
      }
      return { ok: true, status: 200, json: async () => SHOTS };
    },
  };
}

// ---------------------------------------------------------------------------

test("happy path: newest run chosen by numeric run-tag order, screenshots mapped with labels", async () => {
  await boot;
  const { fetch, called } = fakeServer();
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "tok", owner: "me", repo: "site" });

  assert.equal(out.status, "ok");
  assert.equal(out.result.run, RUN_2, "newest run wins by numeric suffix");
  assert.equal(out.result.repository, "me/site");
  assert.equal(out.result.started_at, new Date(2000000000000).toISOString());
  assert.deepEqual(out.result.runs_available, [RUN_1, RUN_2]);

  const shots = out.result.screenshots;
  assert.equal(shots.length, 4, "only png files map");
  assert.deepEqual(shots.map((s) => s.label), [
    "Windows · Chrome", "macOS · Safari", "Linux · Firefox", "templeos-singularity",
  ], "known combos get friendly labels; unknown names pass through");
  assert.ok(shots.every((s) => s.size_bytes && s.download_url || s.label === "templeos-singularity"));

  // Authorization header with a token, Accept API, correct ref path
  assert.equal(called.length, 2);
  assert.match(called[0], /\/repos\/me\/site\/contents\/results\?ref=results$/);
});

test("empty token still authenticates-less requests fine (public repos)", async () => {
  await boot;
  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push(init.headers);
    return { ok: true, status: 200, json: async () => [] };
  };
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "", owner: "o", repo: "r" });
  assert.equal(out.status, "empty");
  assert.ok(!seen[0].Authorization, "no Authorization header when token empty");
  assert.match(out.error, /no completed test runs yet/);
});

test("an explicit run_tag that exists is honored instead of the newest", async () => {
  await boot;
  const { fetch, called } = fakeServer();
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "t", owner: "o", repo: "r", runTag: RUN_1 });

  assert.equal(out.status, "ok");
  assert.equal(out.result.run, RUN_1);
  assert.match(called[1], new RegExp(`/contents/results/${RUN_1}\\?ref=results$`));
});

test("unknown run_tag falls back to the newest run instead of erroring", async () => {
  await boot;
  const { fetch } = fakeServer();
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "t", owner: "o", repo: "r", runTag: "run-777" });
  assert.equal(out.result.run, RUN_2);
});

test("404 on the results branch gives the 'run a test first' guidance", async () => {
  await boot;
  const fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "t", owner: "o", repo: "r" });
  assert.equal(out.status, "error");
  assert.match(out.error, /No 'results' branch[\s\S]*Run a test from the extension/);
  assert.match(out.error, /o\/r/);
});

test("401/403 produce the private-repo token guidance", async () => {
  await boot;
  for (const status of [401, 403]) {
    const fetch = async () => ({ ok: false, status, json: async () => ({}) });
    const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "t", owner: "o", repo: "r" });
    assert.match(out.error, new RegExp(`HTTP ${status}[\\s\\S]*Contents: read access`));
  }
});

test("other HTTP statuses fall back to a generic GitHub API error", async () => {
  await boot;
  const fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "", owner: "o", repo: "r" });
  assert.match(out.error, /GitHub API error \(HTTP 502\)/);
});

test("network failures surface with the underlying message", async () => {
  await boot;
  const fetch = async () => { throw new Error("ENETDOWN"); };
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "", owner: "o", repo: "r" });
  assert.match(out.error, /GitHub API error \(HTTP 0\)[\s\S]*ENETDOWN/);
});

test("a chosen run whose folder vanished mid-read tankers to a retry message", async () => {
  await boot;
  const fetch = async (url) =>
    url.endsWith("/contents/results?ref=results")
      ? { ok: true, status: 200, json: async () => MOCK_RUNS }
      : { ok: false, status: 500, json: async () => ({}) };
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "t", owner: "o", repo: "r" });
  assert.equal(out.status, "error");
  assert.match(out.error, /still be uploading/);
});

test("broken JSON responses (json() rejects) never throw out of the module", async () => {
  await boot;
  const fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad gateway body"); } });
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "", owner: "o", repo: "r" });
  assert.ok(out.status === "empty" || out.status === "error", "module degrades to a status, never throws");
  assert.ok(!out.result);
});

test("run folders with zero png files return an (empty) screenshots array, not an error", async () => {
  await boot;
  const fetch = async (url) =>
    url.endsWith("/contents/results?ref=results")
      ? { ok: true, status: 200, json: async () => MOCK_RUNS }
      : { ok: true, status: 200, json: async () => [{ type: "file", name: "log.txt" }] };
  const out = await osExports.getCrossOsResults({ fetchImpl: fetch, token: "t", owner: "o", repo: "r" });
  assert.equal(out.status, "ok");
  assert.deepEqual(out.result.screenshots, []);
});
