// Layer 5 — ES module import graph: every relative import from the extension's
// entrypoints resolves to a real file, and the named import actually exists
// as an export in that file.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers");

const ENTRYPOINTS = [
  "background.js",
  "editor/main.js",
  "overlay/overlay.js",
  "os-test/studio.js",
  "server/server.js",
  "server/storage.js",
  "server/config.js",
  "server/cross-os.js",
];

const localModuleCache = new Map();

function readModule(spec, fromFile) {
  const resolved = path.resolve(path.dirname(fromFile), spec).endsWith(".js")
    ? path.resolve(path.dirname(fromFile), spec)
    : path.resolve(path.dirname(fromFile), spec) + ".js";
  if (localModuleCache.has(resolved)) return localModuleCache.get(resolved);
  if (!fs.existsSync(resolved)) return null;

  const src = fs.readFileSync(resolved, "utf8");
  const exports = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)/gm)) {
    exports.add(m[1]);
  }
  // bare `export { a, b as c }` lists
  for (const m of src.matchAll(/^export\s+\{([^}]*)\}/gm)) {
    for (const name of m[1].split(",")) {
      const n = name.trim().split(/\s+as\s+/).pop();
      if (n) exports.add(n);
    }
  }
  const info = { resolved, src, exports };
  localModuleCache.set(resolved, info);
  return info;
}

test("all relative imports from entrypoints resolve and export what they promise", () => {
  const failures = [];
  const seen = new Set();
  const queue = ENTRYPOINTS.map((rel) => path.join(ROOT, rel)).filter((p) => fs.existsSync(p));

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");

    for (const m of src.matchAll(/^import\s+(?:.+?\s+from\s+)?["'](\.[^"']+)["']/gm)) {
      const spec = m[1];
      const mod = readModule(spec, file);
      if (!mod) {
        failures.push(`${path.relative(ROOT, file)} imports missing module ${spec}`);
        continue;
      }
      queue.push(mod.resolved);

      // Collect named imports for this specifier and verify them.
      const importLineRe = new RegExp(
        `import\\s+\\{([^}]+)\\}\\s*from\\s*["']${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
        "g"
      );
      for (const named of src.matchAll(importLineRe)) {
        for (const rawName of named[1].split(",")) {
          const localTarget = rawName.trim().split(/\s+as\s+/)[0];
          if (!localTarget) continue;
          if (!mod.exports.has(localTarget)) {
            failures.push(`${path.relative(ROOT, file)} imports "${localTarget}" from ${spec}, but it is not exported`);
          }
        }
      }
    }
  }

  assert.equal(failures.length, 0, `import graph failures:\n${failures.join("\n")}`);
});

test("key feature modules are all reachable from their entrypoints", () => {
  const bgs = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");
  for (const mustHave of [
    "lib/allowlist.js",
    "lib/debugger-capture.js",
    "lib/log-sender.js",
    "lib/commands.js",
    "lib/forward-config.js",
    "lib/os-test.js",
  ]) {
    assert.ok(bgs.includes(mustHave), `background.js should import ${mustHave}`);
  }
  const editorHtml = fs.readFileSync(path.join(ROOT, "editor/editor.html"), "utf8");
  assert.match(
    editorHtml,
    /<script[^>]+type="module"[^>]+src="companion-bridge\.js"/,
    "editor page must load the companion bridge as a module script"
  );
});
