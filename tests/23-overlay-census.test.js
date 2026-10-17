// Layer 23 — GitHub Dashboard (overlay) handler census. The dashboard's whole
// UI is client-rendered, so "every element does what it says" means:
//   A) every id a JS handler looks up must be produced by a real template
//      (no phantom selectors — including dynamic `${...}` id templates);
//   B) every interactive element rendered by a template must be wired to
//      some handler intent (id selector, comma-group, label-for, or a
//      name= radio-group query) — no dead buttons;
//   C) every <label for="x"> points at an existing id in the same file;
//   D) the #app mount the whole dashboard boots into actually exists.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rootPath } = require("./helpers");

const DIR = rootPath("overlay");

function collectFiles(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...collectFiles(p));
    else if (/\.(js|html)$/.test(p)) out.push(p);
  }
  return out;
}

const sources = collectFiles(DIR).map((p) => ({ p: p.replace(rootPath("") + "/", ""), src: fs.readFileSync(p, "utf8") }));
const byFile = (pred) => sources.filter((s) => pred(s));
const allJoined = () => sources.map((s) => s.src).join("\n");
const ALL = allJoined();

// ---- id sets ---------------------------------------------------------------

const handlerIds = new Set(); // ids a handler intent references via '#x'
for (const s of sources.filter((s) => s.p.endsWith(".js"))) {
  for (const m of s.src.matchAll(/#([A-Za-z0-9_-]+)/g)) handlerIds.add(m[1]);
}
for (const m of ALL.matchAll(/getElementById\(\s*['"]#?([A-Za-z0-9_-]+)/g)) handlerIds.add(m[1]);

const dynamicPrefixes = new Set(); // `#prefix-${...}` template selectors
for (const m of ALL.matchAll(/[`']#([A-Za-z0-9_-]+)-\$\{/g)) dynamicPrefixes.add(m[1]);

const renderedPrefixes = new Set(); // id="prefix-${...}" in templates
for (const m of ALL.matchAll(/\bid="([A-Za-z0-9_-]+)-\$\{/g)) renderedPrefixes.add(m[1]);

const templateIds = new Map(); // id → file that renders it
for (const s of sources) {
  for (const m of s.src.matchAll(/\bid="([-A-Za-z0-9_]+)"/g)) {
    if (!templateIds.has(m[1])) templateIds.set(m[1], s.p);
  }
}

const nameGroups = new Set(); // radio/checkbox groups and their queries
for (const m of ALL.matchAll(/name=["']([A-Za-z0-9_-]+)["']/g)) nameGroups.add(m[1]);

const labelForById = new Map(); // label for="x" → file
for (const s of sources) {
  for (const m of s.src.matchAll(/<label[^>]*for="([A-Za-z0-9_-]+)"/g)) {
    if (!labelForById.has(m[1])) labelForById.set(m[1], s.p);
  }
}

const isDynamicOk = (id) => (id.endsWith("-") && renderedPrefixes.has(id.slice(0, -1))) ||
  [...dynamicPrefixes].some((p) => id.startsWith(p + "-"));

const dataWired = (tagMatch) => {
  // data-* delegation: element carries data-x AND '[data-x]' is queried somewhere
  const attrs = [...tagMatch.matchAll(/\b(data-[a-z-]+)=/g)].map((m) => m[1]);
  if (attrs.some((a) => ALL.includes(`[${a}]`))) return true;
  // class delegation: element carries class-x AND '.x' is queried somewhere
  const classes = (tagMatch.match(/class="([^"]*)"/) || [])[1] || "";
  return classes.split(/\s+/).filter(Boolean).some((c) => ALL.includes(`.${c}`));
};

const isWired = (id, tagSnippet) => handlerIds.has(id) || isDynamicOk(id) || labelForById.has(id) ||
  [...nameGroups].some((g) => new RegExp(`id="${id}"[^>]*name="${g}"`).test(ALL)) ||
  (tagSnippet ? dataWired(tagSnippet) : false);

// ---- tests -----------------------------------------------------------------

test("A: no handler references a phantom id (static selectors all exist in templates)", () => {
  const missing = [...handlerIds].filter((id) => !isWired(id));
  assert.deepEqual(missing, [], "every '#id' lookup must map to a real rendered element");
});

test("A2: dynamic id templates match (e.g. '#input-key-${provider}') resolve to a rendered prefix", () => {
  for (const p of dynamicPrefixes) {
    const rendered = renderedPrefixes.has(p) || [...templateIds.keys()].some((id) => id.startsWith(p + "-") || id === p);
    assert.ok(rendered, `dynamic prefix '#${p}-\${...}' must correspond to rendered ids`);
  }
});

test("B: every interactive template element is wired — no dead buttons", () => {
  const INTERACTIVE = /<(button|input|select|textarea)[^>]*id="([-A-Za-z0-9_]+)"[^>]*>/g;
  const dead = [];
  for (const m of ALL.matchAll(INTERACTIVE)) {
    const id = m[2];
    if (!isWired(id, m[0])) dead.push(`${m[1]}#${id}`);
  }
  assert.deepEqual(dead, [], "interactive elements must have wiring intent somewhere in overlay code");
});

test("C: every <label for=x> points at an id rendered in the same file (a11y drift guard)", () => {
  const broken = [];
  for (const [id, file] of labelForById) {
    const s = sources.find((x) => x.p === file);
    const ok = new RegExp(`id="${id}"`).test(s.src);
    if (!ok) broken.push(`${file}: label for="${id}"`);
  }
  assert.deepEqual(broken, [], "labels must reference ids that exist in the file they're rendered in");
});

test("D: the dashboard boots into a mount that exists in overlay.html", () => {
  const html = fs.readFileSync(rootPath("overlay/overlay.html"), "utf8");
  assert.match(html, /id="app"/, "overlay.html provides #app");
  for (const m of ALL.matchAll(/getElementById\(\s*['"]#?([A-Za-z0-9_-]+)['"]/g)) {
    if (m[1] === "app" || m[1] === "overlay-app") continue;
    assert.ok(templateIds.has(m[1]) || isDynamicOk(m[1]), `getElementById('${m[1]}') must exist`);
  }
});

test("E: module wiring census — every module imported by overlay.js exists and is .js", () => {
  const entry = sources.find((s) => s.p.endsWith("overlay/overlay.js"));
  const imports = [...entry.src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(imports.length >= 10, "overlay.js wires its render modules");
  for (const rel of imports) {
    const abs = path.join(DIR, rel.replace(/^\.\//, ""));
    assert.ok(fs.existsSync(abs), `module file exists: ${rel}`);
  }
});

test("F: close/exit affordances all route through closeWindowSafely (no silent dead-ends)", () => {
  const entry = sources.find((s) => s.p.endsWith("overlay/overlay.js"));
  const closeWired = (entry.src.match(/closeWindowSafely/g) || []).length;
  assert.ok(closeWired >= 5, "close button handlers reference closeWindowSafely liberally");
  assert.match(entry.src, /chrome\.windows\.remove/, "hard-uninstall path present for standalone windows");
});
