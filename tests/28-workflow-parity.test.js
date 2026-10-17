// Layer 28 — workflow-assets fidelity. The Cross-OS studio tells users to
// copy four files into their repo (README.md, screenshot-test.yml,
// package.json, scripts/capture.js, scripts/serve.js). Any silent divergence
// between what the studio ships and the upstream repo it came from breaks
// those repos on their next workflow run — this layer trips it immediately.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { rootPath } = require("./helpers");

const SHIPPED = rootPath("os-test/workflow-assets");
const UPSTREAM = rootPath("sources/website-cross-operating-system-testing");

const pairs = [
  ["screenshot-test.yml", ".github/workflows/screenshot-test.yml"],
  ["package.json", "package.json"],
  ["scripts/capture.js", "scripts/capture.js"],
  ["scripts/serve.js", "scripts/serve.js"],
];

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

test("every shipped workflow asset is byte-identical to the upstream repo", () => {
  const drifted = [];
  for (const [ship, up] of pairs) {
    const a = path.join(SHIPPED, ...ship.split("/"));
    const b = path.join(UPSTREAM, ...up.split("/"));
    if (!fs.existsSync(a) || !fs.existsSync(b)) {
      drifted.push(`${ship}: missing (${!fs.existsSync(a) ? "shipped" : "upstream"})`);
      continue;
    }
    if (sha(a) !== sha(b)) drifted.push(ship);
  }
  assert.deepEqual(drifted, [], "shipped assets must not drift from sources/");
});

test("the asset README documents the right copy list and the results-branch requirement", () => {
  const rm = fs.readFileSync(path.join(SHIPPED, "README.md"), "utf8");
  assert.match(rm, /screenshot-test\.yml/, "names the workflow file");
  assert.match(rm, /scripts\/capture\.js/, "names the capture runner");
  assert.match(rm, /results/, "explains the results branch storage");
});

test("upstream yml and the engine sing the same matrix song (double-check of layer 26)", () => {
  const yml = fs.readFileSync(path.join(SHIPPED, "screenshot-test.yml"), "utf8");
  for (const b of ["chromium", "firefox", "webkit"]) assert.match(yml, new RegExp(b));
  for (const os of ["Windows", "macOS"]) assert.match(yml, new RegExp(os));
  assert.match(yml, /results-branch\/results\/\$\{RUN_TAG\}/, "screenshots land under results/<run-tag>");
});

test("main README's repo-prep section references the same files users must copy", () => {
  const rm = fs.readFileSync(rootPath("README.md"), "utf8");
  const mentions = (rm.match(/workflow-assets|screenshot-test/g) || []).length;
  assert.ok(mentions >= 2, "README keeps pointing users at the workflow assets");
});

test("capture script quality gates: no eval, no shell injection through TARGET_URL", () => {
  const cap = fs.readFileSync(path.join(SHIPPED, "scripts/capture.js"), "utf8");
  assert.doesNotMatch(cap, /\beval\(/, "no eval in the capture runner");
  assert.doesNotMatch(cap, /shell:\s*true/, "spawn never opens a shell with URL input");
  assert.match(cap, /playwright/i, "the capture runner is the playwright one");
});
