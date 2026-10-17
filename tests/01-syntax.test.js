// Layer 1 — every JavaScript file in the extension must at least PARSE.
// Compiles each file in a vm context (with import/export transformed to plain
// script) — catches syntax errors browser load would surface at runtime.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ROOT, toCommonScript } = require("./helpers");

function walk(dir, ext, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
      walk(full, ext, acc);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      acc.push(full);
    }
  }
  return acc;
}

test("all extension .js files compile without syntax errors", () => {
  const jsFiles = walk(ROOT, ".js")
    .filter((f) => !f.includes(`${path.sep}tests${path.sep}`))
    .filter((f) => !f.includes(`${path.sep}server${path.sep}node_modules`))
    .filter((f) => !f.includes(`${path.sep}sources${path.sep}`));
  assert.ok(jsFiles.length > 30, `expected to sweep the whole extension tree, got ${jsFiles.length} files`);

  const failures = [];
  for (const file of jsFiles) {
    try {
      const src = fs.readFileSync(file, "utf8");
      const { source } = toCommonScript(src, { wrap: true });
      // eslint-disable-next-line no-new
      new vm.Script(source, { filename: path.relative(ROOT, file) });
    } catch (err) {
      failures.push(`${path.relative(ROOT, file)}: ${err.message}`);
    }
  }
  assert.deepEqual(failures, [], "syntax errors found");
});
