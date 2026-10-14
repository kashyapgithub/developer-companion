/**
 * browser-tools.js — the agent's "look inside the running app" MCP tools.
 *
 * Each tool asks the browser extension to do something on an allowed tab
 * (through the command queue) and shapes the answer for the agent. They are
 * registered from server.js; everything they need comes in through `ctx`:
 *
 *   ctx.askBrowser(command, payload, waitMs)  -> the finished command, or null on timeout
 *
 * Keep each tool short: validate input, ask, format. The real work happens in
 * the extension (lib/agent-tools/) or in a helper module next to this file.
 */

import { z } from "zod";
import { pickRequest, buildTrace } from "./trace.js";

const NO_ANSWER = "The browser didn't answer. Is Chrome open with the Developer Companion extension, and is the app open on an allowed site (localhost by default)?";

/** A plain text MCP reply. */
const text = (t) => ({ content: [{ type: "text", text: t }] });

/** Text reply from a finished command: its result as JSON, or the readable error. */
export function resultText(done) {
  if (!done) return text(NO_ANSWER);
  if (done.status !== "done") return text(`Failed: ${done.result?.error || "unknown error"}`);
  return text(JSON.stringify(done.result, null, 2));
}

/** Splits a "data:image/png;base64,…" URL into an MCP image block (or null). */
export function imageBlock(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  return m ? { type: "image", data: m[2], mimeType: m[1] } : null;
}

export function registerBrowserTools(server, ctx) {
  const { askBrowser } = ctx;

  // ---- 1. network inspector ------------------------------------------------------
  server.tool(
    "get_network_requests",
    "Returns the HTTP requests the user's running app made (allowed sites only, e.g. localhost): method, URL, " +
      "status, timing, request and response headers and JSON/text bodies, newest first. Secrets (tokens, cookies, " +
      "passwords) are masked. Use it when an API call fails or a button 'does nothing': find the call, read what " +
      "was sent and what came back, then fix the right side. Filter by status 'failed', '4xx', '5xx' or a code.",
    {
      url_contains: z.string().optional().describe("Only requests whose URL contains this, e.g. '/api/orders'"),
      status: z.string().optional().describe("'failed' (errors and 4xx/5xx), '4xx', '5xx', or an exact code like '422'"),
      method: z.string().optional().describe("GET, POST, …"),
      limit: z.number().int().min(1).max(50).optional().describe("How many (default 15)"),
      include_bodies: z.boolean().optional().describe("Include request/response bodies (default true)"),
      max_body_chars: z.number().int().min(100).max(20000).optional().describe("Cut each body at this length (default 4000)"),
    },
    async (args) => resultText(await askBrowser("get_network", args))
  );

  // ---- 2. front-to-back trace -----------------------------------------------------
  server.tool(
    "get_trace",
    "Follows one request from the browser to the backend: the browser's view of the request (status, bodies) " +
      "plus the server's log lines and stack traces from the same moment, in time order. Works when the dev server " +
      "was started with `npm run tail -- <command>` (in the server folder) or when you give the request id. " +
      "Use it for 'the button fails' bugs: it shows the real server error behind a 500.",
    {
      url_contains: z.string().optional().describe("Which request, e.g. '/api/orders' (default: the newest failed request)"),
      request_id: z.string().optional().describe("The id from the server's x-request-id header or log line"),
      window_seconds: z.number().min(1).max(60).optional().describe("How long after the request to look for server logs (default 5)"),
    },
    async ({ url_contains, request_id, window_seconds }) => {
      const done = await askBrowser("get_network", { url_contains, limit: 30, max_body_chars: 2000 });
      const request = done?.status === "done" ? pickRequest(done.result.requests, { requestId: request_id }) : null;
      const trace = buildTrace({ request, requestId: request_id, windowSeconds: window_seconds });
      if (!request && !request_id && !trace.server_logs.length) return text(NO_ANSWER);
      return text(JSON.stringify(trace, null, 2));
    }
  );
}
