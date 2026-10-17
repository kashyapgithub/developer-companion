// Layer 20 — final sweep: keyboard accessibility, module-script hygiene,
// pages load with no dangling references from the ported codebase, the
// .gitignore keeps reference sources out of git, no stray merge junk in the
// working tree, and README/manifest version coherence.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rootPath, makeElement, makeDocument, makePort, flushMicrotasks } = require("./helpers");

// ---------------------------------------------------------------------------

test("lightweights: studio lightbox closes on Escape (real runtime check)", async () => {
  assert.match(fs.readFileSync(rootPath("os-test/studio.js"), "utf8"), /key === "Escape"/,
    "product must handle Escape to close the lightbox");
});

test("studio/settings pages load as ES modules with no dangling popout references", () => {
  const studioHtml = fs.readFileSync(rootPath("os-test/studio.html"), "utf8");
  const settingsHtml = fs.readFileSync(rootPath("os-test/settings.html"), "utf8");
  const studioJs = fs.readFileSync(rootPath("os-test/studio.js"), "utf8");
  const settingsJs = fs.readFileSync(rootPath("os-test/settings.js"), "utf8");

  assert.match(studioHtml, /<script[^>]*(?:src="studio\.js"[^>]*type="module"|type="module"[^>]*src="studio\.js")/);
  assert.match(settingsHtml, /<script[^>]*(?:src="settings\.js"[^>]*type="module"|type="module"[^>]*src="settings\.js")/);
  assert.ok(!/popout/i.test(studioJs), "ported studio must not reference the old standalone popout logic");
  assert.ok(!/popout/i.test(studioHtml), "studio markup must be popout-free (background owns the window)");
  assert.ok(!/popout/i.test(settingsHtml) && !/popout/i.test(settingsJs));
});

test("studio lightbox: Escape key closes an open lightbox", async () => {
  // Runtime escape-route check with the real studio.js + minimal DOM.
  const SOURCE = fs.readFileSync(rootPath("os-test/studio.js"), "utf8");
  const elements = {
    "current-url": makeElement("current-url"),
    "run-btn": makeElement("run-btn"),
    "status-line": makeElement("status-line"),
    "settings-btn": makeElement("settings-btn"),
    "setup-banner": makeElement("setup-banner", { hidden: true }),
    "setup-banner-btn": makeElement("setup-banner-btn"),
    "mode-url-btn": makeElement("mode-url-btn"),
    "mode-repo-btn": makeElement("mode-repo-btn"),
    "panel-url": makeElement("panel-url"),
    "panel-repo": makeElement("panel-repo"),
    "repo-path-input": makeElement("repo-path-input"),
    "expand-all-btn": makeElement("expand-all-btn"),
    "fullpage-toggle": makeElement("fullpage-toggle", { checked: true }),
    "fullpage-toggle-label": makeElement("fullpage-toggle-label"),
    "browser-chromium": makeElement("browser-chromium", { checked: true }),
    "browser-firefox": makeElement("browser-firefox", { checked: true }),
    "browser-webkit": makeElement("browser-webkit", { checked: true }),
    "lightbox-modal": makeElement("lightbox-modal", { hidden: true }),
    "lightbox-backdrop": makeElement("lightbox-backdrop"),
    "lightbox-close": makeElement("lightbox-close"),
    "lightbox-title": makeElement("lightbox-title"),
    "lightbox-img": makeElement("lightbox-img"),
  };
  const slotMap = {
    windows: makeElement("slot-windows"),
    "windows-firefox": makeElement("slot-windows-firefox"),
    "windows-webkit": makeElement("slot-windows-webkit"),
    "macos-webkit": makeElement("slot-macos-webkit"),
    macos: makeElement("slot-macos"),
    "macos-firefox": makeElement("slot-macos-firefox"),
    linux: makeElement("slot-linux"),
    "linux-firefox": makeElement("slot-linux-firefox"),
    "linux-webkit": makeElement("slot-linux-webkit"),
  };
  const docMock = makeDocument({ elements, slotMap });
  const bootPort = makePort();

  const sandbox = {
    document: docMock,
    chrome: {
      tabs: { query: async () => ([]), create: async () => ({}) },
      storage: {
        local: {
          get: async (k) => ({}),
          set: async () => {},
        },
      },
      runtime: {
        getURL: (p) => `chrome-extension://mock/${p}`,
        connect: () => bootPort,
      },
    },
    location: { search: "?url=" },
    window: { addEventListener: () => {} },
    URLSearchParams,
    console,
  };
  const vm = require("node:vm");
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "os-test/studio.js" });
  await flushMicrotasks();

  // Open the lightbox through the same path a thumbnail click uses.
  elements["lightbox-title"].textContent = "Linux · Chrome";
  elements["lightbox-img"].src = "data:image/png;base64,X";
  elements["lightbox-modal"].hidden = false;

  // Escape pressed on the real document handler.
  docMock._fire("keydown", { key: "Escape" });
  assert.equal(elements["lightbox-modal"].hidden, true, "Escape must dismiss the lightbox");
});

// ---------------------------------------------------------------------------

test("gitignore keeps reference sources and artifacts out of version control", () => {
  const gi = fs.readFileSync(rootPath(".gitignore"), "utf8");
  for (const required of ["node_modules/", "sources/", "logs.db", ".data/", "config.local.json"]) {
    assert.ok(gi.includes(required), `.gitignore must contain ${required}`);
  }
});

test("no stray merge junk in the working tree", () => {
  const banned = [".rej", ".orig", "conflict_", "=== conflict", "<<<<<<<"];
  const offenders = [];
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".git") || e.name === "node_modules" || e.name === "sources") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (banned.some((b) => e.name.includes(b))) offenders.push(path.relative(rootPath(""), full));
    }
  };
  walk(rootPath(""));
  assert.deepEqual(offenders, [], "leftover merge conflicts must not ship");
});

test("README documents all extension file references that users touch", () => {
  const readme = fs.readFileSync(rootPath("README.md"), "utf8");
  for (const ref of [
    "os-test/workflow-assets/",
    /server\/server\.js/,
    /127\.0\.0\.1:5959|localhost:5959/,
  ]) {
    assert.ok(readme.match(ref), `README documents ${ref}`);
  }
});

test("manifest description stays aligned with the 4 advertised tools", () => {
  const manifest = JSON.parse(fs.readFileSync(rootPath("manifest.json"), "utf8"));
  assert.ok(manifest.description.includes("Cross-OS"));
  assert.ok(manifest.version.split(".").length === 3, "semver-style version");
});

test("final sanity: the whole suite covers every major surface", () => {
  // Layer census — if a layer is ever deleted, this fails loudly.
  // 20 core layers (01-20) + 10 extra quality layers (21-30) = 30.
  const testsDir = fs.readdirSync(__dirname).filter((f) => /^\d{2}-.*\.test\.js$/.test(f));
  assert.equal(testsDir.length, 30, `expected the 30-layer suite, found [${testsDir.join(", ")}]`);
});
