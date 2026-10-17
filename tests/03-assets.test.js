// Layer 3 — every HTML page loads with all its referenced assets present.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, rootPath } = require("./helpers");

function walk(dir, ext, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git") || entry.name === "sources") continue;
      walk(full, ext, acc);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      acc.push(full);
    }
  }
  return acc;
}

test("every HTML page parses, and its script/css/img references resolve to files", () => {
  const htmlFiles = walk(ROOT, ".html");
  // editor, logs, logs/options, logs/popup, os-test settings + studio, overlay
  assert.ok(htmlFiles.length >= 7, `expected all 7 extension pages present, got ${htmlFiles.length}`);

  const failures = [];
  for (const htmlFile of htmlFiles) {
    const dir = path.dirname(htmlFile);
    const src = fs.readFileSync(htmlFile, "utf8");

    // Very light structural checks (not full HTML parsing — real pages have
    // embedded SVG etc.)
    assert.match(src, /^\s*<!doctype html>/i, `${htmlFile} missing doctype`);

    for (const match of src.matchAll(/(?:script\s+src|link\s+(?:rel="stylesheet"\s+)?href)="([^"]+)"/g)) {
      const ref = match[1];
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:")) continue;
      const abs = path.resolve(dir, ref);
      if (!fs.existsSync(abs)) failures.push(`${path.relative(ROOT, htmlFile)} -> ${ref} (missing)`);
      else if (!(fs.readFileSync(abs).length > 0)) failures.push(`${ref} (empty file)`);
    }

    for (const match of src.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      const ref = match[1];
      if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:")) continue;
      const abs = path.resolve(dir, ref);
      if (!fs.existsSync(abs)) failures.push(`${path.relative(ROOT, htmlFile)} img -> ${ref} (missing)`);
    }

    // No inline <script> blocks without src (MV3 CSP forbids them).
    for (const match of src.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const inline = match[1].trim();
      if (inline.length > 0) failures.push(`${path.relative(ROOT, htmlFile)} has inline <script> content (MV3 CSP violation)`);
    }
  }
  assert.deepEqual(failures, [], "asset-reference failures");
});
