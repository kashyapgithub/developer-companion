// Layer 12 — the REAL unified background.js service worker:
// message-bus wiring, pop-out window management for the Cross-OS studio,
// and the dashboard/logs/canvas windows. Imports are shimmed to faithful
// module mocks; the cross-os bridge import is a spy (its logic is covered
// by layers 8-11).

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { rootPath, toCommonScript, flushMicrotasks } = require("./helpers");

const RAW = fs.readFileSync(rootPath("background.js"), "utf8");
const { source: stripped, imports } = toCommonScript(RAW);
assert.ok(!imports.some((i) => i.unparsed), `unparsed imports: ${JSON.stringify(imports)}`);

/** Faithful-ish mocks of the modules background.js imports. */
function makeModuleMocks(state) {
  return {
    "./lib/allowlist.js": {
      getAppNameForUrl: async () => state.appNameForTabs ?? "localhost",
      setAllowlist: async (list) => { state.allowlist = list; return list; },
      getAllowlist: async () => state.allowlist || [],
    },
    "./lib/debugger-capture.js": {
      attachDebugger: async () => { state.attachCalls += 1; },
      detachDebugger: async () => { state.detachCalls += 1; },
      isAttached: () => false,
      forgetTab: () => {},
      createEventHandler: () => (event, tabId) => {},
    },
    "./lib/log-sender.js": {
      logSender: {
        queue: state.logQueue || (state.logQueue = []),
        enqueue(row) { state.logQueue.push(row); },
        flush: async () => {
          state.flushCalls += 1;
          const count = state.flushCount !== undefined ? state.flushCount : state.logQueue.length;
          state.logQueue.length = 0;
          return { ok: true, count };
        },
      },
    },
    "./lib/commands.js": {
      createCommandPoller: () => async () => {},
    },
    "./lib/forward-config.js": {
      DEFAULT_FORWARD_CONFIG: { enabled: false, endpoint: "" },
      getForwardConfig: async () => state.forwardConfig || { enabled: false },
      setForwardConfig: async (cfg) => { state.forwardConfig = cfg; return cfg; },
    },
    "./lib/os-test.js": {
      initOsTestBridge: () => { state.initOsTestBridgeCalls += 1; },
    },
  };
}

function loadBackground({ tabs = [], onStorageChanged = [] } = {}) {
  const state = {
    initOsTestBridgeCalls: 0,
    flushCalls: 0,
    attachCalls: 0,
    detachCalls: 0,
    session: {},
    local: {},
    windowsCreated: [],
    tabsCreated: [],
    windowsFocused: [],
    tabsActive: [],
    windowsRemovedHandler: null,
    throwOnWindowsUpdate: false,
  };

  const messageHandlers = [];
  const clickHandlers = [];
  let alarmHandler = null;

  const chromeMock = {
    action: { onClicked: { addListener: (fn) => clickHandlers.push(fn) } },
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) if (k in state.local) res[k] = state.local[k];
          return res;
        },
        set: async (obj) => { Object.assign(state.local, obj); },
        remove: async (key) => { delete state.local[key]; },
      },
      session: {
        get: async (keys) => {
          const res = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) if (k in state.session) res[k] = state.session[k];
          return res;
        },
        set: async (obj) => { Object.assign(state.session, obj); },
        remove: async (key) => { delete state.session[key]; },
      },
      onChanged: { addListener: (fn) => onStorageChanged.push(fn) },
    },
    runtime: {
      getURL: (p) => `chrome-extension://mock/${p}`,
      onMessage: { addListener: (fn) => messageHandlers.push(fn) },
      onConnect: { addListener: () => {} },
    },
    tabs: {
      query: async (query) => {
        if (query && query.url) {
          const pats = Array.isArray(query.url) ? query.url : [query.url];
          // honoring just the http(s) patterns used by this codebase
          const wantsHttp = pats.some((p) => p.startsWith("http"));
          return wantsHttp ? tabs.filter((t) => /^https?:\/\//.test(t.url)) : tabs;
        }
        return tabs;
      },
      create: async (opts) => { state.tabsCreated.push(opts); return { id: 123 }; },
      update: async (id, opts) => { state.tabsActive.push({ id, ...opts }); },
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
    },
    windows: {
      create: async (opts) => {
        const win = { id: state.windowsCreated.length + 1, ...opts };
        state.windowsCreated.push(win);
        return win;
      },
      update: async (id, opts) => {
        if (state.throwOnWindowsUpdate) throw new Error("Window was closed");
        state.windowsFocused.push({ id, ...opts });
      },
      getCurrent: async () => ({ width: 1400, height: 900, left: 0, top: 0 }),
      onRemoved: { addListener: (fn) => { state.windowsRemovedHandler = fn; } },
    },
    debugger: {
      onEvent: { addListener: () => {} },
      onDetach: { addListener: () => {} },
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: (fn) => { alarmHandler = fn; } },
    },
    commands: {
      onCommand: { addListener: () => {} },
    },
  };

  // Unknown module specs (e.g. the newer lib modules shipped by remote) get a
  // deep stub: callable, chainable, JSON/string-safe, explicitly not-thenable.
  const deepStub = () => {
    const fn = function stub() { return undefined; };
    return new Proxy(fn, {
      get(t, k) {
        if (k === Symbol.toPrimitive) return () => "";
        if (k === "then") return undefined;
        if (k === "prototype" || typeof k === "symbol") return t[k];
        if (t[k] === undefined) t[k] = deepStub();
        return t[k];
      },
      apply() { return deepStub(); },
    });
  };

  const mocks = makeModuleMocks(state);
  const bindings = imports
    .map(({ names, spec }) =>
      names.length
        ? `const {${names.join(",")}} = __mod(${JSON.stringify(spec)});`
        : `__mod(${JSON.stringify(spec)});`
    )
    .join("\n");
  const fullSource = `${bindings}\n${stripped}`;

  const sandbox = { chrome: chromeMock, __mod: (spec) => {
    const base = mocks[spec] || {};
    // mock keys win; anything newer the module exports falls back to a stub
    return new Proxy(base, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === Symbol.toPrimitive) return () => "";
        if (k === "then") return undefined;
        if (typeof k === "symbol") return undefined;
        if (t["__" + k] === undefined) t["__" + k] = deepStub();
        return t["__" + k];
      },
    });
  }, console, fetch: async () => { throw new Error("offline"); }, queueMicrotask, Promise };
  vm.createContext(sandbox);
  vm.runInContext(fullSource, sandbox, { filename: "background.js" });

  const sendMessage = async (message) =>
    new Promise((resolve) => {
      let done = false;
      const sendResponse = (value) => { done = true; resolve(value); };
      // handlers return true for async responses
      const keepOpen = messageHandlers[0](message, { tab: { id: 7, windowId: 3 } }, sendResponse);
      if (!keepOpen) {
        if (!done) resolve(undefined);
        return;
      }
      setTimeout(() => { if (!done) resolve(undefined); }, 100);
    });

  return { state, sendMessage, windowsRemovedHandler: () => state.windowsRemovedHandler, alarmHandler: () => alarmHandler, clickHandlers };
}

const HTTP_TABS = [
  { id: 1, url: "https://site-last.com/p", lastAccessed: 500 },
  { id: 2, url: "https://site-first.com/p", lastAccessed: 100 },
  { id: 3, url: "chrome-extension://mock/editor/editor.html", lastAccessed: 9999 },
];

test("initOsTestBridge is called exactly once when the worker boots", async () => {
  const { state } = loadBackground();
  assert.equal(state.initOsTestBridgeCalls, 1);
});

test("OPEN_CROSS_OS_TESTER opens a pop-out window with the most recent http(s) tab prefilled", async () => {
  const { state, sendMessage } = loadBackground({ tabs: HTTP_TABS });
  const res = await sendMessage({ type: "OPEN_CROSS_OS_TESTER" });

  assert.equal(res?.ok, true);
  assert.equal(state.windowsCreated.length, 1);
  const win = state.windowsCreated[0];
  assert.equal(win.type, "popup");
  assert.match(win.url, /chrome-extension:\/\/mock\/os-test\/studio\.html\?url=/);
  assert.match(win.url, /https%3A%2F%2Fsite-last\.com%2Fp/, "the LAST-used http tab (not the extension tab) must be prefilled");
  assert.ok(state.session.crossOsWindowId, "window id should be remembered for focus-reuse");
});

test("second OPEN_CROSS_OS_TESTER focuses the existing window instead of spawning a new one", async () => {
  const bg = loadBackground({ tabs: HTTP_TABS });
  await bg.sendMessage({ type: "OPEN_CROSS_OS_TESTER" });
  await bg.sendMessage({ type: "OPEN_CROSS_OS_TESTER" });

  assert.equal(bg.state.windowsCreated.length, 1, "no duplicate window");
  assert.deepEqual(bg.state.windowsFocused, [{ id: 1, focused: true }]);
});

test("a stale remembered window id (user closed it) falls back to creating a new window", async () => {
  const bg = loadBackground({ tabs: HTTP_TABS });
  bg.state.session.crossOsWindowId = 999;
  bg.state.throwOnWindowsUpdate = true; // Chrome throws for dead window ids

  await bg.sendMessage({ type: "OPEN_CROSS_OS_TESTER" });
  assert.equal(bg.state.windowsCreated.length, 1, "stale id → fresh window");
  assert.ok(bg.state.session.crossOsWindowId === 1, "new window id gets remembered");
});

test("closing the studio window clears the remembered id", async () => {
  const bg = loadBackground({ tabs: HTTP_TABS });
  await bg.sendMessage({ type: "OPEN_CROSS_OS_TESTER" });
  assert.ok(bg.state.session.crossOsWindowId);

  bg.windowsRemovedHandler()(1); // id 1 = the created studio window
  await flushMicrotasks();
  assert.equal(bg.state.session.crossOsWindowId, undefined);

  // Closing other windows must not clear it.
  await bg.sendMessage({ type: "OPEN_CROSS_OS_TESTER" });
  bg.windowsRemovedHandler()(777);
  await flushMicrotasks();
  assert.ok(bg.state.session.crossOsWindowId, "unrelated window close must keep the id");
});

test("SEND_LOGS_TO_AGENT queues the passed rows and reports the flushed count", async () => {
  const bg = loadBackground();
  const res = await bg.sendMessage({ type: "SEND_LOGS_TO_AGENT", rows: [{ message: "boom" }, { message: "two" }] });

  assert.equal(res?.ok, true);
  assert.equal(res?.count, 2);
  assert.equal(bg.state.flushCalls, 1);
  assert.equal(bg.state.logQueue.length, 0, "queue drained after flush");
});

test("core message bus routes: canvas/dashboard/logs", async () => {
  const bg = loadBackground();
  await bg.sendMessage({ type: "OPEN_CANVAS" });
  await bg.sendMessage({ type: "OPEN_GITHUB_DASHBOARD" });
  await bg.sendMessage({ type: "OPEN_LOGS_VIEWER" });

  assert.equal(bg.state.tabsCreated.length, 2);
  assert.match(bg.state.tabsCreated[0].url, /editor\/editor\.html/);
  assert.match(bg.state.tabsCreated[1].url, /logs\/logs\.html/);
  assert.equal(bg.state.windowsCreated.length, 1);
  assert.match(bg.state.windowsCreated[0].url, /overlay\/overlay\.html/);
});

test("GET_STATUS returns counters without throwing", async () => {
  const bg = loadBackground();
  const status = await bg.sendMessage({ type: "GET_STATUS" });
  assert.deepEqual(Object.keys(status).sort(), ["attachedTabs", "queueSize", "totalBufferedLogs"]);
});
