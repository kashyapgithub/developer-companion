// Layer 14 — REAL settings.js user flows against a minimal DOM + chrome mock:
// prefill (own PAT + Dashboard-token reuse placeholder), Show/Hide toggle,
// validation matrix (missing owner/repo, no token at all, Dashboard fallback
// without pasting), HTTP response mapping (200/401/404/403/other), and the
// offline "save locally" path.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { rootPath, makeElement, makeDocument, flushMicrotasks } = require("./helpers");

const SOURCE = fs.readFileSync(rootPath("os-test/settings.js"), "utf8");

function loadSettings({ store = {}, fetchImpl } = {}) {
  const elements = {
    "setup-form": makeElement("setup-form"),
    "pat-input": makeElement("pat-input", { type: "password" }), // real markup default
    "owner-input": makeElement("owner-input"),
    "repo-input": makeElement("repo-input"),
    "toggle-token-btn": makeElement("toggle-token-btn"),
    "save-btn": makeElement("save-btn"),
    "status-message": makeElement("status-message"),
  };

  const fetchCalls = [];
  const documentMock = makeDocument({ elements });
  let storeNow = { ...store };

  const chromeMock = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in storeNow) res[k] = storeNow[k];
          return res;
        },
        set: async (obj) => { storeNow = { ...storeNow, ...obj }; },
      },
    },
  };

  const sandbox = {
    document: documentMock,
    chrome: chromeMock,
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "os-test/settings.js" });

  const submit = async (values) => {
    if (values.pat !== undefined) elements["pat-input"].value = values.pat;
    if (values.owner !== undefined) elements["owner-input"].value = values.owner;
    if (values.repo !== undefined) elements["repo-input"].value = values.repo;
    const handler = elements["setup-form"]._listeners.submit[0];
    handler({ preventDefault() {} });
    for (let i = 0; i < 8; i++) await flushMicrotasks();
  };

  return { elements, fetchCalls, getStore: () => storeNow, submit };
}

/** Load settings the way the browser would (async storage reads settle before interaction). */
async function openSettings(opts = {}) {
  const controls = loadSettings(opts);
  for (let i = 0; i < 4; i++) await flushMicrotasks();
  return controls;
}

const ok200 = () => ({ ok: true, status: 200 });

test("prefills owner/repo and shows the Dashboard-token reuse placeholder (PAT field stays empty)", async () => {
  const { elements } = await openSettings({
    store: {
      settings: { githubToken: "dash-token-long" },
      repoOwner: "kashyapgithub",
      repoName: "website-cross-operating-system-testing",
    },
  });

  assert.equal(elements["owner-input"].value, "kashyapgithub");
  assert.equal(elements["repo-input"].value, "website-cross-operating-system-testing");
  assert.equal(elements["pat-input"].value, "", "never echo a dashboard token into an editable field");
  assert.match(elements["pat-input"].placeholder, /Reusing GitHub Dashboard token/);
  assert.match(elements["pat-input"].placeholder, /dash-to/);
});

test("own saved PAT prefills the PAT field with no placeholder", async () => {
  const { elements } = await openSettings({
    store: { githubPat: "ghp_own_token", repoOwner: "o", repoName: "r" },
  });

  assert.equal(elements["pat-input"].value, "ghp_own_token");
  assert.ok(!elements["pat-input"].placeholder);
});

test("Show/Hide toggles the PAT field type and its label", async () => {
  const { elements } = await openSettings();
  const btn = elements["toggle-token-btn"];
  const pat = elements["pat-input"];

  assert.equal(pat.type, "password");
  btn._fire("click");
  assert.equal(pat.type, "text");
  assert.equal(btn.textContent, "Hide");
  btn._fire("click");
  assert.equal(pat.type, "password");
  assert.equal(btn.textContent, "Show");
});

test("missing owner/repo is rejected locally without any network or save", async () => {
  let fetchCalls = 0;
  const s = await openSettings({ fetchImpl: async () => { fetchCalls += 1; return ok200(); } });
  await s.submit({ pat: "t", owner: "", repo: "" });

  assert.equal(fetchCalls, 0);
  assert.match(s.elements["status-message"].textContent, /fill in the repo owner and repo name/);
  assert.ok(!("repoOwner" in s.getStore()));
});

test("no pasted PAT + no Dashboard token -> told to create one first", async () => {
  const s = await openSettings({ store: {}, fetchImpl: async () => ok200() });
  await s.submit({ pat: "", owner: "o", repo: "r" });

  assert.match(s.elements["status-message"].textContent, /No token pasted/);
  assert.ok(!("repoOwner" in s.getStore()), "nothing saved when credentials are incomplete");
});

test("empty PAT + Dashboard token present -> verifies WITHOUT auth header but saves owner/repo", async () => {
  const s = await openSettings({
    store: { settings: { githubToken: "dash-token" } },
    fetchImpl: async () => ok200(),
  });
  await s.submit({ pat: "", owner: "kashyapgithub", repo: "target-repo" });

  assert.equal(s.fetchCalls.length, 1);
  assert.deepEqual({ ...s.fetchCalls[0].init.headers }, {}, "no Authorization header sent for the public-repo check");
  assert.equal(s.fetchCalls[0].url, "https://api.github.com/repos/kashyapgithub/target-repo");

  const store = s.getStore();
  assert.equal(store.repoOwner, "kashyapgithub");
  assert.equal(store.repoName, "target-repo");
  assert.ok(!("githubPat" in store), "must NOT persist an empty PAT over the Dashboard fallback");
  assert.match(s.elements["status-message"].textContent, /Verified & Connected/);
});

test("pasted PAT is verified with Bearer auth and persisted", async () => {
  const s = await openSettings({ store: {}, fetchImpl: async () => ok200() });
  await s.submit({ pat: "ghp_dispatch_pat", owner: "o", repo: "r" });

  assert.equal(s.fetchCalls[0].init.headers.Authorization, "Bearer ghp_dispatch_pat");
  assert.match(s.elements["status-message"].textContent, /Verified & Connected/);
  const store = s.getStore();
  assert.equal(store.githubPat, "ghp_dispatch_pat");
  assert.equal(store.repoOwner, "o");
});

for (const [status, mustMatch] of [
  [401, /401 Unauthorized[\s\S]*copied the token completely/],
  [404, /404 Not Found[\s\S]*could not be found/],
  [403, /403 Forbidden[\s\S]*Actions: Read & write/],
  [500, /status 500/],
]) {
  test(`GitHub ${status} maps to its dedicated guidance, nothing saved`, async () => {
    const s = await openSettings({ store: {}, fetchImpl: async () => ({ ok: false, status }) });
    await s.submit({ pat: "t", owner: "o", repo: "r" });

    assert.match(s.elements["status-message"].textContent, mustMatch);
    const store = s.getStore();
    assert.ok(!("repoOwner" in store) && !("githubPat" in store));
  });
}

test("network failure saves the credentials locally with a warning", async () => {
  const s = await openSettings({
    store: {},
    fetchImpl: async () => { throw new Error("offline"); },
  });
  await s.submit({ pat: "ghp_tok", owner: "o", repo: "r" });

  const store = s.getStore();
  assert.equal(store.githubPat, "ghp_tok");
  assert.equal(store.repoOwner, "o");
  assert.match(s.elements["status-message"].textContent, /Saved locally[\s\S]*offline/);
});

test("save button disables while verifying and re-enables afterwards", async () => {
  let release;
  const s = await openSettings({
    store: {},
    fetchImpl: () => new Promise((r) => { release = r; }), // hold the verification open
  });
  const save = s.elements["save-btn"];

  // Fill the form so validation passes and the verify request starts.
  s.elements["pat-input"].value = "tok";
  s.elements["owner-input"].value = "o";
  s.elements["repo-input"].value = "r";

  const handler = s.elements["setup-form"]._listeners.submit[0];
  handler({ preventDefault() {} });
  for (let i = 0; i < 4; i++) await flushMicrotasks();
  assert.equal(save.disabled, true, "guard against double-submit while verification is in flight");

  release({ ok: true, status: 200 });
  for (let i = 0; i < 6; i++) await flushMicrotasks();
  assert.equal(save.disabled, false, "re-enabled after completion");
});
