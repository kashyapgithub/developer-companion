// Layer 8 — credential resolution for the Cross-OS tester.
//
// The REAL lib/os-test.js is executed via vm inside a sandbox mocking
// chrome.storage + chrome.runtime.onConnect + fetch. The test drives the
// registered onConnect handler through a real Port-shaped object, exactly
// how Chrome would deliver a connection from the studio page.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { rootPath, makePort, makeDateMock, waitFor } = require("./helpers");

const SOURCE = fs.readFileSync(rootPath("lib/os-test.js"), "utf8")
  .replace(/^export\s+/m, ""); // strip the single ESM export keyword

/**
 * @param {object} opts
 * @param {object} opts.store - initial chrome.storage.local content
 * @param {Function} opts.fetchImpl - mocked global fetch
 * @param {number} opts.clockStepMs - Date.now() advance per call (0 = frozen, for streaming tests)
 */
function loadOsTest({ store = {}, fetchImpl, clockStepMs = 0 } = {}) {
  let onConnectHandler = null;
  const chromeMock = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) if (k in store) res[k] = store[k];
          return res;
        },
      },
    },
    runtime: {
      onConnect: { addListener: (fn) => { onConnectHandler = fn; } },
    },
  };

  const date = makeDateMock(clockStepMs);
  const sandbox = {
    chrome: chromeMock,
    fetch: fetchImpl,
    Date: date.Date,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    setTimeout: (fn) => setImmediate(fn),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "lib/os-test.js" });
  // background.js wires the bridge explicitly — do the same here.
  vm.runInContext("initOsTestBridge()", sandbox, { filename: "lib/os-test.js#init" });

  assert.ok(onConnectHandler, "initOsTestBridge() must register an onConnect listener");

  return {
    /** Simulate the studio page calling chrome.runtime.connect({name}). */
    connect: (name = "cross-os-test") => {
      const port = makePort();
      port.name = name;
      onConnectHandler(port);
      return port;
    },
  };
}

module.exports = { loadOsTest };

// ---------------------------------------------------------------------------

test("missing credentials fail fast without any network call", async () => {
  let fetchCalls = 0;
  const harness = loadOsTest({
    fetchImpl: async () => { fetchCalls += 1; throw new Error("must not fetch"); },
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com" });
  await waitFor(() => port.messagesSent.some((m) => m.type === "ERROR"));

  assert.equal(port.messagesSent.length, 1, "exactly one message: the ERROR");
  assert.equal(port.messagesSent[0].type, "ERROR");
  assert.equal(port.messagesSent[0].error, "MISSING_CREDENTIALS");
  assert.equal(fetchCalls, 0);
});

test("dashboard token is used as fallback when the tester's own PAT is unset", async () => {
  let seenAuth = null;
  const harness = loadOsTest({
    store: {
      settings: { githubToken: "dash-token-123" },
      repoOwner: "kashyapgithub",
      repoName: "target-repo",
    },
    fetchImpl: async (url, init) => {
      if (url.includes("/dispatches")) {
        seenAuth = init.headers.Authorization;
        return { ok: true, status: 204, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => null };
    },
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });
  await waitFor(() => port.messagesSent.some((m) => m.type === "TRIGGERED"));

  assert.equal(seenAuth, "Bearer dash-token-123", "dashboard token must be the credential fallback");
});

test("tester's own PAT wins over the dashboard token", async () => {
  let seenAuth = null;
  const harness = loadOsTest({
    store: {
      githubPat: "own-pat-abc",
      settings: { githubToken: "dash-token-xyz" },
      repoOwner: "o",
      repoName: "r",
    },
    fetchImpl: async (url, init) => {
      if (url.includes("/dispatches")) {
        seenAuth = init.headers.Authorization;
        return { ok: true, status: 204, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => null };
    },
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });
  await waitFor(() => port.messagesSent.some((m) => m.type === "TRIGGERED"));

  assert.equal(seenAuth, "Bearer own-pat-abc", "own PAT must take precedence");
});

test("dashboard token alone is not enough — owner/repo still required", async () => {
  const harness = loadOsTest({
    store: { settings: { githubToken: "dash-token" }, repoOwner: "o" }, // repoName missing
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com" });
  await waitFor(() => port.messagesSent.some((m) => m.type === "ERROR"));

  assert.equal(port.messagesSent[0].error, "MISSING_CREDENTIALS");
});
