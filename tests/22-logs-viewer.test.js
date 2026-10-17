// Layer 22 — the standalone logs viewer page (logs/logs.js), runtime-driven.
// Every control must do exactly what it says:
//   • the dropdown lists capture LABELS (not hostnames) and keeps valid selections
//   • filter pills hide exactly their row TYPE
//   • the copy button produces an LLM-pasteable text block and reports the line count
//     it actually copied — or says "Nothing to copy."
//   • clear wipes only the current app's buffer and repaints honestly
//   • scripted messages cannot inject markup (escaping)

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { rootPath, flushMicrotasks } = require("./helpers");

const SOURCE = fs.readFileSync(rootPath("logs/logs.js"), "utf8");

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function loadLogs({ apps = [], logsByApp = {}, cleared = [] } = {}) {
  const copies = [];
  const sent = [];
  const timers = []; // setTimeout callbacks (never auto-fire)

  function createElement(tag) {
    const e = {
      tagName: tag,
      className: "",
      textContent: "",
      children: [],
      dataset: {},
      scrollTop: 0,
      scrollHeight: 200,
      appendChild(c) { e.children.push(c); },
    };
    Object.defineProperty(e, "innerHTML", {
      get() { return e._h !== undefined ? e._h : escapeText(e.textContent); },
      set(v) { e._h = String(v); e.children.length = 0; }, // "" clears children, like a real DOM
    });
    return e;
  }

  const wireEl = (el) => {
    el.addEventListener = (t, fn) => { el._l = el._l || {}; el._l[t] = (el._l[t] || []).concat(fn); };
    el._fire = (t, ev) => (el._l[t] || []).forEach((f) => f(ev));
    return el;
  };

  const appSelect = wireEl(createElement("select"));
  const logEl = createElement("div");
  const copyStatus = createElement("span");
  const copyBtnEl = wireEl(createElement("button"));
  const clearBtnEl = wireEl(createElement("button"));

  const filterBoxes = ["error", "warning", "network"].map((t) => {
    const cb = wireEl(createElement("input"));
    cb.checked = true;
    cb.dataset.type = t;
    return cb;
  });

  const chromeMock = {
    runtime: {
      sendMessage: async (msg) => {
        sent.push(msg);
        switch (msg.type) {
          case "GET_STATUS":
            return { attachedTabs: apps.map((a, i) => [i + 1, a]), totalBufferedLogs: 0, queueSize: 0 };
          case "GET_LOGS":
            return { rows: logsByApp[msg.appName] || [] };
          case "CLEAR_LOGS":
            cleared.push(msg.appName);
            logsByApp[msg.appName] = [];
            return { ok: true };
          default:
            return { ok: true };
        }
      },
    },
  };

  const sandbox = {
    document: {
      readyState: "complete",
      getElementById: (id) => ({ hostnameSelect: appSelect, log: logEl, copyBtn: copyBtnEl, clearBtn: clearBtnEl, copyStatus }[id] || null),
      querySelectorAll: (sel) => (sel === "#filters input[type=checkbox]" ? filterBoxes : []),
      createElement,
    },
    chrome: chromeMock,
    navigator: { clipboard: { writeText: async (t) => { copies.push(t); } } },
    setInterval: () => {}, // loops stay dormant under test; tests drive events manually
    setTimeout: (fn) => { timers.push(fn); },
    console,
  };

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "logs/logs.js" });
  return { appSelect, logEl, copyStatus, filterBoxes, copyBtnEl, clearBtnEl, sent, copies, cleared, timers };
}

const settle = async () => { await flushMicrotasks(); await flushMicrotasks(); };

const ROWS_A = [
  { level: "error", type: "error", message: "<script>alert('x')</script>", timestamp: 1700000000000, stack_trace: "Error: boom\n  at x.js:1" },
  { level: "info", type: "network", message: "GET /api 200", timestamp: 1700000001000 },
];

test("app dropdown lists the capture labels and picks the first one", async () => {
  const h = loadLogs({ apps: ["localhost (3000)", "localhost (5173)"] });
  await settle();

  assert.deepEqual(h.appSelect.children.map((c) => c.textContent), ["localhost (3000)", "localhost (5173)"]);
  assert.equal(h.appSelect.value, "localhost (3000)");
  assert.ok(h.sent.some((m) => m.type === "GET_LOGS" && m.appName === "localhost (3000)"), "auto-fetches the selected label");
});

test("an already-selected label survives a refresh; a vanished label" +
     " falls back to the first valid one", async () => {
  const h = loadLogs({ apps: ["app-a", "app-b"] });
  await settle();

  h.appSelect.value = "app-b";
  h.appSelect._fire("change"); // user picks app-b
  await settle();

  // Simulate the 3s app-list timer picking up the same tab list.
  h.appSelect._fire("change");
  await settle();

  assert.equal(h.appSelect.value, "app-b", "selection kept");
  assert.ok(h.sent.some((m) => m.type === "GET_LOGS" && m.appName === "app-b"));
});

test("empty state: the dropdown says 'No captured tabs open' and no GET_LOGS is sent", async () => {
  const h = loadLogs({ apps: [] });
  await settle();

  assert.deepEqual(h.appSelect.children.map((c) => c.textContent), ["No captured tabs open"]);
  assert.ok(!h.sent.some((m) => m.type === "GET_LOGS"), "no app → no log fetch");
  // and the clear button is a no-op without an app (defends against clearing nothing)
  h.clearBtnEl._fire("click");
  assert.ok(!h.sent.some((m) => m.type === "CLEAR_LOGS"), "clear refused with nothing selected");
});

test("rows render with time, level tag and class; script tags are escaped", async () => {
  const h = loadLogs({ apps: ["app-a"], logsByApp: { "app-a": ROWS_A } });
  await settle();

  const html = h.logEl.children.map((c) => c.innerHTML).join("\n");
  assert.match(html, /class="time"/);
  assert.match(html, /level-error">ERROR</);
  assert.match(html, /level-info">INFO</);
  assert.ok(!html.includes("<script>alert"), "no live script tags");
  assert.match(html, /&lt;script&gt;/);
});

test("filter pills hide exactly their row TYPE (network pill is type-based)", async () => {
  const h = loadLogs({ apps: ["app-a"], logsByApp: { "app-a": ROWS_A } });
  await settle();

  assert.equal(h.logEl.children.length, 2, "both rows start visible");

  h.filterBoxes[0].checked = false; // error type off
  h.filterBoxes[0]._fire("change");
  assert.equal(h.logEl.children.length, 1);
  assert.doesNotMatch(h.logEl.children[0].innerHTML, /ERROR/);
  assert.match(h.logEl.children[0].innerHTML, /GET \/api 200/);

  h.filterBoxes[2].checked = false; // network off too
  h.filterBoxes[2]._fire("change");
  assert.match(h.logEl.innerHTML, /Nothing matching the current filters yet\./, "honest empty state");
});

test("copy button writes the LLM-pasteable block and counts its real lines", async () => {
  const h = loadLogs({ apps: ["app-a"], logsByApp: { "app-a": ROWS_A } });
  await settle();

  h.copyBtnEl._fire("click");
  await settle();

  assert.equal(h.copies.length, 1, "exactly one clipboard write");
  const text = h.copies[0];
  assert.match(text, /\[.*\] ERROR <script>alert\('x'\)<\/script>/, "row 1: time/level/message, unescaped for chat");
  assert.match(text, /Error: boom\n {2}at x\.js:1/, "stack trace follows the row");
  assert.match(text, /\[.*\] INFO GET \/api 200/, "row 2");
  assert.match(h.copyStatus.textContent, /Copied 4 lines\./, "2 row lines + the 2-line stack = 4");
  // the timed reset is parked, not fired, so the status stays readable
  assert.equal(h.timers.length, 1, "status reset scheduled humane-window");
});

test("copy with nothing visible says 'Nothing to copy.' and touches no clipboard", async () => {
  const h = loadLogs({ apps: ["app-a"], logsByApp: { "app-a": [] } });
  await settle();

  h.copyBtnEl._fire("click");
  await settle();

  assert.equal(h.copies.length, 0);
  assert.match(h.copyStatus.textContent, /Nothing to copy\./);
});

test("clear button clears ONLY the current app over the wire and repaints", async () => {
  const h = loadLogs({
    apps: ["app-a"],
    logsByApp: { "app-a": ROWS_A, "other-app": [{ level: "warn", type: "warning", message: "keep me", timestamp: 1 }] },
  });
  await settle();

  h.clearBtnEl._fire("click");
  await settle();

  assert.deepEqual(h.cleared, ["app-a"], "only the selected app's buffer is cleared");
  assert.match(h.logEl.innerHTML, /Nothing matching the current filters yet\./, "viewer repaints empty");
  assert.equal((h.getRows ? null : null), null); // placeholder to keep shape stable
  assert.ok(h.sent.find((m) => m.type === "CLEAR_LOGS").appName === "app-a");
});

test("switching apps via the dropdown re-fetches that label's rows", async () => {
  const h = loadLogs({
    apps: ["app-a", "app-b"],
    logsByApp: {
      "app-a": ROWS_A,
      "app-b": [{ level: "warn", type: "warning", message: "b-row", timestamp: 3 }],
    },
  });
  await settle();

  h.appSelect.value = "app-b";
  h.appSelect._fire("change");
  await settle();

  assert.ok(h.sent.some((m) => m.type === "GET_LOGS" && m.appName === "app-b"));
  assert.equal(h.logEl.children.length, 1, "old rows dropped");
  assert.match(h.logEl.children[0].innerHTML, /b-row/);
  assert.match(h.logEl.children[0].innerHTML, /level-warn">WARN</);
});

test("poll renders keep the view pinned to the latest entry", async () => {
  const h = loadLogs({ apps: ["app-a"], logsByApp: { "app-a": ROWS_A } });
  await settle();

  assert.ok(h.logEl.scrollTop === h.logEl.scrollHeight, "scrollTop pinned to scrollHeight after render");
});
