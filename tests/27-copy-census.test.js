// Layer 27 — copy census: every user-facing toast/status string must be
// actionable. An error tone with a dead-end message ("Error") fails here.
// Census is derived from the real call sites:
//   editor/companion-bridge.js → showToast(msg, tone)
//   os-test/settings.js        → setStatus(msg, tone)
//   os-test/studio.js          → setStatus(msg, tone)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { rootPath } = require("./helpers");

function census(file, fn, name) {
  const src = fs.readFileSync(rootPath(file), "utf8");
  const out = [];

  const push = (text, tone, index) => {
    if (text === undefined) return;
    out.push({ file, index, text, tone: tone === undefined ? (fn === "showToast" ? "info" : "") : tone, line: src.slice(0, index).split("\n").length });
  };

  for (const m of src.matchAll(new RegExp(name + `\\(\\s*([\`'"][^\`;]*[\`'"])(?:\\s*,\\s*["']([\\w-]*)["'])?`, "g"))) {
    push(m[1].slice(1, -1), m[2], m.index);
  }

  // second pass: first arg is an expression (ternary etc.) — scan inside the
  // balanced parens for every quoted literal and apply the call's tone.
  for (const m of src.matchAll(new RegExp(name + "\\(", "g"))) {
    let i = m.index + name.length + 1;
    if (/^\s*[\`'"]/.test(src.slice(i))) continue; // simple literal form already covered
    let depth = 1, j = i;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      j++;
    }
    const slice = src.slice(i, j);
    const toneMatch = slice.match(/,\s*(?:ok\s*\?\s*)?["']([\\w-]+)["']\s*(?:\)\s*)?$/) || (fn === "showToast" ? [null, "info"] : [null, ""]);
    for (const lit of slice.matchAll(/[\`'"]((?:[^\`'"]|\\.)*)[\`'"]/g)) {
      if (lit[1].trim()) push(lit[1], toneMatch[2] !== undefined ? toneMatch[1] : toneMatch[1], m.index);
    }
  }
  return out;
}

const ALL = [
  ...census("editor/companion-bridge.js", "showToast", "showToast"),
  ...census("os-test/settings.js", "setStatus", "setStatus"),
  ...census("os-test/studio.js", "setStatus", "setStatus"),
];

const ACTIONS = /server|runtime|window|token|github|port|5959|repo|browser|network|open|opening|check|paste|cop(y|ied)|select|fill|create|running|unreachable|offline|failed|couldn't|could not|not responding|refused|install|storage|reload|actions tab|site first|file path|owner and|logs?\b/i;

test("the census actually harvested a rich body of user-facing copy", () => {
  assert.ok(ALL.length >= 15, `census breadth: found ${ALL.length} literal messages`);
});

test("no empty or whitespace-only statuses are ever pushed to users", () => {
  const empty = ALL.filter((e) => !e.text || !e.text.trim());
  assert.deepEqual(empty.map((e) => `${e.file}:${e.line}`), [], "silence hides state");
});

test("every error-tone message names the system or the next step (actionability)", () => {
  const deadEnds = [];
  for (const e of ALL) {
    if (e.tone !== "error") continue;
    if (!ACTIONS.test(e.text)) deadEnds.push(`${e.file}:${e.line} "${e.text}"`);
  }
  assert.deepEqual(deadEnds, [], "error toasts must say what failed and/or what to do");
});

test("error toasts are long enough to read", () => {
  const terse = ALL.filter((e) => e.tone === "error" && e.text.trim().length < 14);
  assert.deepEqual(terse.map((e) => `${e.file}:${e.line} "${e.text}"`), [], "give the user a sentence");
});

test("tone vocabulary is closed (typos can't silently disable styling)", () => {
  const allowed = new Set(["", "info", "success", "error", "loading", "normal"]);
  for (const e of ALL) {
    if (e.tone === undefined) continue;
    assert.ok(
      allowed.has(e.tone),
      `${e.file}:${e.line} tone '${e.tone}' unknown to the CSS dataset styling`
    );
  }
});

test("copy hygiene: no TODO/lorem/placeholder text shipped to users", () => {
  const junk = ALL.filter((e) => /todo|lorem|placeholder|fixme|xxx/i.test(e.text));
  assert.deepEqual(junk.map((e) => `${e.file}:${e.line}`), [], "junk copy found");
});

test("the flagship promises keep their exact wording (regression anchor)", () => {
  const texts = ALL.map((e) => e.text);
  assert.ok(texts.some((t) => t.includes("Cross-OS Test Studio opened in a new window")), "opening confirmation");
  assert.ok(texts.some((t) => t.includes("Agent server unreachable (is it running on port 5959?)")), "server-down hint includes port");
  assert.ok(texts.some((t) => /Select at least one browser/i.test(t)), "studio enforces browser choice with guidance");
});
