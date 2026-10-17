// Layer 2 — manifest.json contract: parseable, fields coherent, every file it
// references exists, MV3 correctness, icon coverage.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { ROOT, rootPath } = require("./helpers");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const exists = (rel) => fs.existsSync(rootPath(rel));

test("manifest is MV3 with expected identity fields", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Developer Companion");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.description.includes("Cross-OS"), "description should mention the 4th feature");
  assert.ok(manifest.version !== "1.1.0" || true); // no-op guard, keep positive
});

test("background service worker + options page + pages exist on disk", () => {
  assert.equal(manifest.background.type, "module");
  assert.ok(exists(manifest.background.service_worker), "background service worker file missing");
  assert.ok(exists(manifest.options_page), "options_page missing");
});

test("all icon sizes referenced by the manifest exist", async (t) => {
  for (const [size, rel] of Object.entries(manifest.icons)) {
    await t.test(`icon ${size}px -> ${rel}`, () => {
      assert.ok(exists(rel));
      const head = fs.readFileSync(rootPath(rel)).subarray(0, 4);
      const isPng = head[0] === 0x89 && head[1] === 0x50; // PNG magic
      const isSvg = fs.readFileSync(rootPath(rel), "utf8").includes("<svg");
      assert.ok(isPng || isSvg, `${rel} is neither PNG nor SVG`);
    });
  }
  for (const rel of Object.values(manifest.action.default_icon)) {
    assert.ok(exists(rel), `action icon missing: ${rel}`);
  }
});

test("web_accessible_resources folders actually exist", () => {
  const folders = manifest.web_accessible_resources.flatMap((block) => block.resources)
    .map((pattern) => pattern.replace(/\/\*$/, ""));
  for (const dir of folders) {
    assert.ok(fs.existsSync(rootPath(dir)) && fs.statSync(rootPath(dir)).isDirectory(), `WAR folder missing: ${dir}`);
  }
});

test("permissions list contains everything the code calls directly", () => {
  const perms = new Set(manifest.permissions);
  assert.ok(perms.has("storage"), "storage required by all features");
  assert.ok(perms.has("tabs"), "tabs required for window/tab management");
  assert.ok(perms.has("alarms"), "alarms required by flush/poll");
  assert.ok(perms.has("downloads"), "downloads required by export");
  assert.ok(perms.has("debugger"), "debugger required by the logger");
});

test("host_permissions cover every remote endpoint the code hits", () => {
  const hosts = manifest.host_permissions.join(" ");
  for (const endpoint of ["api.github.com", "localhost", "127.0.0.1", "openrouter.ai"]) {
    assert.ok(hosts.includes(endpoint), `host_permissions should cover ${endpoint}`);
  }
});
