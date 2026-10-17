// Layer 4 — static UI wiring: every id a page script looks up must exist in
// that page's HTML. Catches "button does nothing" regressions the moment a
// markup id is renamed.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rootPath } = require("./helpers");

// (jsFile, htmlFile) pairs where lookups are anchored.
const PAIRS = [
  { js: "editor/companion-bridge.js", html: "editor/editor.html" },
  { js: "logs/logs.js", html: "logs/logs.html" },
  { js: "os-test/studio.js", html: "os-test/studio.html" },
  { js: "os-test/settings.js", html: "os-test/settings.html" },
  { js: "logs/options.js", html: "logs/options.html" },
];

// ids that companion-bridge/log pages legitimately reference but are created
// dynamically at runtime by framework code rather than static markup.
const DYNAMIC_OK = new Set();

function idsInHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  return new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
}

test("every getElementById in paired page scripts exists in the HTML", () => {
  const failures = [];
  for (const pair of PAIRS) {
    const jsPath = rootPath(pair.js);
    const htmlPath = rootPath(pair.html);
    assert.ok(fs.existsSync(jsPath), `${pair.js} missing`);
    assert.ok(fs.existsSync(htmlPath), `${pair.html} missing`);

    const js = fs.readFileSync(jsPath, "utf8");
    const ids = idsInHtml(htmlPath);

    for (const match of js.matchAll(/getElementById\("([\w-]+)"\)/g)) {
      const id = match[1];
      if (DYNAMIC_OK.has(id)) continue;
      if (!ids.has(id)) failures.push(`${pair.js}: getElementById("${id}") not found in ${path.basename(pair.html)}`);
    }
  }
  assert.deepEqual(failures, [], "missing element ids");
});

test("new Cross-OS button is wired into the canvas toolbar", () => {
  const html = fs.readFileSync(rootPath("editor/editor.html"), "utf8");
  assert.match(html, /id="cross-os-test-btn"/, "toolbar button must exist in editor.html");
  assert.match(html, /companion-group/, "toolbar group container must exist");

  const bridge = fs.readFileSync(rootPath("editor/companion-bridge.js"), "utf8");
  assert.match(bridge, /getElementById\("cross-os-test-btn"\)/, "companion-bridge must wire the button");
  assert.match(bridge, /OPEN_CROSS_OS_TESTER/, "companion-bridge must send the open message");

  const background = fs.readFileSync(rootPath("background.js"), "utf8");
  assert.match(background, /OPEN_CROSS_OS_TESTER/, "background must handle the open message");
  assert.match(background, /os-test\/studio\.html/, "background must know the studio URL");
});

test("studio.html exposes all bench combos the studio script and worker know about", () => {
  const html = fs.readFileSync(rootPath("os-test/studio.html"), "utf8");
  const combos = [...html.matchAll(/data-combo="([\w-]+)"/g)].map((m) => m[1]);
  assert.equal(combos.length, 9, "there must be exactly 9 bench slots");
  assert.ok(combos.includes("windows") && combos.includes("windows-firefox") && combos.includes("windows-webkit"));
  assert.ok(combos.includes("macos-webkit") && combos.includes("macos") && combos.includes("macos-firefox"));
  assert.ok(combos.includes("linux") && combos.includes("linux-firefox") && combos.includes("linux-webkit"));
});
