/**
 * checks.js — agent command `run_checks`: runs acceptance checks (Given/When/Then) in the user's real tab.
 * Parsing lives in checks-spec.js, ordering in checks-run.js, page access in checks-driver.js.
 */

import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger } from "../debugger-capture.js";
import { noTab } from "./index-helpers.js";
import { normalizeChecks, parseScenarios } from "./checks-spec.js";
import { runChecks } from "./checks-run.js";
import { createChecksDriver } from "./checks-driver.js";

/** payload: { scenarios?: string, checks?: object[], url_contains?: string, timeout_ms?: number } */
export async function runChecksCommand(payload = {}) {
  let checks;
  try { checks = payload.scenarios ? parseScenarios(payload.scenarios) : normalizeChecks(payload.checks); }
  catch (err) { return { status: "failed", result: { error: err.message } }; }

  const tab = await pickAllowedTab(payload.url_contains);
  if (!tab) return noTab(payload.url_contains);
  await attachDebugger(tab.id);

  const driver = createChecksDriver(tab.id);
  try {
    const report = await runChecks(checks, driver, { timeoutMs: Math.min(Math.max(Number(payload.timeout_ms) || 3000, 500), 15000) });
    return { status: "done", result: { page: { url: tab.url }, ...report } };
  } finally { await driver.end(); }
}
