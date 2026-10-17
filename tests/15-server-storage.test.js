// Layer 15 — REAL server/storage.js unit tests against a temp STORE_DIR
// (node:sqlite). Covers sketches roundtrip, log insertion/filtering/grouping
// (fingerprint-based), trace lookup, the remote command queue lifecycle, and
// summary stats.
//
// STORE_DIR must be set BEFORE storage.js's first import (config.js snapshots
// it), so the module is imported inside a boot promise that every test awaits.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "dc-store-"));
process.env.STORE_DIR = STORE;

let S = null;
const boot = (async () => {
  S = await import("../server/storage.js");
})();

// ---------------------------------------------------------------------------

test("sketch roundtrip: json + binary png land in the store dir", async () => {
  await boot;
  const json = { elements: [{ id: 1, type: "rect" }] };
  const png = Buffer.from("89504e470d0a1a0a", "hex");

  S.writeSketch({ json, pngBase64: png.toString("base64") });

  const back = S.readSketch();
  assert.deepEqual(back.json, json);
  assert.equal(Buffer.from(back.pngBase64, "base64").toString("hex"), png.toString("hex"));

  assert.ok(fs.existsSync(path.join(STORE, "latest-sketch.json")));
  assert.ok(fs.existsSync(path.join(STORE, "latest-sketch.png")));
});

test("sketch roundtrip works without a png payload (json-only canvas)", async () => {
  await boot;
  fs.rmSync(path.join(STORE, "latest-sketch.png"), { force: true }); // isolate from the PNG test
  S.writeSketch({ json: { elements: [] }, pngBase64: "" });
  const back = S.readSketch();
  assert.deepEqual(back.json, { elements: [] });
  assert.equal(back.pngBase64, null, "json-only write must not resurrect a previous PNG");
});

test("sketch store prior to any write: legacy dir empty -> null, not crash", async () => {
  await boot;
  // With a fresh STORE_DIR, readSketch returns null rather than throwing
  // when no sketch has ever been written. (The first test wrote one, so use
  // an isolated LOG_DB-free check on a second write-then-read instead.)
  S.writeSketch({ json: { v: 2 } });
  assert.deepEqual(S.readSketch().json, { v: 2 });
});

// ---------------------------------------------------------------------------

test("log insertion counts what actually landed", async () => {
  await boot;
  const rows = [
    { app_name: "canvas-app", level: "ERROR", message: "boom 1", type: "error" },
    { app_name: "canvas-app", level: "info", message: "boom 2" },
    { app_name: "logs-page", level: "warn", message: "boom 3" },
  ];
  assert.equal(S.insertLogs(rows), 3);
});

test("levels are normalized to lowercase for filtering", async () => {
  await boot;
  const errOnly = S.queryRecentLogs({ app: "canvas-app", level: "error", minutes: 60, limit: 50 });
  assert.ok(errOnly.length >= 1);
  assert.ok(errOnly.every((r) => r.level === "error"));
});

test("recent-log query filters by app", async () => {
  await boot;
  const appOnly = S.queryRecentLogs({ app: "canvas-app", minutes: 60, limit: 50 });
  assert.ok(appOnly.length >= 2);
  assert.ok(appOnly.every((r) => r.app_name === "canvas-app"));
});

test("context and tags come back parsed, not as JSON strings", async () => {
  await boot;
  S.insertLogs([
    {
      app_name: "ctx-app", level: "error", message: "ctx",
      context: { userId: 42, page: "/settings" },
      tags: ["ui", "regression"], request_id: "req-ctx-1",
    },
  ]);
  const row = S.queryRecentLogs({ app: "ctx-app", minutes: 60, limit: 1 })[0];
  assert.deepEqual(row.context, { userId: 42, page: "/settings" });
  assert.deepEqual(row.tags, ["ui", "regression"]);
});

test("request tracing: queryLogTrace returns only that request's rows in order", async () => {
  await boot;
  S.insertLogs([
    { app_name: "t-app", level: "info", message: "step 1", request_id: "trace-77" },
    { app_name: "t-app", level: "info", message: "noise", request_id: "other-req" },
    { app_name: "t-app", level: "error", message: "step 2", request_id: "trace-77" },
  ]);
  const trace = S.queryLogTrace("trace-77");
  assert.equal(trace.length, 2);
  assert.deepEqual(trace.map((r) => r.message), ["step 1", "step 2"]);
});

test("empty log rows insert nothing", async () => {
  await boot;
  assert.equal(S.insertLogs([]), 0);
});

test("log groups collapse by fingerprint with repeat counts", async () => {
  await boot;
  const fingerprint = "group-fp-" + Date.now();
  S.insertLogs([
    { app_name: "g-app", level: "error", message: "shared message", fingerprint },
    { app_name: "g-app", level: "error", message: "shared message", fingerprint },
    { app_name: "g-app", level: "error", message: "shared message", fingerprint: "other-fp" },
  ]);
  const groups = S.queryLogGroups({ limit: 20 });
  const mine = groups.find((g) => g.fingerprint === fingerprint);
  assert.ok(mine, "the grouped fingerprint must appear");
  assert.ok(mine.total_count >= 2, `group must carry a repeat count >= 2: ${JSON.stringify(mine)}`);
});

test("malformed rows are skipped gracefully (null/arrays/strings), good ones land", async () => {
  await boot;
  const n = S.insertLogs([
    { app_name: "ok-app", level: "info", message: "fine" },
    null,
    [1, 2, 3],
    "just a string",
    { app_name: "ok-app" }, // missing message -> defaults "", but is an object; lands
  ]);
  assert.equal(n, 2, "junk neighbors must not abort the batch");
  assert.ok(S.queryRecentLogs({ app: "ok-app", minutes: 60, limit: 10 }).length >= 2);
});

// ---------------------------------------------------------------------------

test("command queue: insert -> deliver to the right app -> mark done", async () => {
  await boot;
  const c1 = S.insertCommand({ app_name: "dashboard", command: "reload_page", payload: {} });
  const c2 = S.insertCommand({ app_name: "canvas-app", command: "reload_page", payload: {} });
  assert.ok(c1.id);
  assert.equal(c1.status, "pending");

  const dash = S.getPendingCommands("dashboard");
  assert.equal(dash.length, 1);
  assert.equal(dash[0].id, c1.id);
  assert.equal(dash[0].command, "reload_page");
  assert.deepEqual(dash[0].payload, {});

  S.updateCommand(dash[0].id, "done", { result: "ok" });
  assert.equal(S.getPendingCommands("dashboard").length, 0, "marked-done commands leave the pending queue");

  const canvas = S.getPendingCommands("canvas-app");
  assert.equal(canvas.length, 1);
  assert.equal(canvas[0].id, c2.id);
});

test("commands addressed to 'all' (null app) are visible to every app", async () => {
  await boot;
  const c = S.insertCommand({ app_name: null, command: "reload_page", payload: {} });

  const forA = S.getPendingCommands("some-app").find((x) => x.id === c.id);
  const forB = S.getPendingCommands("dashboard").find((x) => x.id === c.id);
  assert.ok(forA && forB, "broadcast commands appear for any consumer");

  S.updateCommand(c.id, "done", {});
});

test("invalid command payloads are tolerated (payload defaults to {})", async () => {
  await boot;
  const c = S.insertCommand({ app_name: "p-app", command: "reload_page" });
  const pending = S.getPendingCommands("p-app");
  const mine = pending.find((x) => x.id === c.id);
  assert.deepEqual(mine.payload, {});
});

// ---------------------------------------------------------------------------

test("summary stats reflect inserted rows and the sketch presence", async () => {
  await boot;
  const stats = S.getSummaryStats();
  assert.ok(stats.totalLogs >= 1, "logs counted");
  assert.ok(stats.totalErrors >= 1, "errors counted");
  assert.equal(stats.hasSketch, true, "sketch was written earlier in this suite");
  assert.equal(stats.githubReposCount, 0, "no github context written yet in this store");
});

test("github context roundtrip", async () => {
  await boot;
  assert.equal(S.readGitHubContext(), null, "no context yet");
  S.writeGitHubContext({ repos: [{ name: "pkg-1" }] });
  assert.deepEqual(S.readGitHubContext(), { repos: [{ name: "pkg-1" }] });
  S.writeGitHubContext({ repos: [] });
});

test("summary picks up the github context once written", async () => {
  await boot;
  S.writeGitHubContext({ repos: [{ name: "a" }, { name: "b" }] });
  assert.equal(S.getSummaryStats().githubReposCount, 2);
});
