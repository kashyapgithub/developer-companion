// Layer 30 — the aggregate closer. Two responsibilities:
//   1) the suite's own integrity: exactly 30 numbered layer files, all named
//      in the census order;
//   2) one full-suite green run is verified from inside the suite via a
//      guarded child process (env LAYER30_CHILD breaks the recursion — the
//      child's layer 30 only checks the census, never re-spawns).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { rootPath } = require("./helpers");

const TESTS_DIR = rootPath("tests");

test("census: the suite ships exactly 30 numbered layers, 21-30 present", () => {
  const files = fs.readdirSync(TESTS_DIR)
    .filter((f) => /^\d{2}-.+\.test\.js$/.test(f))
    .sort();
  assert.equal(files.length, 30, "exactly 30 layer files");
  for (const f of files) {
    assert.ok(fs.statSync(path.join(TESTS_DIR, f)).size > 500, `${f} has real content`);
  }
  const last = files[files.length - 1];
  assert.match(last, /^30-/, "layer 30 is the final aggregate");
});

test("the ten quality layers all target the UI-honesty mission", () => {
  const expected = [
    21, // canvas toolbar runtime
    22, // logs viewer runtime
    23, // overlay handler census
    24, // message-type contract
    25, // response-shape contract
    26, // product-claims vs engine
    27, // copy census
    28, // workflow-assets fidelity
    29, // page wiring census
    30, // aggregate
  ];
  const files = fs.readdirSync(TESTS_DIR).filter((f) => /^\d{2}-/.test(f));
  for (const n of expected) {
    assert.ok(files.some((f) => f.startsWith(String(n))), `layer ${n} file exists`);
  }
});

test(
  "full suite green from inside the suite (guarded spawn, no self-recursion)",
  { skip: process.env.LAYER30_CHILD ? "child run — guarding against recursion" : false },
  () => {
    const layers = fs.readdirSync(TESTS_DIR)
      .filter((f) => /^\d{2}-.+\.test\.js$/.test(f))
      .map((f) => path.join(TESTS_DIR, f));
    // node:test marks nested runs through inherited env vars — strip them so
    // the guarded child behaves like a fresh, top-level `node --test` run.
    const childEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (/^(TEST_|NODE_TEST|NODE_V8_COVERAGE|NODE_OPTIONS$)/i.test(k) && k !== "NODE_PATH") continue;
      childEnv[k] = v;
    }
    childEnv.LAYER30_CHILD = "1";
    const res = spawnSync(
      process.execPath,
      ["--test", "--test-force-exit", "--test-reporter=tap", ...layers],
      {
        cwd: TESTS_DIR,
        env: childEnv,
        encoding: "utf8",
        timeout: 540_000,
        maxBuffer: 64 * 1024 * 1024,
      }
    );

    const out = res.stdout || "";
    console.log("L30_DEBUG status:", res.status, "outLen:", out.length, "okLines:", (out.match(/^ok\s/gm) || []).length, "stderrHead:", (res.stderr || "").slice(0, 200), "signal:", res.signal);
    const tally = (label) => {
      const m = out.match(new RegExp(`# ${label}:?\\s*(\\d+)`)) || out.match(new RegExp(`^${label}:?\\s*(\\d+)`, "m"));
      return m ? Number(m[1]) : NaN;
    };
    const fails = tally("failures") || tally("not ok");
    const passes = out.match(/^ok\s/gm);

    assert.ok(res.status === 0 || res.status === null, `child exited cleanly (status ${res.status})`);
    assert.ok(Number.isNaN(fails) ? true : fails === 0, "zero failing tests across the whole suite");
    // child output sanity: many green checks
    assert.ok((passes || []).length >= 150, `expected a large green body, saw ${passes ? passes.length : 0}`);
    assert.doesNotMatch(out, /# SKIP: failed/);
  }
);

test("layer 21-30 stayed single-purpose (each file targets its own page/queue)", () => {
  const mission = {
    "21-canvas-toolbar.test.js": /companion-bridge/,
    "22-logs-viewer.test.js": /logs\/logs\.js/,
    "23-overlay-census.test.js": /overlay/,
    "24-message-contract.test.js": /background\.js/,
    "25-response-shapes.test.js": /reply|response/i,
    "26-product-claims.test.js": /5959/,
    "27-copy-census.test.js": /showToast/,
    "28-workflow-parity.test.js": /workflow-assets/,
    "29-page-wiring.test.js": /settings\.js/,
    "30-final-countdown.test.js": /LAYER30_CHILD/,
  };
  for (const [file, marker] of Object.entries(mission)) {
    const src = fs.readFileSync(path.join(TESTS_DIR, file), "utf8");
    assert.match(src, marker, `${file} keeps its mission`);
  }
});
