// Layer 16 — the REAL server.js HTTP receiver, spawned as a child process on
// an ephemeral port with an isolated STORE_DIR, then driven end-to-end over
// real TCP: health, sketch save, log ingestion + filtered queries, groups,
// traces, github context, the remote command queue, CORS preflight, and the
// 404/400 fallbacks. (The 413 oversized-body path isn't exercised: the limit
// is 60MB for big PNG wireframes and a >60MB synthetic payload is impractical.)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

// A free localhost port.
const getPort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "dc-http-"));

// PORT/BASE resolve inside the boot promise; tests await bootServer first.
let PORT = null;
let BASE = null;

let child = null;
let booted = false;

const bootServer = (async () => {
  PORT = await getPort();
  BASE = `http://127.0.0.1:${PORT}`;

  const ready = new Promise((resolve) => {
    child = spawn(process.execPath, [path.join(ROOT, "server", "server.js")], {
      env: { ...process.env, STORE_DIR: STORE, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stderr.on("data", (d) => {
      out += d.toString();
      if (out.includes("HTTP receiver listening")) {
        booted = true;
        resolve(true);
      }
    });
    child.on("exit", () => { if (!booted) resolve(false); });
  });

  return Promise.race([
    ready,
    new Promise((r) => setTimeout(() => r(false), 20000)),
  ]);
})();

const jsonFetch = async (p, { method = "GET", body, headers = {} } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
};

process.on("exit", () => { if (child && child.exitCode === null) child.kill("SIGKILL"); });

// ---------------------------------------------------------------------------

test("boot: HTTP receiver localhost endpoint comes up before tests hit it", async () => {
  const up = await bootServer;
  assert.ok(up, "server must announce its HTTP listener within 20s");
});

test("/health returns the service banner with live stats", async () => {
  const { status, json } = await jsonFetch("/health");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.service, "developer-companion");
  assert.equal(json.port, PORT);
  assert.equal(json.lan, false, "no config.json → LAN off by default");
  assert.equal(json.authRequired, false, "loopback with no token requires no code");
  assert.ok(json.stats && typeof json.stats.totalLogs === "number", "stats object present");
});

test("CORS preflight answers 204 with permissive headers", async () => {
  const res = await fetch(BASE + "/save", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.ok(res.headers.get("access-control-allow-methods").includes("POST"));
  assert.ok(res.headers.get("access-control-allow-headers").includes("X-Sketch-Token"));
});

test("POST /save writes the sketch; health then reports hasSketch", async () => {
  const sketch = { elements: [{ type: "button", label: "Submit", x: 10, y: 20 }] };
  const { status, json } = await jsonFetch("/save", {
    method: "POST",
    body: { json: sketch, pngBase64: Buffer.from("fakepngbytes").toString("base64") },
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true, "save acknowledged");

  const { json: health } = await jsonFetch("/health");
  assert.equal(health.stats.hasSketch, true);
});

test("POST /logs reports the inserted count; GET returns them filtered", async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
    app_name: "http-app",
    level: i % 2 ? "error" : "info",
    message: `http-log-${i}`,
    context: { i },
  }));
  const ins = await jsonFetch("/logs", { method: "POST", body: rows });
  assert.equal(ins.status, 200);
  assert.equal(ins.json.ok, true);
  assert.equal(ins.json.inserted, 7);

  const recent = await jsonFetch("/logs/recent?app=http-app&limit=50");
  assert.equal(recent.status, 200);
  assert.ok(recent.json.logs.length >= 7);
  assert.ok(recent.json.logs.every((r) => r.app_name === "http-app"));
  // context should arrive as parsed objects
  const withCtx = recent.json.logs.find((r) => r.message === "http-log-1");
  assert.deepEqual(withCtx.context, { i: 1 });

  const errOnly = await jsonFetch("/logs/recent?app=http-app&level=error&limit=50");
  assert.ok(errOnly.json.logs.length >= 3);
  assert.ok(errOnly.json.logs.every((r) => r.level === "error"));
});

test("GET /logs/groups returns fingerprint groups with counts", async () => {
  const fp = "http-fp-" + Date.now();
  await jsonFetch("/logs", {
    method: "POST",
    body: [
      { app_name: "http-app", level: "error", message: "same", fingerprint: fp },
      { app_name: "http-app", level: "error", message: "same", fingerprint: fp },
    ],
  });
  const { json } = await jsonFetch("/logs/groups?limit=50");
  const mine = json.groups.find((g) => g.fingerprint === fp);
  assert.ok(mine, "grouped fingerprint visible");
  assert.ok(mine.total_count >= 2);
});

test("GET /logs/trace returns a request's rows in chronological order", async () => {
  const rid = "trace-http-" + Date.now();
  await jsonFetch("/logs", {
    method: "POST",
    body: [
      { app_name: "http-app", level: "info", message: "start", request_id: rid },
      { app_name: "http-app", level: "error", message: "end", request_id: rid },
    ],
  });
  const { json } = await jsonFetch(`/logs/trace?request_id=${rid}`);
  assert.ok(Array.isArray(json.trace));
  assert.deepEqual(json.trace.map((r) => r.message), ["start", "end"]);
});

test("missing request_id on /logs/trace is a 400", async () => {
  const { status, json } = await jsonFetch("/logs/trace");
  assert.equal(status, 400);
  assert.match(json.error, /Missing request_id/);
});

test("GET /api/github/context + POST roundtrip", async () => {
  const before = await jsonFetch("/api/github/context");
  assert.equal(before.json.ok, true);

  const payload = { repos: [{ name: "demo-repo" }], fetchedAt: Date.now() };
  const wrote = await jsonFetch("/api/github/context", { method: "POST", body: payload });
  assert.equal(wrote.json.ok, true);

  const after = await jsonFetch("/api/github/context");
  assert.deepEqual(after.json.context, payload);
});

test("command queue over HTTP: enqueue → pending → patch → drained", async () => {
  const created = await jsonFetch("/commands", {
    method: "POST",
    body: { app_name: "http-ext", command: "reload_page", payload: { reason: "test" } },
  });
  assert.equal(created.status, 200);
  const id = created.json.id;
  assert.ok(id);

  const pending = await jsonFetch("/commands/pending?app=http-ext");
  const found = pending.json.find((c) => c.id === id);
  assert.ok(found, "the new command is pending for its app");
  assert.deepEqual(found.payload, { reason: "test" });

  const patched = await jsonFetch(`/commands/${id}`, {
    method: "PATCH",
    body: { status: "completed", result: { ok: true } },
  });
  assert.equal(patched.json.ok, true);

  const after = await jsonFetch("/commands/pending?app=http-ext");
  assert.ok(!after.json.some((c) => c.id === id), "drained after completion");
});

test("accepts an empty-string 200 for PATCH on unknown ids (fixed queue semantics)", async () => {
  // PATCH to a nonexistent id must not crash the server.
  const res = await jsonFetch("/commands/999999", { method: "PATCH", body: { status: "done" } });
  assert.equal(res.status, 200);
});

const junk = undefined;
test("invalid JSON body is a 400, not a crash", async () => {
  const res = await fetch(BASE + "/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json!!",
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /Invalid JSON/);
});

test("unknown routes get a JSON 404", async () => {
  const { status, json } = await jsonFetch("/definitely/not/a/route");
  assert.equal(status, 404);
  assert.equal(json.ok, false);
});

test("malformed log rows over HTTP never 500 (they skip and insert the rest)", async () => {
  const res = await jsonFetch("/logs", {
    method: "POST",
    body: [{ app_name: "http-app", level: "info", message: "fine" }, null],
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.inserted, 1, "junk skipped, good rows land");
});

// ---------------------------------------------------------------------------

test("cleanup: the spawned server is killed", async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  assert.ok(true);
});
