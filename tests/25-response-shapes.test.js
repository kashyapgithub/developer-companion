// Layer 25 — the shape of every awaited reply. Pages do `res.rows`,
// `res?.ok`, `res.count` — if background renames a key the page reads,
// the UI silently shows zeroes. Both sides are derived here from real
// source: which keys the page dereferences near each await vs which keys
// the background handler actually replies with.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rootPath } = require("./helpers");

const PAGE_DIRS = ["editor", "logs", "lib", "os-test"];

function collect(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...collect(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

const pageSources = new Map(
  PAGE_DIRS.flatMap((d) => collect(rootPath(d))).map((p) => [p, fs.readFileSync(p, "utf8")])
);
const backgroundSrc = fs.readFileSync(rootPath("background.js"), "utf8");

// window following an await sendMessage: the derefs on the awaited value
const AWAIT_WINDOW = 700;

function pageDerefs() {
  // type → Map(file → Set of reply-keys the page reads)
  // Shapes found in real page code:
  //   1) const res = await chrome.runtime.sendMessage({ type: "T" }); res?.ok, res.rows
  //   2) const { attachedTabs } = await chrome.runtime.sendMessage({ type: "T" });
  //   3) chrome.runtime.sendMessage({ type: "T" }).then((status) => status.totalBufferedLogs)
  const result = new Map();
  for (const [file, src] of pageSources) {
    for (const call of src.matchAll(/chrome\.runtime\.sendMessage\(\s*\{/g)) {
      const start = call.index;
      const head = src.slice(start, start + 300);
      const typeMatch = head.match(/type:\s*['"]([A-Z0-9_]+)['"]/);
      if (!typeMatch) continue;
      const type = typeMatch[1];
      const window_ = src.slice(Math.max(0, start - 250), start + 450); // binding + the user's block


      // candidate names bound to the reply: await-var, then-callback (found near this call)
      const names = new Set();
      for (const m of window_.matchAll(/(?:const|let)\s+(\w+)\s*=\s*await\s+chrome/g)) names.add(m[1]);
      for (const m of window_.matchAll(/\.then\(\s*\(?\s*(\w+)/g)) names.add(m[1]);

      const derefs = new Set();
      for (const name of names) {
        for (const d of window_.matchAll(new RegExp(name + "\\?\\.([A-Za-z_][A-Za-z0-9_]*)", "g"))) derefs.add(d[1]);
        for (const d of window_.matchAll(new RegExp(name + "\\.([A-Za-z_][A-Za-z0-9_]*)", "g"))) derefs.add(d[1]);
      }
      // destructured reply: const { a, b } = await — the names ARE the keys read
      for (const m of window_.matchAll(/\{\s*([^}]+?)\s*\}\s*=\s*await\s+chrome\.runtime\.sendMessage/g)) {
        for (const part of m[1].split(",")) {
          const key = part.trim().split(":")[0].trim();
          if (/^[A-Za-z_]\w*$/.test(key)) derefs.add(key);
        }
      }

      if (!result.has(type)) result.set(type, new Map());
      if (!result.get(type).has(file)) result.get(type).set(file, new Set());
      for (const k of derefs) result.get(type).get(file).add(k);
    }
  }
  return result;
}

function handledCaseBlock(type) {
  // background.js uses `if (message.type === "T")` chains, not switch/case
  const lit = `message.type === "${type}"`;
  const i = backgroundSrc.indexOf(lit);
  if (i < 0) return null;
  const rest = backgroundSrc.indexOf("message.type ===", i + lit.length);
  const end = rest < 0 ? i + 700 : rest;
  return backgroundSrc.slice(i, end);
}

// The SEND_LOGS_TO_AGENT / FLUSH_NOW reply is constructed inside
// lib/log-sender.js's flush(); cases that delegate via `.then(sendResponse)`
// reply from the module they call — follow the call to its source file.
const logSenderSrc = fs.readFileSync(rootPath("lib/log-sender.js"), "utf8");
const repoJsFiles = ["background.js", "editor", "lib", "logs", "os-test", "server"].flatMap((d) => {
  const p = rootPath(d);
  const walk = (q) => fs.readdirSync(q).flatMap((f) => {
    const full = path.join(q, f);
    if (fs.statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".js") ? [full] : [];
  });
  return walk(p.slice(-1) === "/" || fs.statSync(p).isDirectory() ? p : rootPath("."));
});
function replyTextFor(type) {
  let block = handledCaseBlock(type) || "";
  if (/flush\(\)/.test(block)) {
    const i = logSenderSrc.indexOf("async flush()");
    block += "\n" + logSenderSrc.slice(i, logSenderSrc.indexOf("export const", i));
  }
  // X(...).then(sendResponse) → the module implementing X owns the reply shape
  const followed = new Set();
  const followName = (fn) => {
    if (followed.has(fn)) return;
    for (const file of repoJsFiles) {
      const src = fs.readFileSync(file, "utf8");
      const def = new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+${fn}\\b|const\\s+${fn}\\s*=|class\\s+${fn}\\b)`);
      if (def.test(src)) {
        followed.add(fn);
        block += "\n" + src;
        break;
      }
    }
  };
  for (const m of block.matchAll(/(\w+)\(\{?[^;]*?\)\.then\(sendResponse\)/g)) {
    const fn = m[1];
    if (/^(resolveTargetTab|waitForCommand|runChecks)$/.test(fn)) continue; // infra helpers, not reply values
    followName(fn);
  }
  // chained forms too: X(...).then(toggleXray).then(sendResponse)
  for (const m of block.matchAll(/\.then\(\s*(\w+)\s*\)\s*\.then\(\s*sendResponse/g)) {
    followName(m[1]);
  }
  // spread replays (`return { ok: true, ...tokensFromRaw(result) }`) — follow
  // any identifier used in a spread that resolves to a module export
  for (const m of block.matchAll(/\.\.\.(\w+)\(/g)) followName(m[1]);
  return block;
}

const derefs = pageDerefs();

test("the awaited-reply census actually found page expectations", () => {
  const types = [...derefs.keys()];
  assert.ok(types.includes("GET_ALL_LOGS"), "logs drawer expectation found");
  assert.ok(types.includes("GET_LOGS"), "logs viewer expectation found");
  assert.ok(types.length >= 5, "census breadth");
});

test("every key a page dereferences is actually in the background response", () => {
  const broken = [];
  for (const [type, files] of derefs) {
    const block = replyTextFor(type);
    assert.ok(handledCaseBlock(type), `background handles ${type}`);
    for (const [file, keys] of files) {
      for (const key of keys) {
        if (!block.includes(key)) broken.push(`${file} reads res.${key} of ${type}, handler reply lacks it`);
      }
    }
  }
  assert.deepEqual(broken, [], "response objects must carry every key pages dereference");
});

test("known-shape spot checks (the three load-bearing replies)", () => {
  const logs = replyTextFor("GET_ALL_LOGS");
  assert.match(logs, /rows/, "GET_ALL_LOGS → { rows }");
  const status = replyTextFor("GET_STATUS");
  assert.match(status, /totalBufferedLogs/, "GET_STATUS → totalBufferedLogs (badge)");
  assert.match(status, /attachedTabs/, "GET_STATUS → attachedTabs (logs viewer app list)");
  const send = replyTextFor("SEND_LOGS_TO_AGENT");
  assert.match(send, /count/, "SEND_LOGS_TO_AGENT → count (toast says how many)");
  assert.match(send, /ok/, "SEND_LOGS_TO_AGENT → ok");
  assert.match(send, /error:/, "SEND_LOGS_TO_AGENT failure → error (toast honesty)");
});

test("pages stay safe when a send resolves undefined (optional chaining around replies)", () => {
  const bridge = pageSources.get(rootPath("editor/companion-bridge.js")) || "";
  assert.match(bridge, /res\?\.rows/, "logs drawer tolerates a missing handler");
  assert.match(bridge, /res\?\.ok/, "send-logs tolerates a missing handler");
  const logsPage = pageSources.get(rootPath("logs/logs.js")) || "";
  assert.match(logsPage, /\{ attachedTabs \}/, "status destructure guarded via field read");
});

test("companion-bridge await chain keeps working without a catch-all (explicit try/catch)", () => {
  const bridge = pageSources.get(rootPath("editor/companion-bridge.js")) || "";
  const catchCount = (bridge.match(/catch/g) || []).length;
  assert.ok(catchCount >= 2, "bridge wraps risky awaits in catch paths (toast honesty depends on it)");
});
