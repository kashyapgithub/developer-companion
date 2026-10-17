// Layer 21 — Canvas toolbar user flows, driven in REAL companion-bridge.js:
// each button must do exactly what its tooltip promises — GitHub Dashboard
// opens its drawer, "Pop out" closes the drawer AND asks the worker for a
// window, Cross-OS opens the studio window, "Send logs to agent" reports the
// number it actually sent, badge reflects buffered logs, Escape closes drawers.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { rootPath, flushMicrotasks } = require("./helpers");

const SOURCE = fs.readFileSync(rootPath("editor/companion-bridge.js"), "utf8")
  .replace(/^export\s+/m, ""); // strip the single ESM export keyword

function loadBridge({ statusResponses, messageScript, fetchImpl } = {}) {
  const make = (id, overrides = {}) => {
    const listeners = {};
    const classes = new Set();
    const el = {
      id,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      className: "",
      checked: true,
      dataset: {},
      title: "",
      style: {},
      scrollTop: 0,
      scrollHeight: 100,
      classList: {
        toggle(cls, force) {
          const on = force === undefined ? !classes.has(cls) : Boolean(force);
          if (on) classes.add(cls);
          else classes.delete(cls);
          return on;
        },
        add(...c) { c.forEach((x) => classes.add(x)); },
        remove(...c) { c.forEach((x) => classes.delete(x)); },
        contains(c) { return classes.has(c); },
      },
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      _fire(type, payload) { (listeners[type] || []).forEach((fn) => fn(payload)); },
      setAttribute(n, v) { el.dataset[n.replace(/^data-/, "")] = v; },
      querySelector(selector) {
        if (selector === ".companion-modal-backdrop") {
          el._backdrop = el._backdrop || make(id + "-backdrop");
          return el._backdrop;
        }
        if (selector === ".code-snippet-box") {
          el._box = el._box || { querySelector: () => ({ textContent: "npm start" }) };
          return el._box;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === ".agent-tab") {
          return ["claude", "cursor", "antigravity"].map((t) => {
            const tab = make(`agent-tab-${t}`);
            tab.dataset.tab = t;
            return tab;
          });
        }
        if (selector === ".agent-tab-pane") {
          return ["claude", "cursor", "antigravity"].map((t) => {
            const pane = make(`pane-${t}`);
            pane.dataset.tab = t;
            return pane;
          });
        }
        if (selector === ".copy-snippet-btn") {
          const btn = make("copy-btn");
          btn.dataset.copy = "npm start";
          return [btn];
        }
        return [];
      },
      appendChild() {},
      closest() { return { querySelector: () => ({ textContent: "npm start" }) }; },
      ...overrides,
      _listeners: listeners,
    };
    return el;
  };

  const elements = {};
  for (const id of [
    "github-dashboard-btn", "cross-os-test-btn", "send-logs-btn", "view-logs-btn",
    "logs-badge", "github-modal", "github-close-btn", "github-popout-btn",
    "logs-modal", "logs-close-btn", "logs-popout-btn", "logs-clear-btn",
    "logs-flush-agent-btn", "logs-list-view", "logs-count-label", "logs-search",
    "agent-tutorial-btn", "tutorial-modal", "tutorial-close-btn",
    "tut-test-btn", "tut-status-dot", "tut-status-text",
    "companion-toast", "filter-errors", "filter-warns", "filter-info", "filter-network",
    "pane-claude", "pane-cursor", "pane-antigravity",
  ]) {
    elements[id] = make(id, {
      "filter-errors": { checked: true },
      "filter-warns": { checked: true },
      "filter-info": { checked: true },
      "filter-network": { checked: true },
      "tut-status-text": { textContent: "" },
    }[id] || {});
  }
  elements["github-modal"].classList.add("hidden");
  elements["logs-modal"].classList.add("hidden");
  elements["tutorial-modal"].classList.add("hidden");
  elements["logs-badge"].classList.add("hidden");
  elements["logs-badge"]._classes = elements["logs-badge"].classList;

  const filterPills = [elements["filter-errors"], elements["filter-warns"], elements["filter-info"], elements["filter-network"]];

  const sent = [];
  const currentRows = [
    { level: "error", message: "e1", app_name: "app-a", type: "error", created_at: new Date().toISOString(), context: {} },
    { level: "warn", message: "w1", app_name: "app-a", type: "warning", created_at: new Date().toISOString(), context: {} },
    { level: "info", message: "i1", app_name: "app-a", type: "network", tags: ["network"], created_at: new Date().toISOString(), context: {} },
  ];

  const chromeMock = {
    runtime: {
      sendMessage: async (msg) => {
        sent.push(msg);
        if (messageScript) return messageScript(msg, sent);
        switch (msg.type) {
          case "OPEN_GITHUB_DASHBOARD": return { ok: true };
          case "OPEN_CROSS_OS_TESTER": return { ok: true };
          case "OPEN_LOGS_VIEWER": return { ok: true };
          case "SEND_LOGS_TO_AGENT": return { ok: true, count: 3 };
          case "CLEAR_LOGS": currentRows.length = 0; return { ok: true };
          case "GET_STATUS": return statusResponses?.shift?.() || { totalBufferedLogs: 0, queueSize: 0, attachedTabs: [] };
          case "GET_ALL_LOGS": return { rows: currentRows };
          default: return { ok: true };
        }
      },
    },
  };

  const outerFetch = fetchImpl;
  const windowListeners = {};
  const docListeners = {};
  const documentMock = {
    readyState: "complete",
    getElementById: (id) => elements[id] || null,
    querySelectorAll: (selector) => {
      const cls = String(selector).match(/^\.([\w-]+)/);
      if (cls && cls[1] === "logs-filter-pills") return filterPills;
      return [];
    },
    addEventListener: () => {},
    body: { style: { overflow: "" } },
  };

  const sandbox = {
    document: documentMock,
    chrome: chromeMock,
    window: { addEventListener: (t, fn) => { (windowListeners[t] = windowListeners[t] || []).push(fn); } },
    navigator: { clipboard: { writeText: async (t) => { copies.push(t); } } },
    fetch: outerFetch || (async () => ({ ok: true })),
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: () => {},
    setInterval: () => {},
    clearTimeout: () => {},
    console,
  };
  const copies = [];

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "editor/companion-bridge.js" });
  return {
    elements,
    sent,
    copies,
    windowListeners,
    getBody: () => documentMock.body,
    getRows: () => currentRows,
  };
}

const fire = async (el) => { el._fire("click"); await flushMicrotasks(); return flushMicrotasks(); };

// ---------------------------------------------------------------------------

test("GitHub button opens the drawer exactly as its tooltip says", async () => {
  const { elements, getBody } = loadBridge();
  await fire(elements["github-dashboard-btn"]);
  assert.ok(!elements["github-modal"].classList.contains("hidden"), "drawer visible");
  assert.equal(getBody().style.overflow, "hidden", "page scroll locked while the drawer is open");
});

test("Pop out button: closes the drawer and asks the worker for a window", async () => {
  const { elements, sent } = loadBridge();
  await fire(elements["github-dashboard-btn"]);
  await fire(elements["github-popout-btn"]);

  assert.ok(elements["github-modal"].classList.contains("hidden"), "drawer closed");
  assert.ok(sent.some((m) => m.type === "OPEN_GITHUB_DASHBOARD"), "requested the dashboard window");
});

test("Cross-OS button: asks the worker for the studio and toasts success", async () => {
  const { elements, sent } = loadBridge();
  elements["companion-toast"].className = "";
  await fire(elements["cross-os-test-btn"]);

  assert.ok(sent.some((m) => m.type === "OPEN_CROSS_OS_TESTER"));
  assert.match(elements["companion-toast"].textContent, /opened in a new window/);
  assert.match(elements["companion-toast"].className, /success/);
});

test("Cross-OS button failure path: honest error toast when the runtime says no", async () => {
  const { elements } = loadBridge({
    messageScript: () => undefined, // no handler responded
  });
  await fire(elements["cross-os-test-btn"]);
  assert.match(elements["companion-toast"].textContent, /Could not open the Cross-OS Test Studio/);
  assert.match(elements["companion-toast"].className, /error/);
});

test("Send-logs button: loading class, real count toast, badge refresh", async () => {
  const { elements, sent } = loadBridge();
  const btn = elements["send-logs-btn"];
  await fire(btn);

  assert.ok(sent.some((m) => m.type === "SEND_LOGS_TO_AGENT"));
  assert.ok(!btn.classList.contains("loading"), "loading state cleared after send");
  assert.match(elements["companion-toast"].textContent, /Sent 3 logs to Agent Server/);
});

test("send failure toast surfaces the error from the worker", async () => {
  const { elements } = loadBridge({
    messageScript: (msg) => (msg.type === "SEND_LOGS_TO_AGENT" ? { ok: false, error: "server offline" } : { ok: true }),
  });
  await fire(elements["send-logs-btn"]);
  assert.match(elements["companion-toast"].textContent, /Failed: server offline/);
});

test("badge shows the buffered count, caps at 99+, hides at zero", async () => {
  const five = loadBridge({ statusResponses: [{ totalBufferedLogs: 5 }, { totalBufferedLogs: 120 }, { totalBufferedLogs: 0 }] });
  await flushMicrotasks(); await flushMicrotasks(); // init's status refresh
  assert.equal(five.elements["logs-badge"].textContent, "5");
  assert.ok(!five.elements["logs-badge"].classList.contains("hidden"));

  // send logs triggers an update: 120+ cap
  await fire(five.elements["send-logs-btn"]);
  assert.equal(five.elements["logs-badge"].textContent, "99+");

  await fire(five.elements["send-logs-btn"]);
  assert.ok(five.elements["logs-badge"].classList.contains("hidden"), "zero-buffered → badge hidden");
});

test("View-logs button opens the drawer and renders the captured rows", async () => {
  const { elements } = loadBridge();
  await fire(elements["view-logs-btn"]);

  assert.ok(!elements["logs-modal"].classList.contains("hidden"));
  assert.match(elements["logs-count-label"].textContent, /3 of 3 logs/, "rows from the worker are counted honestly");
  for (const msg of ["e1", "w1", "i1"]) {
    assert.match(elements["logs-list-view"].innerHTML, new RegExp(msg));
  }
  assert.match(elements["logs-list-view"].innerHTML, /ERROR/);
});

test("logs search filters rows live and shows the honest empty state", async () => {  const { elements } = loadBridge();
  await fire(elements["view-logs-btn"]);

  elements["logs-search"].value = "w1";
  elements["logs-search"]._fire("input");
  assert.match(elements["logs-count-label"].textContent, /1 of 3 logs/);
  assert.match(elements["logs-list-view"].innerHTML, /w1/);
  assert.doesNotMatch(elements["logs-list-view"].innerHTML, />e1</);

  elements["logs-search"].value = "zzz-nothing";
  elements["logs-search"]._fire("input");
  assert.match(elements["logs-list-view"].innerHTML, /No captured logs match your filter\./);
});

test("filter pills hide their promised categories", async () => {
  const { elements } = loadBridge();
  await fire(elements["view-logs-btn"]);

  elements["filter-errors"].checked = false;
  elements["filter-errors"]._fire("change");
  assert.match(elements["logs-count-label"].textContent, /2 of 3 logs/);
  assert.doesNotMatch(elements["logs-list-view"].innerHTML, />e1</);

  // Network pill controls the tagged row, not the level
  elements["filter-network"].checked = false;
  elements["filter-network"]._fire("change");
  assert.doesNotMatch(elements["logs-list-view"].innerHTML, /i1/);
});

test("Clear button wipes the buffer over the wire and repaints", async () => {
  const { elements, sent } = loadBridge();
  await fire(elements["view-logs-btn"]);
  await fire(elements["logs-clear-btn"]);

  assert.ok(sent.some((m) => m.type === "CLEAR_LOGS"));
  assert.match(elements["companion-toast"].textContent, /Cleared captured logs/);
  assert.match(elements["logs-list-view"].innerHTML, /No captured logs match your filter\./);
});

test("Flush-inside-drawer button reuses the same send-logs flow", async () => {
  const { elements, sent } = loadBridge();
  await fire(elements["view-logs-btn"]);
  await fire(elements["logs-flush-agent-btn"]);
  assert.ok(sent.filter((m) => m.type === "SEND_LOGS_TO_AGENT").length >= 1);
  assert.match(elements["companion-toast"].textContent, /Sent 3 logs to Agent Server/);
});

test("Escape closes every open drawer at once", async () => {
  const { elements, windowListeners } = loadBridge();
  await fire(elements["github-dashboard-btn"]);
  await fire(elements["view-logs-btn"]);
  await fire(elements["agent-tutorial-btn"]);
  assert.ok(!elements["tutorial-modal"].classList.contains("hidden"));

  for (const fn of windowListeners.keydown || []) fn({ key: "Escape" });
  for (const id of ["github-modal", "logs-modal", "tutorial-modal"]) {
    assert.ok(elements[id].classList.contains("hidden"), `${id} closed on Escape`);
  }
});

test("tutorial Test-connection reports backend up vs down accurately", async () => {
  // Up: fetch to the local bridge answers ok.
  const up = loadBridge();
  await fire(up.elements["agent-tutorial-btn"]);
  assert.ok(!up.elements["tutorial-modal"].classList.contains("hidden"), "tutorial opens");
  assert.match(up.elements["tut-status-text"].textContent, /Connected on port 5959/);

  // Down: fetch to the local bridge refuses.
  const down = loadBridge({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  await fire(down.elements["agent-tutorial-btn"]);
  assert.match(down.elements["tut-status-text"].textContent, /not detected on port 5959/);

  down.elements["companion-toast"].className = "";
  await fire(down.elements["tut-test-btn"]);
  assert.match(down.elements["tut-status-text"].textContent, /not detected on port 5959/);
  // the Test button's toast is the honest signal
  assert.ok(down.elements["companion-toast"].textContent.includes("not responding on port 5959"));
});
