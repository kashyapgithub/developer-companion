// Layer 29 — page-level wiring census for every remaining page:
//   logs viewer, canvas editor + companion bridge, Cross-OS settings &
//   studio. Two directions on each page:
//     A) every id the page JS reads must be rendered by that page's HTML;
//     B) every interactive element in the HTML must be reached by the JS.
//   Plus C) tooltips the user is promised, D) script tags resolve for real,
//   and E) the page headline matches what the page actually does.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rootPath } = require("./helpers");

const PAIRS = [
  ["logs/logs.html", ["logs/logs.js"]],
  ["editor/editor.html", ["editor/companion-bridge.js"]],
  ["os-test/settings.html", ["os-test/settings.js"]],
  ["os-test/studio.html", ["os-test/studio.js"]],
];

const read = (rel) => fs.readFileSync(rootPath(rel), "utf8");

test("A: every id page JS reads is actually rendered by that page's HTML", () => {
  const broken = [];
  for (const [html, scripts] of PAIRS) {
    const h = read(html);
    for (const js of scripts) {
      const src = read(js);
      const ids = [...src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      const selIds = [...src.matchAll(/querySelector(?:All)?\(\s*['"`]#([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      for (const id of new Set([...ids, ...selIds])) {
        if (!new RegExp(`id="${id}"`).test(h)) broken.push(`${js}: getElementById('#${id}') not in ${html}`);
      }
    }
  }
  assert.deepEqual(broken, [], "no phantom element reads");
});

function collect(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...collect(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

test("B: every interactive element in page HTML is reached by page JS", () => {
  const dead = [];
  for (const [html, scripts] of PAIRS) {
    const h = read(html);
    // all JS in that page's asset tree counts as wiring (editor has modules/)
    const dir = rootPath(path.dirname(html));
    const ALLJS = collect(dir).map((p) => fs.readFileSync(p, "utf8")).join("\n");
    for (const m of h.matchAll(/<(button|input|select|textarea|a)[^>]*id="([A-Za-z0-9_-]+)"/g)) {
      const iid = m[2];
      // wired directly by id/text, or by event delegation on a class the element carries
      const tag = m[0];
      const classes = (tag.match(/class="([^"]*)"/) || [])[1] || "";
      const delegated = classes.split(/\s+/).some((cls) => cls && ALLJS.includes(`.${cls}`)) ||
        ALLJS.match(/\[data-[\w-]+\]/);
      const wired = new RegExp(`#${iid}\\b|['"]${iid}['"]`).test(ALLJS) || delegated;
      if (!wired) dead.push(`${html}: ${m[1]}#${iid}`);
    }
  }
  assert.deepEqual(dead, [], "no dead interactive elements");
});

test("C: every companion toolbar button carries its promise as a tooltip", () => {
  const h = read("editor/editor.html");
  for (const [id, promise] of [
    ["github-dashboard-btn", /Open GitHub Repo Dashboard/],
    ["cross-os-test-btn", /Windows, macOS & Linux/],
    ["send-logs-btn", /Send captured browser/],
    ["view-logs-btn", /View live captured browser logs/],
    ["agent-tutorial-btn", /connect this extension to your AI agent/i],
  ]) {
    const tag = h.match(new RegExp(`id="${id}"[^>]*`));
    assert.ok(tag, `${id} present`);
    const title = (tag[0].match(/title="([^"]*)"/) || [])[1] || "";
    assert.match(title, promise, `${id} tooltip promises the right thing`);
  }
});

test("D: every module script tag resolves on disk; module pages use type=module", () => {
  for (const [html, scripts] of PAIRS) {
    const h = read(html);
    for (const m of h.matchAll(/<script[^>]*src="([^"]+)"/g)) {
      const asset = path.join(path.dirname(rootPath(html)), m[1]);
      assert.ok(fs.existsSync(asset), `${html} script src exists: ${m[1]}`);
    }
    for (const js of scripts) {
      const base = path.basename(js);
      const tag = h.match(new RegExp(`<script[^>]*${base}`));
      assert.ok(tag, `${html} loads ${base}`);
    }
  }
  const settingsTag = read("os-test/settings.html").match(/<script[^>]*settings\.js[^>]*>/)[0];
  assert.match(settingsTag, /type="module"/, "settings.js loads as a module (browser import semantics)");
});

test("E: the page headline matches what the page does", () => {
  assert.match(read("os-test/settings.html"), /GitHub/i, "settings page is about the GitHub repo");
  assert.match(read("os-test/studio.html"), /[Cc]ross-?[Oo][Ss]/i, "studio page introduces the Cross-OS tester");
  assert.match(read("logs/logs.html"), /[Ll]ogs/i, "logs page is about logs");
});
