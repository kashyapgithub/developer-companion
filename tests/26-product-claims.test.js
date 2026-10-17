// Layer 26 — "the UI says it, the product covers it".
// The canvas button promises: «Test the current page on Windows, macOS &
// Linux — real Chrome, Firefox & Safari … free GitHub Actions runners».
// Settings promises a PAT link with scopes=repo. Everything numeric named in
// UI copy (ports, OS labels, browser names) is cross-checked against the
// engine (lib/os-test.js), the workflow (workflow-assets/*.yml) and the
// server (server/config.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { rootPath } = require("./helpers");

const editorHtml = fs.readFileSync(rootPath("editor/editor.html"), "utf8");
const osTestSrc = fs.readFileSync(rootPath("lib/os-test.js"), "utf8");
const workflowYml = fs.readFileSync(rootPath("os-test/workflow-assets/screenshot-test.yml"), "utf8");
const settingsHtml = fs.readFileSync(rootPath("os-test/settings.html"), "utf8");

const COMBIATIONS = (() => {
  // extract the ALL_TEST_COMBINATIONS matrix from lib/os-test.js (3×3 entries)
  const m = osTestSrc.match(/const\s+ALL_TEST_COMBINATIONS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(m, "ALL_TEST_COMBINATIONS matrix exists in lib/os-test.js");
  return m[1];
})();
const COMBOS = [...COMBIATIONS.matchAll(/os:\s*"(\w+)"/g)].map((x) => x[1]);
const BROWSERS = [...osTestSrc.matchAll(/browser:\s*"(\w+)"/g)].map((x) => x[1]);

test("tooltip promise: a matrix cell exists for every promised OS", () => {
  assert.match(editorHtml, /Test the current page on Windows, macOS & Linux/);
  for (const os of ["windows", "macos", "linux"]) {
    assert.ok(COMBOS.includes(os), `engine covers ${os}`);
  }
});

test("tooltip promise: every promised browser family is wired in the engine", () => {
  assert.match(editorHtml, /Chrome, Firefox & Safari/);
  // Chrome→chromium, Firefox→firefox, Safari→webkit (engine spellings)
  for (const b of ["chromium", "firefox", "webkit"]) {
    assert.ok(BROWSERS.includes(b), `engine runs ${b}`);
  }
});

test("Safari is the honest label for webkit on macOS (users never see 'webkit')", () => {
  const rows = [...COMBIATIONS.matchAll(/\{[^}]+\}/g)].map((r) => r[0]);
  const macOSWebkit = rows.find((r) => /os:\s*"macos"/.test(r) && /browser:\s*"webkit"/.test(r));
  assert.ok(macOSWebkit, "macOS·webkit row exists");
  assert.match(macOSWebkit, /Safari/, "macOS·webkit is labelled Safari");
});

test("a full 3×3 matrix: every promised combination exists", () => {
  assert.equal(COMBOS.length, 9, "9 combos = 3 OS × 3 browsers");
  const pairs = new Set();
  for (const m of osTestSrc.matchAll(/os:\s*"(\w+)",\s*browser:\s*"(\w+)"/g)) {
    pairs.add(`${m[1]}/${m[2]}`);
  }
  const expect = [];
  for (const os of ["windows", "macos", "linux"]) for (const b of ["chromium", "firefox", "webkit"]) expect.push(`${os}/${b}`);
  const missing = expect.filter((p) => !pairs.has(p));
  assert.deepEqual(missing, [], "complete matrix");
});

test("workflow engine parity: the GH Action knows the same OS and browser vocabulary", () => {
  for (const os of ["windows", "macos", "linux"]) {
    assert.match(workflowYml, new RegExp(`${os}`), `yml maps runner → ${os}`);
  }
  assert.match(workflowYml, /chromium,firefox,webkit/, "yml default browser list matches the engine's families");
  for (const runner of ["windows-latest", "macos-latest", "ubuntu-latest"]) {
    assert.match(workflowYml, new RegExp(runner.replace("-", "\\-")), `${runner} is a hosted (free-tier) runner — supports the 'free' promise`);
  }
  assert.doesNotMatch(workflowYml, /self-hosted/, "no paid/self-hosted runners behind the 'free' claim");
});

test("settings promise: the PAT link lands on the right page with the right scopes", () => {
  const m = settingsHtml.match(/href="(https:\/\/github\.com\/settings\/tokens\/new[^"]*)"/);
  assert.ok(m, "one-tap PAT creation link exists");
  const url = new URL(m[1].replace(/&amp;/g, "&"));
  assert.equal(url.hostname, "github.com");
  assert.match(url.pathname, /settings\/tokens\/new/);
  const scopes = url.searchParams.get("scopes") || "";
  assert.ok(scopes.split(",").includes("repo"), `link requests the repo scope (got: '${scopes}')`);
  assert.ok(url.searchParams.get("description"), "the PAT carries a recognisable description name");
});

test("port contract: every place that names the default port says 5959", () => {
  const PORT_SITES = [
    "editor/modules/connection.js",
    "logs/options.js",
    "lib/log-sender.js",
    "overlay/overlay.js",
    "server/config.js",
    "server/server.js",
  ];
  for (const rel of PORT_SITES) {
    const src = fs.readFileSync(rootPath(rel), "utf8");
    assert.match(src, /5959/, `${rel} speaks about port 5959`);
  }
  // and no page silently disagrees with the server default
  const serverSrc = fs.readFileSync(rootPath("server/server.js"), "utf8");
  const fallback = (serverSrc.match(/\|\|\s*(\d{4,5})(?!\.\d)/) || [])[1];
  assert.equal(fallback, "5959", "server listens on 5959 when no env config");
  const cfg = fs.readFileSync(rootPath("server/config.js"), "utf8");
  assert.match(cfg, /port:\s*5959/, "config normalization defaults to 5959");
});

test("tooltip promise context: the button really routes into the cross-os engine", () => {
  // companion-bridge wires the tooltip'd button to OPEN_CROSS_OS_TESTER (runtime-verified in layer 21);
  // here: statically, the tooltip'd button id is the one the bridge binds.
  const mId = editorHtml.match(/id="(cross-os-test-btn)"/);
  const bridge = fs.readFileSync(rootPath("editor/companion-bridge.js"), "utf8");
  assert.ok(mId[1], "canvas hosts the cross-os button");
  assert.match(bridge, /cross-os-test-btn/, "bridge binds the same id");
  assert.match(bridge, /OPEN_CROSS_OS_TESTER/, "bridge asks the worker for the studio");
  assert.match(fs.readFileSync(rootPath("background.js"), "utf8"), /OPEN_CROSS_OS_TESTER/, "worker opens the studio");
});
