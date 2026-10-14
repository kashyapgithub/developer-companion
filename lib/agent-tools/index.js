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

/** Standard "no usable tab" failure, shared by the handlers. */
export const noTab = (urlContains) => ({
  status: "failed",
  result: { error: `No open tab on an allowed site${urlContains ? ` matching "${urlContains}"` : ""}. The user can add sites in the extension's settings (localhost is allowed by default).` },
});

export const agentCommands = {
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
