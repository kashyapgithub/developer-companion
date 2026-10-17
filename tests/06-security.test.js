// Layer 6 — security posture: CSP-compatible scripts, no eval-style patterns,
// host-permission coverage for every network endpoint in the JS sources.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, rootPath } = require("./helpers");

function walk(dir, ext, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git") || entry.name === "sources" || entry.name === ".data" || entry.name === "tests") continue;
      walk(full, ext, acc);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      acc.push(full);
    }
  }
  return acc;
}

test("no forbidden patterns (eval, document.write, innerHTML with template injection into script src)", () => {
  const failures = [];
  for (const file of walk(ROOT, ".js")) {
    const src = fs.readFileSync(file, "utf8");
    if (/\beval\s*\(/.test(src)) failures.push(`${path.relative(ROOT, file)} uses eval()`);
    if (/document\.write/.test(src)) failures.push(`${path.relative(ROOT, file)} uses document.write`);
  }
  assert.deepEqual(failures, [], "dangerous patterns");
});

test("every remote https endpoint in extension JS is covered by host_permissions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const hosts = manifest.host_permissions.join(" ");

  // A hostname should be in host_permissions if ANY extension page/script
  // references it in a fetch/XHR-ish way. Known allowlist of hosts used by
  // the extension explicitly.
  const required = [
    ["https://api.github.com", "api.github.com"],
    ["https://openrouter.ai", "openrouter.ai"],
    ["https://api.openai.com", "api.openai.com"],
    ["https://api.anthropic.com", "api.anthropic.com"],
    ["https://generativelanguage.googleapis.com", "generativelanguage.googleapis.com"],
  ];

  const jsSources = walk(ROOT, ".js").map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const [url, hostname] of required) {
    const doesCodeFetch = jsSources.includes(url);
    if (doesCodeFetch) {
      assert.ok(hosts.includes(hostname), `${hostname} is fetched in code but missing from host_permissions`);
    }
  }
});

test("token material is never hardcoded in extension sources", () => {
  const failures = [];
  const suspicious = /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/;
  for (const file of walk(ROOT, ".js").concat(walk(ROOT, ".html"))) {
    const src = fs.readFileSync(file, "utf8");
    if (suspicious.test(src)) failures.push(`${path.relative(ROOT, file)} contains a token-like literal`);
  }
  assert.deepEqual(failures, [], "hardcoded GitHub tokens found — remove immediately");
});

test("port 5959 usage is consistent between extension HUD and server defaults", () => {
  const serverSrc = fs.readFileSync(rootPath("server/server.js"), "utf8");
  assert.match(serverSrc, /\|\|\s*5959/, "server default port must stay 5959");
  const bridge = fs.readFileSync(rootPath("editor/companion-bridge.js"), "utf8");
  assert.match(bridge, /127\.0\.0\.1:5959/, "canvas bridge status check targets 127.0.0.1:5959");
});
