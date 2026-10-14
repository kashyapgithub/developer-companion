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
import { designTokensCommand } from "./design-tokens.js";
import { auditCommand } from "./audit.js";
import { pageStateCommand } from "./page-state.js";
import { captureResponsiveCommand, networkThrottleCommand } from "./emulation.js";

export { noTab } from "./index-helpers.js";

export const agentCommands = {
  /** Colours, fonts, radii, shadows and spacing in use on the page, as CSS variables and Tailwind. */
  design_tokens: designTokensCommand,
  /** Screenshots at several screen widths + sideways-scroll check. */
  capture_responsive: captureResponsiveCommand,
  /** Quick accessibility checks + load performance (FCP, LCP, CLS, weight). */
  audit_page: auditCommand,
  /** localStorage / sessionStorage / cookie names / framework globals, secrets masked. */
  page_state: pageStateCommand,
  /** Slow 3G / offline / normal network for the tab. */
  network_throttle: networkThrottleCommand,

  /** Recorded requests with headers and bodies (secrets masked). */
  async get_network(payload = {}) {
    const tab = await pickAllowedTab(payload.url_contains_tab);
    const requests = queryRequests({
      tabId: tab?.id, urlContains: payload.url_contains, status: payload.status, method: payload.method,
      limit: payload.limit, includeBodies: payload.include_bodies !== false, maxBodyChars: payload.max_body_chars,
    });
    return { status: "done", result: { page: tab ? { url: tab.url, title: tab.title } : null, count: requests.length, requests } };
  },
};
