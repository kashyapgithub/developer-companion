/**
 * helpers.js — shared harness utilities for the Developer Companion test suite.
 *
 * The core idea (borrowed from the upstream cross-os tester's own tests):
 * load the REAL source files via node:vm inside a sandbox that mocks
 * chrome/fetch/DOM, then drive them through their real entry points.
 * Nothing in the extension is refactored for testability here.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** Read a file relative to the repo root. */
function readRootFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/** Absolute repo-root path for a relative project path. */
function rootPath(relPath) {
  return path.join(ROOT, relPath);
}

// ---------------------------------------------------------------------------
// ESM -> plain-script transform for vm execution
// ---------------------------------------------------------------------------

/**
 * Converts an ES module's source into a classic script that can run inside
 * vm.runInContext:
 *   - import lines are recorded and stripped (callers supply mock/real modules)
 *   - `export function f` / `export const x` prefixes are stripped
 *   - `export { ... };` blocks are stripped
 * Returns { source, imports: [{ names: string[], spec: string }] }.
 */
function toCommonScript(source, { wrap = false } = {}) {
  const imports = [];

  // Node CLI scripts start with a shebang, which is invalid inside vm.Script.
  source = source.replace(/^#![^\n]*/gm, "");

  // Build a char-is-CODE mask: an `import` only exists in real code, never
  // inside comments, strings, or template literals. (A demo import inside a
  // JSDoc example would otherwise be rewritten into `*/`-bearing text that
  // terminates the enclosing comment early.)
  const codeMask = new Uint8Array(source.length);
  {
    let inBlockComment = false, inLineComment = false, inTemplate = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i], next = source[i + 1], prev = source[i - 1];
      if (!inBlockComment && !inLineComment && !inTemplate) {
        if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
        if (ch === "/" && next === "/") { inLineComment = true; continue; }
        if (ch === '"' || ch === "'") {
          const quote = ch; // skip a normal string literal
          i++;
          while (i < source.length && source[i] !== quote) {
            if (source[i] === "\\") i++;
            i++;
          }
          continue;
        }
        if (ch === "`") { inTemplate = true; continue; }
        codeMask[i] = 1;
        continue;
      }
      if (inLineComment) {
        if (ch === "\n") { inLineComment = false; codeMask[i] = 1; }
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") { inBlockComment = false; i++; }
        continue;
      }
      // inside a template literal — a real import never appears inside ${...}
      if (ch === "`" && prev !== "\\") { inTemplate = false; codeMask[i] = 0; continue; }
    }
  }
  const isCode = (idx) => idx < codeMask.length && codeMask[idx] === 1;

  // Pass A: multi-line named imports (e.g. `import {\n a,\n b\n} from "x";`)
  // (?<![\w$.]) guards against identifiers like `importInput.addEventListener`.
  source = source.replace(/(?<![\w$.])import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/g, (full, names, spec, offset) => {
    if (!isCode(offset)) return full; // inside comment/string — demo text, not an import
    imports.push({
      names: names.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean),
      spec,
    });
    return `/* import stripped: ${spec} */`;
  });

  // Pass B: single-line named / default / side-effect imports
  let out = source.replace(/^[ \t]*import(?![\w$])\s*(.+?)\s*[;]?\s*$/gm, (line, body0, offset, str) => {
    /* Pass A already handled its shapes */
    if (line.includes("import stripped")) return line;
    if (!isCode(offset + (line.length - line.trimStart().length))) return line; // demo text in a comment
    const body = line.replace(/^[ \t]*import\s*/, "").replace(/;\s*$/, "");
    const namedMatch = body.match(/^\{([^}]*)\}\s*from\s*["']([^"']+)["']$/);
    const defaultMatch = body.match(/^(\w+(?:\s*,\s*\{[^}]*\})?)\s*from\s*["']([^"']+)["']$/);
    const sideEffectMatch = body.match(/^["']([^"']+)["']$/);

    if (namedMatch) {
      imports.push({ names: namedMatch[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean), spec: namedMatch[2] });
      return `/* import stripped: ${namedMatch[2]} */`;
    }
    if (defaultMatch) {
      imports.push({ names: defaultMatch[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean), spec: defaultMatch[2] });
      return `/* import stripped: ${defaultMatch[2]} */`;
    }
    if (sideEffectMatch) {
      imports.push({ names: [], spec: sideEffectMatch[1] });
      return `/* side-effect import stripped: ${sideEffectMatch[1]} */`;
    }
    // Something unusual (e.g. `import * as ns from "..."`) — keep it, and let
    // the vm throw if it's actually executed. Record it so coverage is honest.
    imports.push({ names: [], spec: body, unparsed: true });
    return `/* unparsed import: ${body} */`;
  });

  out = out
    .replace(/^export\s+(async\s+)?(function|const|let|var|class)\b/gm, "$1$2")
    // single-LINE re-export blocks only (`export { noTab } from …;`) — a
    // greedy multi-line version once swallowed a whole `export const X = {…}`
    // object that happened to contain an inner `};`-terminated line.
    .replace(/^export\s+\{[^{}]*\}\s*(?:from\s*[^;]*)?;\s*$/gm, "/* export block stripped */")
    .replace(/^export\s+default\s+/gm, "/* default export stripped: */ ");

  if (wrap) {
    // Syntax-check mode for genuine ES modules: top-level await and
    // import.meta are legal in modules but not in classic scripts, so
    // neutralize them and evaluate the whole body inside an async IIFE.
    out = out.replace(/import\.meta/g, "__syntaxCheckImportMeta");
    out = `(async () => {\n${out}\n})();`;
  }

  return { source: out, imports };
}

/** Wait until an async condition holds, polling the microtask queue. */
async function waitFor(predicate, { maxSteps = 2000, label = "condition" } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    if (await predicate()) return true;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`waitFor: ${label} never became true`);
}

/** Flush two microtask/setImmediate turns — enough for `await`-chains to settle. */
async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Fake DOM
// ---------------------------------------------------------------------------

/** A minimal fake element covering everything the extension pages touch. */
function makeElement(id, overrides = {}) {
  const listeners = {};
  const classes = new Set();
  const attributes = {};
  const el = {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    checked: false,
    type: "",
    placeholder: "",
    dataset: {},
    src: "",
    onclick: null,
    classList: {
      toggle(cls, force) {
        const on = force === undefined ? !classes.has(cls) : Boolean(force);
        if (on) classes.add(cls);
        else classes.delete(cls);
        return on;
      },
      add(...cls) { cls.forEach((c) => classes.add(c)); },
      remove(...cls) { cls.forEach((c) => classes.delete(c)); },
      contains(cls) { return classes.has(cls); },
    },
    setAttribute(name, val) { attributes[name] = String(val); },
    getAttribute(name) { return attributes[name]; },
    removeAttribute(name) {
      delete attributes[name];
      delete el.dataset[name.replace(/^data-/, "")];
    },
    querySelector(selector) {
      if (selector === ".bench__state") return el._stateEl || (el._stateEl = makeElement(`${id}-state`));
      if (selector === ".bench__thumb") return el._thumbEl || (el._thumbEl = makeElement(`${id}-thumb`));
      return null;
    },
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    _listeners: listeners,
    _fire(type, payload) {
      (listeners[type] || []).forEach((fn) => fn(payload));
      if (type === "click" && el.onclick) el.onclick(payload);
    },
    ...overrides,
  };
  return el;
}

/** A fake `document` rooted on a fixed element registry. */
function makeDocument({ elements, slotMap = {}, extraQuerySelectors = {} } = {}) {
  const docListeners = {};
  return {
    getElementById: (id) => elements[id] || null,
    querySelector: (selector) => {
      if (typeof selector !== "string") return null;
      const comboMatch = selector.match(/data-combo="([\w-]+)"/);
      if (comboMatch) return slotMap[comboMatch[1]] || null;
      const idMatch = selector.match(/id="([\w-]+)"/);
      if (idMatch) return elements[idMatch[1]] || null;
      return null;
    },
    querySelectorAll: (selector) => {
      if (typeof selector !== "string") return [];
      const clsMatch = selector.match(/^\.([\w-]+)/);
      if (clsMatch) return extraQuerySelectors[clsMatch[1]] || [];
      return [];
    },
    addEventListener: (type, fn) => {
      docListeners[type] = docListeners[type] || [];
      docListeners[type].push(fn);
    },
    _fire: (type, payload) => {
      (docListeners[type] || []).forEach((fn) => fn(payload));
    },
  };
}

/** A fake chrome.runtime.Port controlled by the test. */
function makePort() {
  const port = {
    messagesSent: [],
    disconnected: false,
    onMessage: {
      listener: null,
      addListener(fn) { this.listener = fn; },
    },
    onDisconnect: {
      listener: null,
      addListener(fn) { this.listener = fn; },
    },
    postMessage: (msg) => { port.messagesSent.push(msg); },
    disconnect: () => { port.disconnected = true; },
  };
  return port;
}

// ---------------------------------------------------------------------------
// Virtual clock (fast-forwards Date.now, e.g. past the 6-minute poll timeout)
// ---------------------------------------------------------------------------

function makeDateMock(clockStepMs = 1) {
  let virtualNow = 1_700_000_000_000;
  return {
    Date: class extends Date {
      static now() {
        virtualNow += clockStepMs;
        return virtualNow;
      }
    },
    now: () => virtualNow,
    advance: (ms) => { virtualNow += ms; },
  };
}

module.exports = {
  ROOT,
  readRootFile,
  rootPath,
  toCommonScript,
  waitFor,
  flushMicrotasks,
  makeElement,
  makeDocument,
  makePort,
  makeDateMock,
};
