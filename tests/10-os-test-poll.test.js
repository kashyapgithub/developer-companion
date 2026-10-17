// Layer 10 — poll & stream lifecycle: screenshots stream in as committed,
// unselected combos are ignored, the 6-minute timeout path fires, an
// aborted/disconnected port stops posting, and each combo resolves exactly once.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { rootPath, makePort, makeDateMock, waitFor } = require("./helpers");
const { loadOsTest } = require("./08-os-test-credentials.test.js");

const CREDS = { githubPat: "tok", repoOwner: "o", repoName: "r" };

/** Fetch mock: returns a PNG only for a specific subset of paths (per attempt counter). */
function makeResultsFetch({ availableAfterAttempt = 0, allowedCombos }) {
  let attempt = 0;
  return async (url) => {
    if (url.includes("/dispatches")) {
      return { ok: true, status: 204, json: async () => ({}) };
    }
    const combo = url.match(/run-\d+\/([\w]+)-([\w]+)\.png/);
    attempt += 1;
    if (combo && allowedCombos.has(`${combo[1]}-${combo[2]}`) && attempt > availableAfterAttempt) {
      return {
        ok: true,
        status: 200,
        json: async () => null,
        arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
      };
    }
    return { ok: false, status: 404, json: async () => null };
  };
}

test("committed screenshots stream in one by one, then RUN_FINISHED fires", async () => {
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000,
    fetchImpl: makeResultsFetch({ allowedCombos: new Set(["linux-chromium"]), availableAfterAttempt: 2 }),
  });
  const port = harness.connect();
  port.onMessage.listener({
    type: "START", testMode: "url", targetUrl: "https://example.com",
    browsers: ["chromium", "firefox"], fullPage: true,
  });
  await waitFor(() => port.messagesSent.some((m) => m.type === "RUN_FINISHED"));

  const readies = port.messagesSent.filter((m) => m.type === "COMBO_READY");
  const finished = port.messagesSent.find((m) => m.type === "RUN_FINISHED");

  assert.equal(readies.length, 1, "only the one committed combo label arrives");
  assert.ok(readies.every((m) => m.label === "Linux · Chrome"), "only the committed combo label arrives");
  assert.equal(finished.timedOut, true, "missing combos must end in a timeout verdict");
});

test("when every selected combo commits, timeout is false", async () => {
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000,
    fetchImpl: makeResultsFetch({ allowedCombos: new Set(["windows-chromium", "macos-chromium", "linux-chromium"]), availableAfterAttempt: 1 }),
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });
  await waitFor(() => port.messagesSent.some((m) => m.type === "RUN_FINISHED"));

  const readies = port.messagesSent.filter((m) => m.type === "COMBO_READY");
  assert.equal(readies.length, 3);
  assert.equal(port.messagesSent.find((m) => m.type === "RUN_FINISHED").timedOut, false);
  assert.equal(readies.map((m) => m.os).sort().join(","), "linux,macos,windows");
  assert.ok(readies.every((m) => String(m.imageUrl).startsWith("data:image/png;base64,")));
});

test("each combo resolves EXACTLY once (no duplicate COMBO_READY)", async () => {
  // Make the file "exist" for linux-chromium on every poll attempt; the run
  // ends via the poll timeout (chromium has 3 combos, only 1 commits).
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000,
    fetchImpl: makeResultsFetch({ allowedCombos: new Set(["linux-chromium"]), availableAfterAttempt: 0 }),
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });
  await waitFor(() => port.messagesSent.some((m) => m.type === "RUN_FINISHED"), { label: "RUN_FINISHED" });

  const linuxReady = port.messagesSent.filter((m) => m.type === "COMBO_READY" && m.label === "Linux · Chrome");
  assert.equal(linuxReady.length, 1, "a committed combo must never be reported twice");
});

test("disconnecting the port stops the poller: no further posts, no crash", async () => {
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000,
    fetchImpl: makeResultsFetch({ allowedCombos: new Set(["linux-chromium"]), availableAfterAttempt: 0 }),
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });

  await waitFor(() => port.messagesSent.length >= 2); // TRIGGERED (+ maybe a COMBO_READY)
  const countAtDisconnect = port.messagesSent.length;
  port.disconnect();
  port.onDisconnect.listener(); // signal aborted

  // Give the poll loop plenty more spin; nothing new may appear.
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
  assert.equal(port.messagesSent.length, countAtDisconnect, "no messages may arrive after disconnect");
  assert.ok(!port.messagesSent.some((m) => m.type === "RUN_FINISHED"));
});

test("6-minute polling timeout fires when nothing ever commits", async () => {
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000,
    fetchImpl: makeResultsFetch({ allowedCombos: new Set(), availableAfterAttempt: 0 }),
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });
  await waitFor(() => port.messagesSent.some((m) => m.type === "RUN_FINISHED"), { maxSteps: 5000, label: "timeout RUN_FINISHED" });

  const finished = port.messagesSent.find((m) => m.type === "RUN_FINISHED");
  assert.equal(finished.timedOut, true);
  assert.equal(port.messagesSent.filter((m) => m.type === "COMBO_READY").length, 0);
});

test("a listener receiving non-START messages is ignored silently", async () => {
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000,
    fetchImpl: makeResultsFetch({ allowedCombos: new Set() }),
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "POLL" }); // not "START"
  port.onMessage.listener({});               // no type at all
  await new Promise((r) => setImmediate(r));
  assert.equal(port.messagesSent.length, 0, "non-START messages must not trigger anything");
});
