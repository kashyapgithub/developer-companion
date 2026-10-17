// Layer 19 — workflow-assets consistency: the YAML the user copies into their
// target repo must stay in lockstep with what lib/os-test.js dispatches and
// polls, and the packaged helper scripts must actually exist and be wired in.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rootPath } = require("./helpers");

const yml = fs.readFileSync(rootPath("os-test/workflow-assets/screenshot-test.yml"), "utf8");
const wREADME = fs.readFileSync(rootPath("os-test/workflow-assets/README.md"), "utf8");
const capture = fs.readFileSync(rootPath("os-test/workflow-assets/scripts/capture.js"), "utf8");
const serve = fs.readFileSync(rootPath("os-test/workflow-assets/scripts/serve.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(rootPath("os-test/workflow-assets/package.json"), "utf8"));

test("workflow triggers exactly on the dispatch event the worker sends", () => {
  assert.match(yml, /types:\s*\[\s*cross-os-test\s*\]/);
  assert.doesNotMatch(yml, /workflow_dispatch:/, "manual trigger stays passive so runs always carry a payload");
});

test("workflow honors every client_payload field the worker dispatches", () => {
  for (const key of ["test_mode", "target_url", "repo_path", "run_tag", "full_page", "browsers"]) {
    assert.ok(yml.includes(`client_payload.${key}`), `workflow must read client_payload.${key}`);
  }
});

test("workflow covers the 3 OS matrix the worker promises", () => {
  for (const os of ["windows-latest", "macos-latest", "ubuntu-latest"]) {
    assert.ok(yml.includes(os), `matrix must include ${os}`);
  }
});

test("browser list defaults match the worker's browser values", () => {
  const defaults = [...yml.matchAll(/\$\{BROWSERS?:-([^}]+)\}/g)].map((m) => m[1]);
  assert.ok(defaults.length >= 2, "both playwright-install and capture steps read the browser list");
  for (const d of defaults) {
    assert.equal(d.trim(), "chromium,firefox,webkit", "default browser set must be chromium,firefox,webkit");
  }
});

test("full_page flag switches between fullPage and viewport screenshots", () => {
  assert.ok(/fullPage|full_page/.test(capture), "capture script consumes the full_page flag");
});

test("capture script and server script are referenced by the workflow steps", () => {
  assert.ok(yml.includes("capture.js"), "workflow runs the packaged capture script");
  assert.ok(yml.includes("serve.js") || /python3 -m http\.server|http-server/.test(yml), "workflow serves the page");
});

test("screenshot naming contract: <os>-<browser>.png copied under results/<run_tag>/", () => {
  assert.match(yml, /OUTPUT_FILE="screenshot-\$\{OS_LABEL\}-\$\{browser\}\.png"/);
  assert.match(yml, /cp "\$OUTPUT_FILE" "\$\{DEST_DIR\}\/\$\{OS_LABEL\}-\$\{browser\}\.png"/);
});

test("results branch push includes only the run payload (no accidental repo wipe)", () => {
  assert.match(yml, /git add "results\/\$\{RUN_TAG\}/, "commit adds only this run's folder");
  assert.ok(!/git (add -A|--all|add \.)/.test(yml), "no indiscriminate add that could commit unrelated files");
});

test("workflow yml pins the reference to the results branch name used by code", () => {
  assert.match(yml, /results-branch/, "workflow checks out / pushes a dedicated results-branch");
});

test("packaged helper scripts are CommonJS wired to package.json deps", () => {
  // gh runners run `node scripts/capture.js` — plain CJS, no ESM needed.
  assert.ok(!capture.includes("import "), "capture.js must stay require-based CJS");
  assert.ok(!serve.includes("import "), "serve.js must stay require-based CJS");
  assert.ok(capture.includes('require("playwright")'), "capture.js pulls the browser engines from playwright");
  new Function(capture); // syntax check
  new Function(serve);
  assert.ok(pkg.name && pkg.dependencies?.playwright, "package.json declares the capture dependency");
});

test("workflow-assets README documents the 3-step copy process", () => {
  assert.match(wREADME, /workflow/i);
  assert.match(wREADME, /screenshot-test\.yml|\.github\/workflows/);
});

// ---------------------------------------------------------------------------

test("main README advertises the tool and MCP tool consistently", () => {
  const readme = fs.readFileSync(rootPath("README.md"), "utf8");
  assert.match(readme, /## How to Use the 4 Tools/);
  assert.match(readme, /get_cross_os_results/, "MCP tool documented");
  assert.match(readme, /Cross-OS Test/);
  assert.match(readme, /website-cross-operating-system-testing/, "setup example references the tester repo");
});

test("README keeps its internal promises about counts", () => {
  const readme = fs.readFileSync(rootPath("README.md"), "utf8");
  assert.match(readme, /## How to Use the 4 Tools/);
  for (const svc of ["UI Sketch", "GitHub Dashboard", "Browser Logs to Agent", "Cross-OS Website Tester"]) {
    assert.ok(readme.includes(svc), `README must mention ${svc}`);
  }
});

test("workflow README + main README tell the same owner/repo story", () => {
  const readme = fs.readFileSync(rootPath("README.md"), "utf8");
  assert.ok(readme.includes("kashyapgithub"), "main README references the user's account in the setup example");
  assert.match(readme, /results`? branch|results branch/, "setup explains creating the results branch");
});
