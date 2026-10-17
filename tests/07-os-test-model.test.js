// Layer 7 — Cross-OS data model consistency, statically:
// the 9 os×browser combos must match EXACTLY across the service worker
// (lib/os-test.js), the studio page (os-test/studio.html + studio.js), the
// server-side label map (server/cross-os.js), and the workflow's output
// filenames (os-test/workflow-assets/screenshot-test.yml).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, rootPath } = require("./helpers");

const osTestSrc = fs.readFileSync(rootPath("lib/os-test.js"), "utf8");
const studioHtml = fs.readFileSync(rootPath("os-test/studio.html"), "utf8");
const studioJs = fs.readFileSync(rootPath("os-test/studio.js"), "utf8");
const serverSrc = fs.readFileSync(rootPath("server/cross-os.js"), "utf8");
const workflowYml = fs.readFileSync(rootPath("os-test/workflow-assets/screenshot-test.yml"), "utf8");

// Parse the worker's ALL_TEST_COMBINATIONS entries.
const combosInWorker = [...osTestSrc.matchAll(/\{\s*os:\s*"(\w+)",\s*browser:\s*"(\w+)",\s*label:\s*"([^"]+)"\s*\}/g)]
  .map((m) => ({ os: m[1], browser: m[2], label: m[3] }));

const EXPECTED_OSES = ["windows", "macos", "linux"];
const EXPECTED_BROWSERS = ["chromium", "firefox", "webkit"];

test("worker knows exactly the 3 OS × 3 browser combos with friendly labels", () => {
  assert.equal(combosInWorker.length, 9, "lib/os-test.js must define 9 combinations");
  for (const os of EXPECTED_OSES) {
    for (const browser of EXPECTED_BROWSERS) {
      assert.ok(
        combosInWorker.some((c) => c.os === os && c.browser === browser),
        `missing combo ${os}×${browser}`
      );
    }
  }
});

test("studio.html bench slots mirror the worker combos (data-combo ids and labels)", () => {
  const slotCombos = [...studioHtml.matchAll(/data-combo="([\w-]+)"/g)].map((m) => m[1]);
  const slotLabels = [...studioHtml.matchAll(/<span class="bench__label">([^<]+)<\/span>/g)].map((m) => m[1]);

  assert.equal(slotCombos.length, 9);
  assert.equal(slotLabels.length, 9);

  for (const { label } of combosInWorker) {
    assert.ok(slotLabels.includes(label), `studio.html is missing bench slot labeled "${label}"`);
  }
});

test("studio.js slot map and browser map agree with the worker labels", () => {
  for (const { label, browser } of combosInWorker) {
    assert.ok(
      studioJs.includes(`"${label}": document.querySelector`),
      `studio.js slotByLabel missing "${label}"`
    );
  }
  for (const browser of EXPECTED_BROWSERS) {
    assert.ok(studioJs.includes(`"${browser}"`), `studio.js must know browser "${browser}"`);
  }
});

test("server COMBO_LABELS agree with the worker labels", () => {
  for (const { os, browser, label } of combosInWorker) {
    const fileKey = `${os}-${browser}`;
    assert.ok(
      serverSrc.includes(`"${fileKey}": "${label}"`),
      `server/cross-os.js COMBO_LABELS missing "${fileKey}": "${label}"`
    );
  }
});

test("worker poll path matches the workflow's commit layout", () => {
  assert.match(
    osTestSrc,
    /results\/\$\{runTag\}\/\$\{combo\.os\}-\$\{combo\.browser\}\.png/,
    "worker must poll results/<tag>/<os>-<browser>.png on the results branch"
  );
  assert.match(workflowYml, /results-branch\/results\/\$\{RUN_TAG\}/, "workflow commits to results/<tag>/ on the results branch");
  assert.match(workflowYml, /OUTPUT_FILE="screenshot-\$\{OS_LABEL\}-\$\{browser\}\.png"/);
  assert.match(workflowYml, /git add "results\/\$\{RUN_TAG\}\/\$\{OS_LABEL\}-\$\{browser\}\.png"/);
});

test("dispatch event type matches the workflow trigger", () => {
  assert.match(osTestSrc, /event_type:\s*"cross-os-test"/, "worker must dispatch 'cross-os-test'");
  assert.match(workflowYml, /types:\s*\[\s*cross-os-test\s*\]/, "workflow must listen for 'cross-os-test'");
});

test("dispatch client_payload covers every field the workflow reads", () => {
  const payloadKeys = ["test_mode", "target_url", "repo_path", "run_tag", "full_page", "browsers"];
  const payloadBlock = osTestSrc.slice(osTestSrc.indexOf("client_payload:"), osTestSrc.indexOf("client_payload:") + 400);
  for (const key of payloadKeys) {
    assert.ok(payloadBlock.includes(key), `client_payload missing ${key}`);
  }
  for (const key of payloadKeys) {
    assert.ok(workflowYml.includes(`client_payload.${key}`), `workflow reads client_payload.${key}`);
  }
});

test("OS label mapping in the workflow covers all 3 OSes", () => {
  for (const osLabel of ["Windows) OS_LABEL=\"windows\"", "macOS)   OS_LABEL=\"macos\"", "OS_LABEL=\"linux\""]) {
    assert.ok(workflowYml.includes(osLabel), `workflow must map runner OS to label: ${osLabel}`);
  }
});
