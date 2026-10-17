// Layer 17 — the REAL MCP server over stdio: boot server.js as a child
// process, connect with the official SDK client (from server/node_modules),
// list the tools, and drive sketch/log/command/status/cross-os round-trips
// exactly like Claude Code or Cursor would. HTTP ingestion feeds the same
// store so cross-surface consistency is verified implicitly.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const ROOT = path.join(__dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "dc-mcp-"));

// Deterministic cross-os target: a repository that certainly does not exist,
// so the tool must answer with its graceful "no results branch" guidance
// (network permitting; the test skips politely when offline).
fs.writeFileSync(
  path.join(STORE, "config.json"),
  JSON.stringify({
    crossOsOwner: "kashyapgithub",
    crossOsRepo: "definitely-not-a-real-repo-xyz42-000",
    githubToken: "",
  }, null, 2)
);

let BOOT_PORT = null;
let client = null;

const boot = (async () => {
  BOOT_PORT = await getPort();
  const ClientMod = await import(
    path.join(SERVER_DIR, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "index.js")
  );
  const TransportMod = await import(
    path.join(SERVER_DIR, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "stdio.js")
  );

  const transport = new TransportMod.StdioClientTransport({
    command: process.execPath,
    args: [path.join(SERVER_DIR, "server.js")],
    cwd: SERVER_DIR,
    env: { ...process.env, STORE_DIR: STORE, PORT: String(BOOT_PORT) },
  });

  client = new ClientMod.Client({ name: "dc-test-client", version: "1.0.0" });
  await client.connect(transport);
})();

const callTool = async (name, args = {}) => {
  await boot;
  return client.callTool({ name, arguments: args });
};
const firstText = (res) =>
  (res.content || []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
const httpCall = (p, init = {}) => fetch(`http://127.0.0.1:${BOOT_PORT}${p}`, init);

// ---------------------------------------------------------------------------

test("MCP client connects over stdio", async () => {
  await boot;
  assert.ok(client, "client initialized");
});

test("the advertised core tools exist with schemas and descriptions (superset over the grown registry)", async () => {
  await boot;
  const list = await client.listTools();
  const names = list.tools.map((t) => t.name);

  // The registry grew as the product grew (API client, flow, motion, checks,
  // vitals…). The contract this suite defends is: these SIX core tools are
  // always present, and EVERY listed tool carries a real description.
  const core = [
    "get_latest_sketch",
    "get_browser_logs",
    "get_github_repos",
    "send_browser_command",
    "get_companion_status",
    "get_cross_os_results",
  ];
  const missing = core.filter((n) => !names.includes(n));
  assert.deepEqual(missing, [], "the 6 foundational agent tools must stay registered");
  assert.ok(names.length >= 6, "registry holds at least the core set");

  const byName = Object.fromEntries(list.tools.map((t) => [t.name, t]));
  assert.ok(byName.send_browser_command.inputSchema.properties.command, "send_browser_command requires a command");
  assert.ok(byName.get_cross_os_results.inputSchema.properties.run_tag, "cross-os tool accepts run_tag");
  for (const t of list.tools) {
    assert.ok(t.description && t.description.length > 40, `${t.name} has a meaningful description`);
  }
});

test("get_latest_sketch: guidance before any sketch; text+image after HTTP save", async () => {
  await boot;

  const before = await callTool("get_latest_sketch");
  assert.match(firstText(before), /No sketch has been exported yet/);

  const save = await httpCall("/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: { elements: [{ type: "card", label: "MCP test card" }] },
      pngBase64: Buffer.from("89504e470d0a1a0a-FAKE-PNG", "binary").toString("base64"),
    }),
  });
  assert.equal((await save.json()).ok, true);

  const after = await callTool("get_latest_sketch");
  assert.deepEqual(after.content.map((c) => c.type), ["text", "image"], "sketch returns JSON text plus PNG image");
  assert.match(after.content.find((c) => c.type === "text").text, /MCP test card/);
  assert.equal(after.content.find((c) => c.type === "image").mimeType, "image/png");
});

test("get_browser_logs filters by app and level, with 'no logs' guidance on empty", async () => {
  await boot;
  await httpCall("/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { app_name: "mcp-log", level: "error", message: "mcp-e1" },
      { app_name: "mcp-log", level: "info", message: "mcp-i1" },
      { app_name: "other-log", level: "error", message: "other-e1" },
    ]),
  });

  const all = JSON.parse(firstText(await callTool("get_browser_logs", { app: "mcp-log" })));
  assert.ok(Array.isArray(all) && all.length >= 2);
  assert.ok(all.every((r) => r.app_name === "mcp-log"));

  const errs = JSON.parse(firstText(await callTool("get_browser_logs", { app: "mcp-log", level: "error" })));
  assert.ok(errs.length >= 1);
  assert.ok(errs.every((r) => r.level === "error" && r.app_name === "mcp-log"));

  const none = await callTool("get_browser_logs", { app: "mcp-log", level: "fatal", minutes: 5 });
  assert.match(firstText(none), /No browser logs found/);
});

test("send_browser_command queues; the command reaches the browser queue over HTTP", async () => {
  await boot;
  const queued = await callTool("send_browser_command", {
    command: "reload_page",
    app_name: "mcp-target",
    payload: { why: "mcp-test" },
  });
  assert.match(firstText(queued), /Command queued \(ID: \d+\)/);

  const pending = await (await httpCall("/commands/pending?app=mcp-target")).json();
  assert.ok(
    pending.some((c) => c.command === "reload_page" && c.payload.why === "mcp-test"),
    "the queued command is delivered over the command queue"
  );
});

test("get_companion_status returns aggregate stats reflecting earlier calls", async () => {
  await boot;
  const stats = JSON.parse(firstText(await callTool("get_companion_status")));
  assert.ok(typeof stats.totalLogs === "number" && stats.totalLogs >= 3);
  assert.ok(typeof stats.totalErrors === "number");
  assert.equal(stats.hasSketch, true);
});

test("get_github_repos: guidance before cache; search filtering after POST", async () => {
  await boot;
  const before = await callTool("get_github_repos");
  assert.match(firstText(before), /No GitHub repository catalog cached yet/);

  await httpCall("/api/github/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repos: [
        { name: "left-pad-js", description: "utility" },
        { name: "giant-canvas", description: "whiteboard" },
      ],
    }),
  });

  const repos = JSON.parse(firstText(await callTool("get_github_repos")));
  assert.equal(repos.length, 2);

  const filtered = JSON.parse(firstText(await callTool("get_github_repos", { search: "canvas" })));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "giant-canvas");
});

test("get_cross_os_results answers gracefully for a nonexistent repository", async () => {
  await boot;

  try {
    await fetch("https://api.github.com/zen", { signal: AbortSignal.timeout(8000) });
  } catch {
    return; // offline machine: nothing to prove here
  }

  const res = await callTool("get_cross_os_results");
  const text = firstText(res);
  assert.match(
    text,
    /No 'results' branch|not configured|HTTP 4/,
    "either config guidance, the 404 guidance, or a JSON result is acceptable"
  );
});

// ---------------------------------------------------------------------------

test("cleanup: MCP child is closed", async () => {
  await boot;
  try { await client.close(); } catch {}
  assert.ok(true);
});

function getPort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
