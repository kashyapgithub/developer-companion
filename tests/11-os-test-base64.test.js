// Layer 11 — the byte-exact screenshot round-trip (regression guard for the
// chunked arrayBufferToBase64 implementation):
// chunk boundaries at 8191/8192/8193 bytes, exact multiples, and multi-chunk
// payloads must all survive the ArrayBuffer → data-URL conversion unchanged,
// as delivered to the studio page in a real COMBO_READY message.

const test = require("node:test");
const assert = require("node:assert/strict");
const { waitFor } = require("./helpers");
const { loadOsTest } = require("./08-os-test-credentials.test.js");

const CREDS = { githubPat: "tok", repoOwner: "o", repoName: "r" };

function runWithBytes(byteLength, fill) {
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) bytes[i] = fill(i);

  let contentsAttempt = 0;
  const harness = loadOsTest({
    store: CREDS,
    clockStepMs: 10_000,
    fetchImpl: async (url) => {
      if (url.includes("/dispatches")) return { ok: true, status: 204, json: async () => ({}) };
      contentsAttempt += 1;
      return {
        ok: true,
        status: 200,
        json: async () => null,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
  });

  const port = harness.connect();
  port.onMessage.listener({ type: "START", testMode: "url", targetUrl: "https://example.com", browsers: ["chromium"] });
  return { port, bytes };
}

const CASES = [
  ["1 byte", 1],
  ["exactly one chunk minus one (8191)", 8191],
  ["exactly one chunk (8192)", 8192],
  ["one chunk plus one (8193)", 8193],
  ["exactly two chunks (16384)", 16384],
  ["odd multi-chunk size (100_000)", 100_000],
  ["multi-MB full-page-like payload (2_500_000)", 2_500_000],
];

for (const [name, size] of CASES) {
  test(`byte-exact round-trip: ${name}`, async () => {
    const { port, bytes } = runWithBytes(size, (i) => (i * 7 + 13) % 256);
    await waitFor(() => port.messagesSent.some((m) => m.type === "COMBO_READY"));

    const ready = port.messagesSent.find((m) => m.type === "COMBO_READY");
    assert.match(ready.imageUrl, /^data:image\/png;base64,/);

    const expected = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    assert.equal(ready.imageUrl, expected, `payload of ${size} bytes must round-trip byte-exactly`);
  });
}

test("empty payload still produces a valid (empty-image) data URL rather than hanging", async () => {
  const { port } = runWithBytes(0, () => 0);
  await waitFor(() => port.messagesSent.some((m) => m.type === "COMBO_READY"));
  const ready = port.messagesSent.find((m) => m.type === "COMBO_READY");
  assert.match(ready.imageUrl, /^data:image\/png;base64,/);
  assert.equal(ready.imageUrl, "data:image/png;base64,");
});
