/**
 * agent-tools/index.js — the extension-side handlers for the agent's browser
 * tools (network inspector, design tokens, audits, mocks…).
 *
 * commands.js asks this table first for any command it doesn't handle itself.
 * Each handler gets the command payload and returns { status, result }.
 * One file per tool keeps them small and easy to test.
 */

import { queryRequests } from "./network-store.js";
import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger, isAttached } from "../debugger-capture.js";
import { designTokensCommand } from "./design-tokens.js";
import { setMockCommand, listMocksCommand, clearMocksCommand } from "./mocks.js";
import { auditCommand } from "./audit.js";
import { pageStateCommand } from "./page-state.js";
import { runChecksCommand } from "./checks.js";
import { vitalsCommand } from "./vitals.js";
import { suggestAssertionsCommand } from "./suggest-assertions.js";
import { captureResponsiveCommand, networkThrottleCommand } from "./emulation.js";

export { noTab } from "./index-helpers.js";

export const agentCommands = {
  /** Colours, fonts, radii, shadows and spacing in use on the page, as CSS variables and Tailwind. */
  design_tokens: designTokensCommand,
  /** Screenshots at several screen widths + sideways-scroll check. */
  capture_responsive: captureResponsiveCommand,
  /** Fake API responses for chosen requests (success, error, slow, or failing). */
  set_mock: setMockCommand,
  list_mocks: listMocksCommand,
  clear_mocks: clearMocksCommand,
  /** Quick accessibility checks + load performance (FCP, LCP, CLS, weight). */
  audit_page: auditCommand,
  /** localStorage / sessionStorage / cookie names / framework globals, secrets masked. */
  page_state: pageStateCommand,
  /** Acceptance checks (Given/When/Then) run in the real tab, with evidence on failure. */
  run_checks: runChecksCommand,
  /** What the page shows now (messages, headings, title): material for "I see …" steps. */
  suggest_assertions: suggestAssertionsCommand,
  /** Core Web Vitals (LCP, INP, CLS) with attribution for the open tab. */
  get_vitals: vitalsCommand,
  /** Slow 3G / offline / normal network for the tab. */
  network_throttle: networkThrottleCommand,

  /** Recorded requests with headers and bodies (secrets masked). */
  async get_network(payload = {}) {
    const tab = await pickAllowedTab(payload.url_contains_tab);
    // A tab that was already open when the extension woke isn't watched yet. Start now, and say so.
    const justStarted = !!tab && !isAttached(tab.id);
    if (justStarted) await attachDebugger(tab.id);
    const requests = queryRequests({
      tabId: tab?.id, urlContains: payload.url_contains, status: payload.status, method: payload.method,
      limit: payload.limit, includeBodies: payload.include_bodies !== false, maxBodyChars: payload.max_body_chars,
    });
    return { status: "done", result: { page: tab ? { url: tab.url, title: tab.title } : null, count: requests.length, requests,
      ...(justStarted ? { note: "Started watching this tab just now, so earlier requests were not recorded. Repeat the action in the app, then ask again." } : {}) } };
  },
};
