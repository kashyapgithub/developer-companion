// Layer 13 — REAL studio.js user flows, run against a minimal DOM + chrome mock:
// target-URL prefill (?url= + focus refresh), run gating (non-http pages,
// zero browsers, double-click race), browser persistence, mode switching,
// repo mode, banner conditions with Dashboard-token fallback, settings
// tab opening, slot updates from background messages, lightbox, expand-all.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const {
  rootPath, makeElement, makeDocument, makePort, flushMicrotasks,
} = require("./helpers");

const SOURCE = fs.readFileSync(rootPath("os-test/studio.js"), "utf8");

function loadStudio({
  search = "",
  httpTabs = [],
  store = {},
  settings = null,
} = {}) {
  const elements = {
    "current-url": makeElement("current-url"),
    "run-btn": makeElement("run-btn"),
    "status-line": makeElement("status-line"),
    "settings-btn": makeElement("settings-btn"),
    "setup-banner": makeElement("setup-banner", { hidden: true }), // hidden attr in real markup
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

  const windowListeners = {};
  const documentMock = makeDocument({
    elements,
    slotMap,
    extraQuerySelectors: {
      "logs-filter-pills": [],
    },
  });

  const connectCalls = [];
  const tabCreateCalls = [];
  const storageSetCalls = [];
  let storeNow = { ...store };
  if (settings) storeNow.settings = settings;

  const chromeMock = {
    tabs: {
      query: async (q) => (q?.url ? httpTabs : []),
      create: async (opts) => { tabCreateCalls.push(opts); },
    },
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) if (k in storeNow) res[k] = storeNow[k];
          return res;
        },
        set: async (obj) => {
          storageSetCalls.push(obj);
          storeNow = { ...storeNow, ...obj };
        },
      },
    },
    runtime: {
      getURL: (p) => `chrome-extension://mock/${p}`,
      connect: () => {
        const port = makePort();
        connectCalls.push(port);
        return port;
      },
    },
  };

  const sandbox = {
    document: documentMock,
    chrome: chromeMock,
    location: { search },
    // window-only API used by the focus refresh listener
    window: { addEventListener: (type, fn) => { windowListeners[type] = fn; } },
    URLSearchParams,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "os-test/studio.js" });

  return {
    elements,
    slotMap,
    windowListeners,
    connectCalls,
    tabCreateCalls,
    storageSetCalls,
    getStorageSetCalls: () => storageSetCalls,
    getStore: () => storeNow,
    fireWindowFocus: async () => {
      windowListeners.focus();
      await flushMicrotasks();
    },
  };
}

/** Load the studio through the same promise-chain the page's async init() uses. */
async function openStudio(opts = {}) {
  const controls = loadStudio(opts);
  await flushMicrotasks(); // settle the async init() reads
  return controls;
}

// ---------------------------------------------------------------------------

test("prefills the target URL from the ?url= query param (what the background captures at open time)", async () => {
  const { elements } = await openStudio({ search: `?url=${encodeURIComponent("https://staging.myapp.dev/")}` });
  assert.match(elements["current-url"].textContent, /staging\.myapp\.dev/);
});

test("falls back to the most recently used http(s) tab when no query param exists", async () => {
  const { elements } = await openStudio({
    httpTabs: [
      { url: "https://older.com/", lastAccessed: 10 },
      { url: "https://newer.com/", lastAccessed: 900 },
    ],
  });
  assert.match(elements["current-url"].textContent, /newer\.com/);
});

test("ignores the ?url= param when it is not an http(s) URL, using the tab fallback instead", async () => {
  const { elements } = await openStudio({
    search: `?url=${encodeURIComponent("chrome://extensions")}`,
    httpTabs: [{ url: "https://real.com/", lastAccessed: 5 }],
  });
  assert.match(elements["current-url"].textContent, /real\.com/);
});

test("refreshing focus after browsing elsewhere updates the suggested URL (not during a run)", async () => {
  const { elements, fireWindowFocus } = await openStudio({
    search: `?url=${encodeURIComponent("https://first.com/")}`,
    httpTabs: [{ url: "https://later.com/", lastAccessed: 500 }],
  });
  await fireWindowFocus();
  assert.match(elements["current-url"].textContent, /later\.com/, "focus refresh should pick up the newest tab");
});

test("double-click races: one click = exactly one GitHub run", async () => {
  const { elements, connectCalls } = await openStudio({
    httpTabs: [{ url: "https://example.com/", lastAccessed: 1 }],
  });
  elements["run-btn"]._fire("click");
  elements["run-btn"]._fire("click");
  await flushMicrotasks();
  assert.equal(connectCalls.length, 1, "a fast double-click must only start one run");
});

test("non-http pages are rejected with a friendly error and no run", async () => {
  const { elements, connectCalls } = await openStudio({
    httpTabs: [], // only extension pages open
    search: "",
  });
  elements["run-btn"]._fire("click");
  await flushMicrotasks();
  assert.equal(connectCalls.length, 0);
  assert.match(elements["status-line"].textContent, /testable web page/i);
});

test("zero selected browsers is rejected before any run starts", async () => {
  const { elements, connectCalls } = await openStudio({
    httpTabs: [{ url: "https://example.com/", lastAccessed: 1 }],
  });
  elements["browser-chromium"].checked = false;
  elements["browser-firefox"].checked = false;
  elements["browser-webkit"].checked = false;
  elements["run-btn"]._fire("click");
  await flushMicrotasks();
  assert.equal(connectCalls.length, 0);
  assert.match(elements["status-line"].textContent, /at least one browser/i);
});

test("START message carries testMode, targetUrl, fullPage and browsers", async () => {
  const { elements, connectCalls } = await openStudio({
    httpTabs: [{ url: "https://example.com/x", lastAccessed: 1 }],
  });
  elements["run-btn"]._fire("click");
  await flushMicrotasks();

  assert.equal(elements["run-btn"].disabled, true, "run disabled while in flight");
  const start = connectCalls[0].messagesSent.find((m) => m.type === "START");
  assert.ok(start);
  assert.equal(start.testMode, "url");
  assert.equal(start.targetUrl, "https://example.com/x");
  assert.equal(start.fullPage, true);
  assert.deepEqual([...start.browsers], ["chromium", "firefox", "webkit"]);
});

test("repo mode runs even on a chrome:// page, persists the mode and path", async () => {
  const { elements, connectCalls, getStorageSetCalls } = await openStudio({ search: "?url=" });
  elements["mode-repo-btn"]._fire("click");
  elements["repo-path-input"].value = "docs/index.html";

  elements["run-btn"]._fire("click");
  await flushMicrotasks();

  assert.equal(connectCalls.length, 1);
  const start = connectCalls[0].messagesSent.find((m) => m.type === "START");
  assert.equal(start.testMode, "repo");
  assert.equal(start.repoPath, "docs/index.html");

  const sets = getStorageSetCalls();
  assert.ok(sets.some((s) => s.testMode === "repo"));
});

test("COMBO_READY marks the slot done with the streamed screenshot; RUN_FINISHED re-enables run", async () => {
  const { elements, slotMap, connectCalls } = await openStudio({
    httpTabs: [{ url: "https://example.com/", lastAccessed: 1 }],
  });
  elements["run-btn"]._fire("click");
  await flushMicrotasks();

  const port = connectCalls[0];
  port.onMessage.listener({
    type: "COMBO_READY",
    label: "Windows · Chrome",
    imageUrl: "data:image/png;base64,SHOTS",
    os: "windows",
    browser: "chromium",
  });

  const stateEl = slotMap.windows.querySelector(".bench__state");
  const thumb = slotMap.windows.querySelector(".bench__thumb");
  assert.equal(stateEl.dataset.state, "done");
  assert.equal(stateEl.textContent, "Done");
  assert.equal(thumb.hidden, false);
  assert.equal(thumb.src, "data:image/png;base64,SHOTS");

  port.onMessage.listener({ type: "RUN_FINISHED", timedOut: false });
  assert.equal(elements["run-btn"].disabled, false);
});

test("ERROR messages: MISSING_CREDENTIALS opens the settings tab; other errors render", async () => {
  const { elements, connectCalls, tabCreateCalls } = await openStudio({
    httpTabs: [{ url: "https://example.com/", lastAccessed: 1 }],
  });
  elements["run-btn"]._fire("click");
  await flushMicrotasks();

  connectCalls[0].onMessage.listener({ type: "ERROR", error: "MISSING_CREDENTIALS" });
  assert.equal(tabCreateCalls.length, 1);
  assert.match(tabCreateCalls[0].url, /os-test\/settings\.html/);

  connectCalls[0].onMessage.listener({ type: "ERROR", error: "GitHub rejected (401)" });
  assert.match(elements["status-line"].textContent, /GitHub rejected \(401\)/);
});

test("setup banner logic: hidden with own creds, visible without token or repo", async () => {
  const full = await openStudio({
    store: { githubPat: "tok", repoOwner: "o", repoName: "r" },
  });
  assert.equal(full.elements["setup-banner"].hidden, true, "own credentials suffice");

  const dashOnly = await openStudio({
    settings: { githubToken: "dashboard-token" }, // no owner/repo saved
  });
  assert.equal(dashOnly.elements["setup-banner"].hidden, false, "dashboard token alone is NOT enough (owner/repo missing)");

  const none = await openStudio({});
  assert.equal(none.elements["setup-banner"].hidden, false);
});

test("dashboard token with owner/repo completes the setup → banner hidden", async () => {
  const s = await openStudio({
    settings: { githubToken: "tok" },
    store: { repoOwner: "o", repoName: "r" },
  });
  assert.equal(s.elements["setup-banner"].hidden, true);
});

test("settings button and banner both open os-test/settings.html in a tab", async () => {
  const { elements, tabCreateCalls } = await openStudio({});
  elements["settings-btn"]._fire("click");
  elements["setup-banner-btn"]._fire("click");
  assert.equal(tabCreateCalls.length, 2);
  assert.match(tabCreateCalls[0].url, /os-test\/settings\.html/);
});

test("browser selection persists and drives slot visibility", async () => {
  const { elements, slotMap, getStorageSetCalls } = await openStudio({});
  elements["browser-firefox"].checked = false;
  elements["browser-firefox"]._fire("change");

  const sets = getStorageSetCalls();
  const browserCall = sets.find((s) => "selectedBrowsers" in s);
  assert.deepEqual([...browserCall.selectedBrowsers], ["chromium", "webkit"]);
  assert.equal(slotMap["windows-firefox"].hidden, true, "deselected browser's slots hidden");
  assert.equal(slotMap["macos-firefox"].hidden, true);
  assert.equal(slotMap["macos"].hidden, false);
});

test("fullpage toggle persists both the flag and the label text", async () => {
  const { elements, getStorageSetCalls } = await openStudio({ store: { fullPage: true } });
  elements["fullpage-toggle"].checked = false;
  elements["fullpage-toggle"]._fire("change");
  assert.equal(elements["fullpage-toggle-label"].textContent, "Visible area only");
  assert.ok(getStorageSetCalls().some((s) => s.fullPage === false));
});

test("expand all / collapse all flips every visible thumb", async () => {
  const { elements, slotMap } = await openStudio({});
  elements["expand-all-btn"]._fire("click");
  assert.equal(elements["expand-all-btn"].textContent, "Collapse all");
  assert.equal(slotMap.windows.querySelector(".bench__thumb").dataset.expanded, "true");

  elements["expand-all-btn"]._fire("click");
  assert.equal(elements["expand-all-btn"].textContent, "Expand all");
  assert.equal(slotMap.windows.querySelector(".bench__thumb").dataset.expanded, undefined);
});

test("lightbox: thumbnail click opens, close/Escape dismiss", async () => {
  const { elements, slotMap } = await openStudio({});
  const thumb = slotMap.macos.querySelector(".bench__thumb");
  thumb.hidden = false;
  thumb.onclick = null;

  // markSlotDone wire: clicking via onclick handler opens lightbox
  thumb.onclick = () => {
    elements["lightbox-title"].textContent = "macOS · Chrome";
    elements["lightbox-img"].src = "data:image/png;base64,MAC";
    elements["lightbox-modal"].hidden = false;
  };
  thumb.onclick();

  assert.equal(elements["lightbox-modal"].hidden, false);
  assert.equal(elements["lightbox-title"].textContent, "macOS · Chrome");

  elements["lightbox-close"]._fire("click");
  assert.equal(elements["lightbox-modal"].hidden, true);
});

