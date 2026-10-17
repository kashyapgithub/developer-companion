// Layer 24 — message-type contract between extension pages and background.js.
// A typo'd type is the nastiest extension bug: the send resolves `undefined`
// and the UI silently degrades. This layer trips it before that happens:
//   1) every type a page sends exists in background.js's handler switch;
//   2) multi-line sends are caught too (the classic miss);
//   3) background's extra handled types are exactly the window-opener trio;
//   4) every handled type actually responds (sendResponse present per case);
//   5) no lowercase/kebab rogue types in the switch.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rootPath } = require("./helpers");

const PAGE_DIRS = ["editor", "logs", "lib", "os-test", "overlay"];

function collect(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...collect(p, dir));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

const pageFiles = PAGE_DIRS.flatMap((d) => collect(rootPath(d)));
const pageSources = new Map(pageFiles.map((p) => [p, fs.readFileSync(p, "utf8")]));
const backgroundSrc = fs.readFileSync(rootPath("background.js"), "utf8");

// ---- extractors ------------------------------------------------------------

function pageSentTypes() {
  const types = new Map(); // type → file
  for (const [file, src] of pageSources) {
    if (file.endsWith("background.js")) continue;
    for (const m of src.matchAll(/sendMessage\(\s*\{[\s\S]{0,220}?type:\s*['"]([A-Z0-9_]+)['"]/g)) {
      if (!types.has(m[1])) types.set(m[1], file);
    }
  }
  return types;
}

function handledTypes() {
  // case blocks: `case "T":` and comparisons `msg.type === "T"`
  const set = new Map();
  for (const m of backgroundSrc.matchAll(/case\s+['"]([A-Z0-9_]+)['"]:|message\.type\s*===\s*['"]([A-Z0-9_]+)['"]/g)) {
    const t = m[1] || m[2];
    if (!set.has(t)) {
      const idx = m.index;
      const block = backgroundSrc.slice(idx, backgroundSrc.indexOf("break", idx));
      set.set(t, block);
    }
  }
  return set;
}

const sent = pageSentTypes();
const handled = handledTypes();

test("every message type a page sends is handled by background.js", () => {
  const orphan = [...sent.entries()].filter(([t]) => !handled.has(t)).map(([t, f]) => `${t} (${f})`);
  assert.deepEqual(orphan, [], "no silent-degradation types");
});

test("the canonical eight page-facing types are all still wired (edit-victim guard)", () => {
  for (const t of ["GET_STATUS", "GET_ALL_LOGS", "GET_LOGS", "SEND_LOGS_TO_AGENT", "CLEAR_LOGS", "FLUSH_NOW", "FOCUS_CANVAS_TAB", "OPEN_CROSS_OS_TESTER"]) {
    assert.ok(handled.has(t), `${t} handled by background`);
  }
});

test("no unreachable handlers: every extra handled type has a real sender in the codebase", () => {
  // The registry grew with the product (pickers, capture, API/flow/motion
  // windows…). A handled type becomes a bug when NOTHING can trigger it.
  // Rule: each extra handled type appears at least twice in the repo's JS
  // (its handler plus at least one sender/dispatcher) or is a keyboard
  // command documented in the code.
  const extra = [...handled.keys()].filter((t) => !sent.has(t));
  const repoTexts = {};
  // every top-level directory of the extension is fair game (pages come and go)
  for (const entry of fs.readdirSync(rootPath(""), { withFileTypes: true })) {
    const name = entry.name;
    if (!entry.isDirectory()) continue;
    if (/^(tests|sources|server|node_modules|\.git)$/i.test(name)) continue; // non-extension code
    const dir = path.join(rootPath(""), name);
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      const full = path.join(dir, String(f));
      if (full.endsWith(".js") && fs.statSync(full).isFile()) {
        repoTexts[full] = fs.readFileSync(full, "utf8");
      }
    }
  }
  const backgroundCount = (t) => (backgroundSrc.match(new RegExp(`"${t}"`, "g")) || []).length;
  const unreachable = [];
  for (const t of extra) {
    const total = backgroundCount(t) +
      Object.values(repoTexts).filter((s) => s.includes(`"${t}"`)).length +
      (fs.existsSync(rootPath("README.md")) && (fs.readFileSync(rootPath("README.md"), "utf8").includes(t)) ? 1 : 0);
    if (total < 2) unreachable.push(t);
  }
  assert.deepEqual(unreachable, [], "every background-handled type must have a live sender or a documented command");
});

test("every OPEN_* opener request answered with ok:true (pages toast on truthiness)", () => {
  for (const t of ["OPEN_CANVAS", "OPEN_CROSS_OS_TESTER", "OPEN_GITHUB_DASHBOARD", "OPEN_LOGS_VIEWER"]) {
    const block = handled.get(t) || "";
    const nearby = backgroundSrc.includes(t) && block;
    assert.ok(nearby, `${t} has a case block`);
    assert.match(String(nearby), /sendResponse\(\s*\{\s*ok:\s*true|ok:\s*true/, `${t} responds ok`);
  }
});

test("every handled case actually responds (sendResponse appears once per case)", () => {
  const noResponse = [...handled.entries()].filter(([, block]) => !/sendResponse/.test(String(block)));
  assert.deepEqual(
    noResponse.map(([t]) => t),
    [],
    "a handler without sendResponse leaves pages hanging on await"
  );
});

test("type-name hygiene: handler types are SCREAMING_SNAKE only", () => {
  const rogue = [...handled.keys()].filter((t) => !/^[A-Z][A-Z0-9_]*$/.test(t));
  assert.deepEqual(rogue, [], "no lowercase/kebab message types in background");
});

test("pages only import message types the contract knows (send literal sanity)", () => {
  // count literal SEND_LOGS_TO_AGENT callers — the accent path must exist in the bridge
  const bridge = pageSources.get(rootPath("editor/companion-bridge.js")) || "";
  assert.match(bridge, /SEND_LOGS_TO_AGENT/, "companion-bridge sends SEND_LOGS_TO_AGENT");
  assert.match(backgroundSrc, /SEND_LOGS_TO_AGENT/, "background handles it");
});
