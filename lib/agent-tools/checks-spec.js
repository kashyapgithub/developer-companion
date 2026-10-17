/**
 * checks-spec.js — what an acceptance check IS, and how plain Given/When/Then text becomes one.
 * Pure (no browser, no Chrome APIs), so it is unit-tested in Node.
 *
 * A check is { name, steps: [step…] } and each step is one of
 *
 *   do:     { do:"goto", url } · { do:"click", selector | text } · { do:"type", selector, text }
 *           { do:"press", key } · { do:"wait", ms | selector | text }
 *   expect: { expect:"text", text } · { expect:"no_text", text } · { expect:"selector", selector }
 *           { expect:"no_selector", selector } · { expect:"url", contains } · { expect:"no_console_errors" }
 *           { expect:"request", url_contains, method?, status? }     (status: 201 or "2xx")
 *
 * Steps run in order and the check stops at the first one that fails.
 */

export const MAX_CHECKS = 30;
export const MAX_STEPS = 60;

const ACTIONS = new Set(["goto", "click", "type", "press", "wait"]);
const EXPECTS = new Set(["text", "no_text", "selector", "no_selector", "url", "no_console_errors", "request"]);
const str = (v, n = 500) => String(v ?? "").slice(0, n);

/** Cleans one step, or throws a message that says what is wrong. */
export function normalizeStep(raw, where = "step") {
  if (!raw || typeof raw !== "object") throw new Error(`${where}: not an object.`);
  if (raw.do) {
    if (!ACTIONS.has(raw.do)) throw new Error(`${where}: unknown action "${raw.do}". Use goto, click, type, press or wait.`);
    const s = { do: raw.do };
    if (raw.do === "goto") { if (!raw.url) throw new Error(`${where}: goto needs a url.`); s.url = str(raw.url, 2000); }
    if (raw.do === "click") { if (!raw.selector && !raw.text) throw new Error(`${where}: click needs a selector or the visible text.`); if (raw.selector) s.selector = str(raw.selector); if (raw.text) s.text = str(raw.text); }
    if (raw.do === "type") { if (!raw.selector) throw new Error(`${where}: type needs a selector.`); s.selector = str(raw.selector); s.text = str(raw.text, 5000); }
    if (raw.do === "press") { if (!raw.key) throw new Error(`${where}: press needs a key, e.g. "Enter".`); s.key = str(raw.key, 30); }
    if (raw.do === "wait") {
      if (raw.ms != null) s.ms = Math.min(Math.max(Number(raw.ms) || 0, 0), 15000);
      else if (raw.selector) s.selector = str(raw.selector); else if (raw.text) s.text = str(raw.text);
      else throw new Error(`${where}: wait needs ms, a selector or text.`);
    }
    return s;
  }
  if (raw.expect) {
    if (!EXPECTS.has(raw.expect)) throw new Error(`${where}: unknown expectation "${raw.expect}".`);
    const s = { expect: raw.expect };
    if (raw.expect === "text" || raw.expect === "no_text") { if (!raw.text) throw new Error(`${where}: ${raw.expect} needs text.`); s.text = str(raw.text); }
    if (raw.expect === "selector" || raw.expect === "no_selector") { if (!raw.selector) throw new Error(`${where}: ${raw.expect} needs a selector.`); s.selector = str(raw.selector); }
    if (raw.expect === "url") { if (!raw.contains) throw new Error(`${where}: url needs "contains".`); s.contains = str(raw.contains, 2000); }
    if (raw.expect === "request") {
      if (!raw.url_contains) throw new Error(`${where}: request needs url_contains.`);
      s.url_contains = str(raw.url_contains, 500);
      if (raw.method) s.method = str(raw.method, 10).toUpperCase();
      if (raw.status != null) s.status = String(raw.status).slice(0, 3);
    }
    return s;
  }
  throw new Error(`${where}: needs "do" or "expect".`);
}

/** Cleans a list of checks. Throws for the first problem, naming the check and step. */
export function normalizeChecks(list) {
  if (!Array.isArray(list) || !list.length) throw new Error("No checks given.");
  return list.slice(0, MAX_CHECKS).map((c, i) => {
    const name = str(c?.name, 120) || `Check ${i + 1}`;
    if (!Array.isArray(c?.steps) || !c.steps.length) throw new Error(`"${name}": no steps.`);
    return { name, steps: c.steps.slice(0, MAX_STEPS).map((s, j) => normalizeStep(s, `"${name}" step ${j + 1}`)) };
  });
}

/** One sentence for a step, in the same words parseSentence() reads (so text round-trips). */
export function describeStep(s) {
  if (s.do === "goto") return `I open ${s.url}`;
  if (s.do === "click") return `I click ${s.text ? `"${s.text}"` : s.selector}`;
  if (s.do === "type") return `I type "${s.text}" into ${s.selector}`;
  if (s.do === "press") return `I press ${s.key}`;
  if (s.do === "wait") return s.ms != null ? `I wait ${s.ms} ms` : `I wait for ${s.text ? `"${s.text}"` : s.selector}`;
  if (s.expect === "text") return `I see "${s.text}"`;
  if (s.expect === "no_text") return `I do not see "${s.text}"`;
  if (s.expect === "selector") return `${s.selector} is visible`;
  if (s.expect === "no_selector") return `${s.selector} is not visible`;
  if (s.expect === "url") return `the url contains ${s.contains}`;
  if (s.expect === "no_console_errors") return "there are no console errors";
  if (s.expect === "request") return `${s.method || "GET"} ${s.url_contains} returned ${s.status || "200"}`;
  return JSON.stringify(s);
}

// ---- Given / When / Then text -> checks -----------------------------------------------------

const KEYWORD = /^(given|when|then|and|but)\s+/i;
const SELECTORISH = /^([#.[]|[a-z][\w-]*(\[|[#.:>]))/i;
const quoted = "(?:\"([^\"]*)\"|'([^']*)')";
const q = (m, a = 1) => m[a] ?? m[a + 1];

/** The sentence patterns, tried in order. Each returns a step or null. */
const PATTERNS = [
  [new RegExp(`^(?:i )?(?:open|visit|go to|navigate to)\\s+${quoted}$`, "i"), (m) => ({ do: "goto", url: q(m) })],
  [/^(?:i )?(?:open|visit|go to|navigate to)\s+(\S+)$/i, (m) => ({ do: "goto", url: m[1] })],
  [new RegExp(`^(?:i )?(?:type|enter)\\s+${quoted}\\s+(?:into|in)\\s+(.+)$`, "i"), (m) => ({ do: "type", text: q(m), selector: m[3].trim() })],
  [new RegExp(`^(?:i )?fill\\s+(.+?)\\s+with\\s+${quoted}$`, "i"), (m) => ({ do: "type", selector: m[1].trim(), text: q(m, 2) })],
  [/^(?:i )?press\s+(\w[\w+]*)$/i, (m) => ({ do: "press", key: m[1] })],
  [new RegExp(`^(?:i )?click(?: on)?\\s+${quoted}$`, "i"), (m) => ({ do: "click", text: q(m) })],
  [/^(?:i )?click(?: on)?\s+(.+)$/i, (m) => ({ do: "click", selector: m[1].trim() })],
  [new RegExp(`^(?:i )?wait for\\s+${quoted}$`, "i"), (m) => ({ do: "wait", text: q(m) })],
  [/^(?:i )?wait(?: for)?\s+(\d+(?:\.\d+)?)\s*(ms|s|seconds?)$/i, (m) => ({ do: "wait", ms: /^ms/i.test(m[2]) ? Number(m[1]) : Number(m[1]) * 1000 })],
  [/^(?:i )?wait for\s+(.+)$/i, (m) => ({ do: "wait", selector: m[1].trim() })],
  [new RegExp(`^(?:i )?(?:do not|don't|should not) see\\s+${quoted}$`, "i"), (m) => ({ expect: "no_text", text: q(m) })],
  [new RegExp(`^(?:i )?(?:should )?see\\s+${quoted}$`, "i"), (m) => ({ expect: "text", text: q(m) })],
  [/^(?:the )?url (?:should )?contains?\s+(\S+)$/i, (m) => ({ expect: "url", contains: m[1] })],
  [/^(?:there are|there should be|i see) no console errors$/i, () => ({ expect: "no_console_errors" })],
  [/^(?:the )?(\S+(?: \S+)*?) (?:is|should be) (?:not visible|hidden|gone)$/i, (m) => ({ expect: "no_selector", selector: m[1] })],
  [/^(?:the )?(\S+(?: \S+)*?) (?:is|should be) (?:visible|shown|present)$/i, (m) => ({ expect: "selector", selector: m[1] })],
  [/^(?:a |the )?(get|post|put|patch|delete)\s+(\S+)\s+(?:request\s+)?(?:returned|returns|responds(?: with)?|gets?)\s+(\d{3}|[1-5]xx)$/i, (m) => ({ expect: "request", method: m[1].toUpperCase(), url_contains: m[2], status: m[3].toLowerCase() })],
];

/** One sentence (keyword already removed) -> step. Throws a helpful message when it can't be read. */
export function parseSentence(sentence) {
  const s = sentence.trim().replace(/[.]$/, "");
  for (const [re, make] of PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const step = make(m);
    // "click Save" (no quotes, not selector-like) means the visible text, not a tag selector.
    if (step.do === "click" && step.selector && !SELECTORISH.test(step.selector)) { step.text = step.selector; delete step.selector; }
    return step;
  }
  throw new Error(`Couldn't read: "${sentence.trim()}". Try: I open /path · I click "Text" · I type "x" into #field · I press Enter · I see "Text" · the url contains /x · there are no console errors · POST /api/x returned 201`);
}

/**
 * Plain text with "Scenario: name" blocks of Given/When/Then lines -> checks.
 * Lines starting with # or // and blank lines are ignored; "Feature:" lines too.
 */
export function parseScenarios(text) {
  const checks = [];
  let current = null;
  for (const [i, raw] of String(text || "").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || /^(#|\/\/)/.test(line) || /^feature:/i.test(line)) continue;
    const head = /^scenario(?: outline)?:\s*(.*)$/i.exec(line);
    if (head) { current = { name: head[1] || `Scenario ${checks.length + 1}`, steps: [] }; checks.push(current); continue; }
    if (!current) { current = { name: "Scenario 1", steps: [] }; checks.push(current); }
    try { current.steps.push(parseSentence(line.replace(KEYWORD, ""))); }
    catch (err) { throw new Error(`Line ${i + 1}: ${err.message}`); }
  }
  return normalizeChecks(checks.filter((c) => c.steps.length));
}

/** Checks -> Given/When/Then text (for showing the agent what was run, and for recordings). */
export function toScenarioText(checks) {
  return checks.map((c) => `Scenario: ${c.name}\n${c.steps.map((s, i) => `  ${i === 0 ? "Given" : s.expect ? "Then" : "When"} ${describeStep(s)}`).join("\n")}`).join("\n\n");
}
