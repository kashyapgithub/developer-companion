// Layer 9 — workflow dispatch: request shape, browser-list handling, and the
// full GitHub error-status → user-facing message mapping.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadOsTest } = require("./08-os-test-credentials.test.js");
const { waitFor } = require("./helpers");

const CREDS = { githubPat: "tok", repoOwner: "o", repoName: "r" };

function makeHarness(dispatchResponder) {
  let dispatch = null;
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000, // advances the virtual clock so the 6-min poll timeout can't hang the test
    fetchImpl: async (url, init) => {
      if (url.includes("/dispatches")) {
        dispatch = { url, init };
        return dispatchResponder();
      }
      return { ok: false, status: 404, json: async () => null };
    },
  });
  const port = harness.connect();
  return { port, getDispatch: () => dispatch };
}

test("dispatch POST has the right endpoint, auth, and payload shape", async () => {
  const { port, getDispatch } = makeHarness(() => ({ ok: true, status: 204, json: async () => ({}) }));
  port.onMessage.listener({
    type: "START",
    testMode: "repo",
    targetUrl: "",
    repoPath: "docs/index.html",
    fullPage: false,
    browsers: ["chromium", "webkit"],
  });
  await waitFor(() => port.messagesSent.some((m) => m.type === "TRIGGERED"));

  const { url, init } = getDispatch();
  assert.equal(url, "https://api.github.com/repos/o/r/dispatches");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer tok");
  assert.equal(init.headers.Accept, "application/vnd.github+json");
  assert.equal(init.headers["Content-Type"], "application/json");

  const body = JSON.parse(init.body);
  assert.equal(body.event_type, "cross-os-test");
  assert.equal(body.client_payload.test_mode, "repo");
  assert.equal(body.client_payload.target_url, "");
  assert.equal(body.client_payload.repo_path, "docs/index.html");
  assert.equal(body.client_payload.full_page, false);
  assert.equal(body.client_payload.browsers, "chromium,webkit");
  assert.match(body.client_payload.run_tag, /^run-\d+$/);
});

test("TRIGGERED combos reflect the requested browsers only", async () => {
  const { port } = makeHarness(() => ({ ok: true, status: 204, json: async () => ({}) }));
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["firefox"] });
  await waitFor(() => port.messagesSent.some((m) => m.type === "TRIGGERED"));

  const triggered = port.messagesSent.find((m) => m.type === "TRIGGERED");
  assert.equal(triggered.combinations.length, 3, "firefox runs on 3 OSes");
  assert.ok(triggered.combinations.every((c) => c.browser === "firefox"));
  assert.ok(triggered.combinations.every((c) => /^.+·.+/.test(c.label)), "labels present");
});

test("no browser selection defaults to chromium-only (backwards compatibility)", async () => {
  const { port } = makeHarness(() => ({ ok: true, status: 204, json: async () => ({}) }));
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com" });
  await waitFor(() => port.messagesSent.some((m) => m.type === "TRIGGERED"));

  const triggered = port.messagesSent.find((m) => m.type === "TRIGGERED");
  assert.equal(triggered.combinations.length, 3);
  assert.ok(triggered.combinations.every((c) => c.browser === "chromium"));
});

const STATUS_CASES = [
  [401, "401 Unauthorized", "Verify your token"],
  [403, "403 Forbidden", "Actions: Read & write"],
  [404, "404", "Check owner and repo names"],
  [422, "422", "Check the PAT"],
];

for (const [status, mustA, mustB] of STATUS_CASES) {
  test(`dispatch ${status} maps to a helpful ERROR message`, async () => {
    const { port } = makeHarness(() => ({ ok: false, status, json: async () => ({}) }));
    port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });
    await waitFor(() => port.messagesSent.some((m) => m.type === "ERROR"));

    const err = port.messagesSent.find((m) => m.type === "ERROR").error;
    assert.ok(err.includes(mustA) && err.includes(mustB), `message should mention "${mustA}" and "${mustB}": got "${err}"`);
  });
}

test("network failure during dispatch maps to a network error message", async () => {
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000,
    fetchImpl: async () => { throw new Error("net down"); },
  });
  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });
  await waitFor(() => port.messagesSent.some((m) => m.type === "ERROR"));

  const err = port.messagesSent.find((m) => m.type === "ERROR").error;
  assert.match(err, /Network failure connecting to GitHub: net down/);
});

test("a fullPage value of undefined defaults to true in the payload", async () => {
  const { port, getDispatch } = makeHarness(() => ({ ok: true, status: 204, json: async () => ({}) }));
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com" });
  await waitFor(() => port.messagesSent.some((m) => m.type === "TRIGGERED"));
  const body = JSON.parse(getDispatch().init.body);
  assert.equal(body.client_payload.full_page, true);
});
