/**
 * checks-run.js — runs acceptance checks against a "driver" (the thing that touches the page).
 *
 * The runner only knows the order of things: do each step, wait for expectations to come true,
 * stop at the first failure and collect evidence. It never touches Chrome, so it is tested in Node
 * with a fake driver; checks-driver.js is the real one.
 *
 * driver = {
 *   begin()                      a check is starting (forget console errors, remember where requests start)
 *   goto(url) click({selector,text}) type({selector,text}) press(key)     actions; throw on failure
 *   probe(expectStep) -> { ok, detail }      is this expectation true right now?
 *   evidence() -> { url, textSnippet, consoleErrors, failedRequests, screenshot }
 * }
 */

import { describeStep } from "./checks-spec.js";

const POLL_MS = 100;
const DEFAULT_TIMEOUT_MS = 3000;
const SETTLE_MS = 300;                                   // before "nothing bad happened" expectations
const NEGATIVE = new Set(["no_text", "no_selector", "no_console_errors"]);

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `probe` until it is ok or the time is up. Returns the last answer. */
async function waitFor(probe, { timeoutMs, sleep, now }) {
  const end = now() + timeoutMs;
  for (;;) {
    const answer = await probe();
    if (answer.ok || now() >= end) return answer;
    await sleep(POLL_MS);
  }
}

/** Runs one step. Returns { ok, detail }. */
async function runStep(step, driver, opts) {
  try {
    if (step.do === "goto") await driver.goto(step.url);
    else if (step.do === "click") await driver.click(step);
    else if (step.do === "type") await driver.type(step);
    else if (step.do === "press") await driver.press(step.key);
    else if (step.do === "wait") {
      if (step.ms != null) { await opts.sleep(step.ms); return { ok: true }; }
      const target = step.text ? { expect: "text", text: step.text } : { expect: "selector", selector: step.selector };
      const a = await waitFor(() => driver.probe(target), opts);
      return a.ok ? { ok: true } : { ok: false, detail: `Never showed up: ${step.text ? `"${step.text}"` : step.selector}` };
    } else if (step.expect) {
      if (NEGATIVE.has(step.expect)) { await opts.sleep(SETTLE_MS); return await driver.probe(step); }
      return await waitFor(() => driver.probe(step), opts);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err) };
  }
}

/**
 * @param {{name:string, steps:object[]}[]} checks   already normalized
 * @param {object} driver
 * @param {{timeoutMs?:number, sleep?:Function, now?:Function, maxScreenshots?:number}} [options]
 * @returns {Promise<{summary:string, passed:number, failed:number, results:object[]}>}
 */
export async function runChecks(checks, driver, options = {}) {
  const opts = { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, sleep: options.sleep || realSleep, now: options.now || Date.now };
  const maxShots = options.maxScreenshots ?? 3;
  const results = [];
  let shots = 0;

  for (const check of checks) {
    await driver.begin();
    const steps = [];
    let failedAt = -1;
    for (const [i, step] of check.steps.entries()) {
      if (failedAt >= 0) { steps.push({ step: describeStep(step), status: "skipped" }); continue; }
      const r = await runStep(step, driver, opts);
      steps.push({ step: describeStep(step), status: r.ok ? "passed" : "failed", ...(r.ok ? {} : { why: r.detail || "Expectation not met." }) });
      if (!r.ok) failedAt = i;
    }
    const result = { name: check.name, passed: failedAt < 0, steps };
    if (failedAt >= 0) {
      const ev = await driver.evidence({ screenshot: shots < maxShots }).catch((err) => ({ error: String(err?.message || err) }));
      if (ev.screenshot) shots++;
      result.failedStep = steps[failedAt].step;
      result.evidence = ev;
    }
    results.push(result);
  }
  const passed = results.filter((r) => r.passed).length;
  return { summary: `${passed}/${results.length} checks passed`, passed, failed: results.length - passed, results };
}
