/**
 * watch-console.js — the agent's live view of the browser console (MCP tool watch_console).
 *
 * MCP is pull-based, so "live" works as a long poll: the agent calls watch_console,
 * the call waits until new console output arrives (or the wait runs out) and returns it
 * with a cursor. Calling again with that cursor continues exactly where it stopped,
 * so nothing is missed or repeated. Think `tail -f`, one chunk at a time.
 *
 * Pure helpers (formatLine, pickLevels, waitForRows) are exported for tests.
 */

import { z } from "zod";
import { latestLogId, queryLogsAfter } from "./storage.js";

const POLL_MS = 200;
const MAX_WAIT_SECONDS = 55;           // stays under typical MCP tool time limits
const DEFAULT_WAIT_SECONDS = 20;
const MAX_LINES = 200;
const STACK_LINES = 4;                 // errors get a short stack, not a wall of text

/** Level names at or above `min` ("warn" -> warn, error, fatal). Undefined = everything. */
export function pickLevels(min) {
  const order = ["debug", "info", "warn", "error", "fatal"];
  const i = order.indexOf(String(min || "").toLowerCase());
  return i < 0 ? undefined : order.slice(i);
}

/** Friendly kind names -> the row tags that identify them. */
export const KIND_TAGS = {
  console: ["console", "uncaught-exception", "browser-log"],
  network: ["finished", "failed", "request", "response"],   // not the bare "network" tag: the browser's own "Failed to load resource" log lines carry it too
  navigation: ["navigation"],
  action: ["user-action"],
};

/** One row -> a compact, readable line: "12:03:41.220 error [localhost] message". */
export function formatLine(row) {
  const time = String(row.created_at || "").slice(11, 23);
  let text = `${time} ${row.level} [${row.app_name}] ${row.message}`;
  if (row.stack_trace && /error|fatal/.test(row.level)) text += "\n" + String(row.stack_trace).split("\n").slice(0, STACK_LINES).join("\n");
  const c = row.context || {};
  if (c.requestBody) text += `\n  request body: ${c.requestBody}`;
  if (c.responseBody) text += `\n  response body: ${c.responseBody}`;
  return text;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls until rows newer than `after` exist or `waitMs` passes. Returns the rows (possibly none). */
export async function waitForRows(after, filters, waitMs, { poll = POLL_MS, query = queryLogsAfter } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const rows = query(after, filters);
    if (rows.length || Date.now() >= deadline) return rows;
    await sleep(Math.min(poll, Math.max(0, deadline - Date.now())));
  }
}

/** Adds the watch_console tool to an MCP server. */
export function registerWatchConsole(server) {
  server.tool(
    "watch_console",
    "Follows what happens in the user's browser live: console output, uncaught errors, every network request " +
      "(status, timing, masked bodies), page navigation and user clicks, as it arrives, waiting up to wait_seconds for something to happen. First call (no cursor) starts " +
      "from NOW; pass the returned cursor back to continue without gaps or repeats. Call it in a loop while the " +
      "user tests their app. For everything to arrive, the user turns on 'Stream' in the Developer " +
      "Companion top bar (otherwise only errors are sent, in slower batches).",
    {
      cursor: z.number().int().min(0).optional().describe("From the previous call. Omit to start from now."),
      wait_seconds: z.number().min(0).max(MAX_WAIT_SECONDS).optional().describe(`How long to wait for new output (default ${DEFAULT_WAIT_SECONDS})`),
      app: z.string().optional().describe("Only this site, e.g. 'localhost'"),
      kinds: z.array(z.enum(["console", "network", "navigation", "action"])).optional().describe("Only these kinds (default: everything): console output, network requests, page navigation, user clicks/submits"),
      min_level: z.enum(["debug", "info", "warn", "error"]).optional().describe("Only this level and above"),
      limit: z.number().int().min(1).max(MAX_LINES).optional().describe(`Max lines per call (default ${MAX_LINES / 2})`),
    },
    async ({ cursor, wait_seconds = DEFAULT_WAIT_SECONDS, app, kinds, min_level, limit = MAX_LINES / 2 }) => {
      const started = cursor === undefined;
      const after = started ? latestLogId() : cursor;
      const rows = await waitForRows(after, { app, levels: pickLevels(min_level), tags: kinds?.flatMap((k) => KIND_TAGS[k]), environment: "browser", limit }, wait_seconds * 1000);
      const next = rows.length ? rows[rows.length - 1].id : after;
      const result = {
        cursor: next,
        count: rows.length,
        more: rows.length === limit,   // more waiting right now: call again straight away
        ...(started ? { note: "Watching from now. Call again with this cursor to keep following." } : {}),
        ...(!rows.length ? { hint: "No new console output. If the user is acting in the app, ask them to turn on Stream in the top bar." } : {}),
        lines: rows.map(formatLine),
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
