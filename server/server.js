/**
 * server.js — Unified Agent Companion Bridge & MCP Server
 *
 * One process, two jobs:
 *   1. Local HTTP API on port 5959 (with /save, /logs, /commands, /health, /api/github/context)
 *   2. Model Context Protocol (MCP) server over stdio exposing tools to coding agents
 *      (Claude Code, Cursor, Antigravity, Windsurf, Gemini CLI)
 */

import http from "node:http";
import { EventEmitter } from "node:events";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  writeSketch,
  readSketch,
  insertLogs,
  queryRecentLogs,
  queryLogGroups,
  queryLogTrace,
  writeGitHubContext,
  readGitHubContext,
  insertCommand,
  getPendingCommands,
  claimPendingCommands,
  getCommand,
  updateCommand,
  getSummaryStats,
  latestRecordingId,
  summarizeRecording,
  queryRecording,
  readScreenshot,
  writeXray,
  readXray,
} from "./storage.js";
import { readConfig, codeMatches } from "./config.js";
import { isOriginAllowed, isHostAllowed, applyCors } from "./guard.js";

const PORT = Number(process.env.PORT) || Number(process.env.LOG_SERVER_PORT) || 5959;
const MAX_BODY_BYTES = 60 * 1024 * 1024; // 60MB for large PNG wireframes

const config = readConfig();

/** Wakes long-polling extensions the moment a command is queued. */
const commandBus = new EventEmitter();
commandBus.setMaxListeners(50);
const HOST = config.lan ? "0.0.0.0" : "127.0.0.1";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const isLoopback = (req) => LOOPBACK.has(req.socket.remoteAddress);
const needsCode = (req) => config.lan && !isLoopback(req);
const isAuthorized = (req) => !needsCode(req) || codeMatches(req.headers["x-sketch-token"] || req.headers["x-access-token"], config.token);

startHttpReceiver();
startMcpServer();

// ===========================================================================
// Job 1: HTTP API Bridge (Browser Extensions & Web Clients)
// ===========================================================================
function startHttpReceiver() {
  const server = http.createServer((req, res) => {
    // Guard 1: CORS only for extension origins (never "*").
    applyCors(req, res);

    // Guard 2: refuse browser requests from untrusted web pages, and
    // DNS-rebinding attempts (unexpected Host header).
    if (!isOriginAllowed(req.headers.origin) || !isHostAllowed(req.headers.host, config.lan)) {
      respondJson(res, 403, { ok: false, error: "Forbidden origin" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // Health check
    if (pathname === "/" || pathname === "/health") {
      respondJson(res, 200, {
        ok: true,
        service: "developer-companion",
        port: PORT,
        lan: config.lan,
        authRequired: needsCode(req),
        authorized: isAuthorized(req),
        ...(isAuthorized(req) ? { stats: getSummaryStats() } : {}),
      });
      return;
    }

    // Everything below needs the access code when the caller is remote (LAN mode).
    if (!isAuthorized(req)) {
      respondJson(res, 401, { ok: false, error: "Unauthorized — access code required" });
      return;
    }

    // Save Sketch (from UI Sketch Canvas)
    if (req.method === "POST" && (pathname === "/save" || pathname === "/api/sketch")) {
      if (!isAuthorized(req)) {
        respondJson(res, 401, { ok: false, error: "Unauthorized — access code required" });
        return;
      }
      readJsonBody(req, res, (payload) => {
        try {
          writeSketch({ json: payload.json, pngBase64: payload.pngBase64 });
          respondJson(res, 200, { ok: true, message: "Sketch saved successfully" });
        } catch (err) {
          respondJson(res, 400, { ok: false, error: String(err) });
        }
      });
      return;
    }

    // Insert Logs (from Chrome Debug Logger or Browser)
    if (req.method === "POST" && pathname === "/logs") {
      readJsonBody(req, res, (payload) => {
        try {
          const count = insertLogs(payload);
          respondJson(res, 200, { ok: true, inserted: count });
        } catch (err) {
          respondJson(res, 400, { ok: false, error: String(err) });
        }
      });
      return;
    }

    // X-ray: elements the user selected on a web page
    if (req.method === "POST" && pathname === "/xray") {
      readJsonBody(req, res, (payload) => {
        try { respondJson(res, 200, { ok: true, count: writeXray(payload) }); }
        catch (err) { respondJson(res, 400, { ok: false, error: String(err) }); }
      });
      return;
    }

    // Query Recent Logs
    if (req.method === "GET" && (pathname === "/logs/recent" || pathname === "/logs")) {
      const app = url.searchParams.get("app") || undefined;
      const level = url.searchParams.get("level") || undefined;
      const minutes = Number(url.searchParams.get("minutes")) || 60;
      const limit = Number(url.searchParams.get("limit")) || 100;
      try {
        const rows = queryRecentLogs({ app, level, minutes, limit });
        respondJson(res, 200, { ok: true, logs: rows });
      } catch (err) {
        respondJson(res, 500, { ok: false, error: String(err) });
      }
      return;
    }

    // Grouped Error Logs
    if (req.method === "GET" && pathname === "/logs/groups") {
      try {
        const groups = queryLogGroups({ limit: Number(url.searchParams.get("limit")) || 20 });
        respondJson(res, 200, { ok: true, groups });
      } catch (err) {
        respondJson(res, 500, { ok: false, error: String(err) });
      }
      return;
    }

    // Trace Logs by Request ID
    if (req.method === "GET" && pathname === "/logs/trace") {
      const reqId = url.searchParams.get("request_id");
      if (!reqId) {
        respondJson(res, 400, { ok: false, error: "Missing request_id" });
        return;
      }
      try {
        const trace = queryLogTrace(reqId);
        respondJson(res, 200, { ok: true, trace });
      } catch (err) {
        respondJson(res, 500, { ok: false, error: String(err) });
      }
      return;
    }

    // GitHub Context endpoint (push/pull catalog from dashboard)
    if (pathname === "/api/github/context") {
      if (req.method === "POST") {
        readJsonBody(req, res, (payload) => {
          writeGitHubContext(payload);
          respondJson(res, 200, { ok: true });
        });
        return;
      }
      if (req.method === "GET") {
        const ctx = readGitHubContext();
        respondJson(res, 200, { ok: true, context: ctx });
        return;
      }
    }

    // Long-poll: the extension holds this open; it returns as soon as a command exists
    // (or after ~20s with an empty list, and the extension simply asks again).
    if (pathname === "/commands/wait" && req.method === "GET") {
      const app = url.searchParams.get("app") || undefined;
      const waitMs = Math.min(Number(url.searchParams.get("timeout")) || 20000, 25000);
      const ready = claimPendingCommands(app);
      if (ready.length) { respondJson(res, 200, { commands: ready }); return; }

      const finish = () => {
        clearTimeout(timer);
        commandBus.off("new", onNew);
        if (!res.writableEnded) respondJson(res, 200, { commands: claimPendingCommands(app) });
      };
      const onNew = () => finish();
      const timer = setTimeout(finish, waitMs);
      commandBus.on("new", onNew);
      req.on("close", () => { clearTimeout(timer); commandBus.off("new", onNew); });
      return;
    }

    // Commands endpoint
    if (pathname === "/commands/pending" && req.method === "GET") {
      const app = url.searchParams.get("app") || undefined;
      respondJson(res, 200, getPendingCommands(app));
      return;
    }

    if (pathname === "/commands" && req.method === "POST") {
      readJsonBody(req, res, (body) => {
        const result = insertCommand(body);
        commandBus.emit("new");
        respondJson(res, 200, result);
      });
      return;
    }

    if (pathname.startsWith("/commands/") && req.method === "PATCH") {
      const id = pathname.slice("/commands/".length);
      readJsonBody(req, res, (body) => {
        updateCommand(id, body.status || "completed", body.result);
        respondJson(res, 200, { ok: true });
      });
      return;
    }

    respondJson(res, 404, { ok: false, error: "Not found" });
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Companion] Port ${PORT} already in use. MCP stdio mode continues running.`);
    } else {
      console.error("[Companion] Server error:", err);
    }
  });

  server.listen(PORT, HOST, () => {
    console.error(`[Companion] HTTP receiver listening on http://${HOST}:${PORT}${config.lan ? " (LAN mode)" : ""}`);
  });
}

/**
 * Embedded screenshots are megabytes of base64 — useless as text and ruinous for
 * an agent's context. The preview PNG already shows them, so the shape list keeps
 * only a marker (plus everything else: names, positions, meta such as a picked
 * element's HTML and styles).
 */
/** Polls until the extension reports the command finished, or `ms` pass (null on timeout). */
async function waitForCommand(id, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const cmd = getCommand(id);
    if (cmd && (cmd.status === "done" || cmd.status === "failed" || cmd.status === "completed")) return cmd;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

/** Most screenshots one get_latest_recording call sends back (each costs the agent tokens). */
const MAX_SHOTS_RETURNED = 6;

function withoutImageData(doc) {
  if (!doc || !Array.isArray(doc.shapes)) return doc;
  const shapes = doc.shapes.map((s) =>
    typeof s.src === "string" && s.src.startsWith("data:") ? { ...s, src: "[embedded image — see the preview PNG]" } : s
  );
  return { ...doc, shapes };
}

function readJsonBody(req, res, callback) {
  let body = "";
  let size = 0;
  let tooBig = false;

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooBig = true;
      req.destroy();
      return;
    }
    body += chunk;
  });

  req.on("close", () => {
    if (tooBig && !res.headersSent) {
      respondJson(res, 413, { ok: false, error: "Payload too large" });
    }
  });

  req.on("end", () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      callback(parsed);
    } catch (err) {
      respondJson(res, 400, { ok: false, error: "Invalid JSON: " + err.message });
    }
  });
}

function respondJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// ===========================================================================
// Job 2: MCP Server over stdio (Coding Agents: Claude Code, Cursor, Antigravity)
// ===========================================================================
function startMcpServer() {
  const server = new McpServer({
    name: "developer-companion-mcp",
    version: "1.0.0",
  });

  // Tool 1: get_latest_sketch
  server.tool(
    "get_latest_sketch",
    "Returns the most recently drawn UI wireframe sketch from the Developer Companion " +
      "canvas: includes a JSON description of components, labels, and coordinates, " +
      "plus a high-resolution PNG preview image. Use this whenever the user asks to implement, " +
      "review, or inspect a UI design, wireframe, or sketch.",
    {},
    async () => {
      const sketch = readSketch();
      if (!sketch) {
        return {
          content: [
            {
              type: "text",
              text: "No sketch has been exported yet. Open the Developer Companion canvas in Chrome and click 'Send to project'.",
            },
          ],
        };
      }
      const content = [{ type: "text", text: JSON.stringify(withoutImageData(sketch.json), null, 2) }];
      if (sketch.pngBase64) {
        content.push({ type: "image", data: sketch.pngBase64, mimeType: "image/png" });
      }
      return { content };
    }
  );

  // Tool 2: get_browser_logs
  server.tool(
    "get_browser_logs",
    "Retrieves captured browser logs, console errors, uncaught exceptions, and failed HTTP network " +
      "requests (4xx/5xx) captured from the user's active browser tabs and development servers. " +
      "Call this when debugging front-end errors, API failures, or diagnosing UI issues.",
    {
      app: z.string().optional().describe("Filter by application label or domain (e.g. 'localhost', 'my-app')"),
      level: z.string().optional().describe("Filter by log level: 'error', 'warn', 'info'"),
      minutes: z.number().optional().describe("Retrieve logs from the past N minutes (default: 60)"),
      limit: z.number().optional().describe("Maximum number of log rows to return (default: 50)"),
    },
    async ({ app, level, minutes = 60, limit = 50 }) => {
      const rows = queryRecentLogs({ app, level, minutes, limit });
      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No browser logs found in the past ${minutes} minutes${app ? ` for app '${app}'` : ""}${level ? ` with level '${level}'` : ""}. Ensure the Developer Companion extension is capturing tabs.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    }
  );

  // Tool 2b: get_latest_recording
  server.tool(
    "get_latest_recording",
    "Returns the browser session the user just RECORDED while testing their app: a summary " +
      "(duration, error counts, grouped top errors, markers the user dropped where something went wrong) " +
      "plus the log rows in time order. Call this when the user says they recorded a session, " +
      "reproduced a bug, or asks you to look at what happened while they were testing.",
    {
      session: z.string().optional().describe("A specific recording id (default: the newest)"),
      verbosity: z.enum(["problems", "all"]).optional().describe("'problems' = errors, warnings and markers (default); 'all' includes every request and console line"),
      limit: z.number().optional().describe("Max rows to return (default 200)"),
    },
    async ({ session, verbosity = "problems", limit = 200 }) => {
      const id = session || latestRecordingId();
      const summary = id ? summarizeRecording(id) : null;
      if (!summary) {
        return { content: [{ type: "text", text: "No recording found. Ask the user to press Record in Developer Companion, reproduce the problem, then Stop & send." }] };
      }
      const rows = queryRecording(id, { verbosity, limit });
      const shots = rows.filter((r) => r.context?.screenshot_file);
      const content = [{ type: "text", text: JSON.stringify({ summary, shown: rows.length, verbosity, screenshots: shots.length, rows }, null, 2) }];
      // Screenshots follow the text, each labelled so the agent knows what moment it shows.
      for (const r of shots.slice(0, MAX_SHOTS_RETURNED)) {
        const img = readScreenshot(id, r.context.screenshot_file);
        if (!img) continue;
        content.push({ type: "text", text: `Screenshot at ${r.created_at} — ${r.message}` });
        content.push({ type: "image", ...img });
      }
      return { content };
    }
  );

  // Tool: get_selected_elements (X-ray mode)
  server.tool(
    "get_selected_elements",
    "Returns the web page elements the user selected with X-ray mode: for each one its CSS selector, " +
      "framework component name (React/Vue, when known), position in the page hierarchy, text, HTML, " +
      "computed styles and a cropped screenshot. Call this when the user says they selected or pointed at " +
      "something on a page and wants it changed, fixed or explained.",
    {},
    async () => {
      const found = readXray();
      if (!found) return { content: [{ type: "text", text: "No selected elements yet. Ask the user to turn on X-ray (Alt+Shift+X on the page), click the element, and press Send to agent." }] };
      const content = [{ type: "text", text: JSON.stringify(found.doc, null, 2) }];
      found.images.forEach((data, i) => {
        if (!data) return;
        content.push({ type: "text", text: `Screenshot of element ${i + 1}: ${found.doc.elements[i].hierarchy?.slice(-1)[0] || found.doc.elements[i].tag}` });
        content.push({ type: "image", data, mimeType: "image/png" });
      });
      return { content };
    }
  );

  // Tool 3: get_github_repos
  server.tool(
    "get_github_repos",
    "Retrieves GitHub repository metadata, catalog, and AI-generated summaries cached " +
      "by the Developer Companion GitHub Dashboard. Call this when researching the user's " +
      "repositories, projects, star counts, or topics.",
    {
      search: z.string().optional().describe("Keyword search across repo names and descriptions"),
    },
    async ({ search }) => {
      const context = readGitHubContext();
      if (!context) {
        return {
          content: [
            {
              type: "text",
              text: "No GitHub repository catalog cached yet. Open the GitHub Dashboard in the Developer Companion canvas to sync repos.",
            },
          ],
        };
      }

      let repos = Array.isArray(context) ? context : context.repos || [];
      if (search) {
        const q = search.toLowerCase();
        repos = repos.filter(
          (r) =>
            r.name?.toLowerCase().includes(q) ||
            r.description?.toLowerCase().includes(q) ||
            r.summary?.toLowerCase().includes(q)
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(repos.slice(0, 30), null, 2),
          },
        ],
      };
    }
  );

  // Tool 4: send_browser_command
  server.tool(
    "send_browser_command",
    "Sends a command to the user's browser through Developer Companion. Supported: " +
      "'flush' (send buffered logs now), 'status' (which sites are being captured), " +
      "'attach' / 'detach' (start/stop capturing a site, needs app_name), 'localstorage_snapshot' (needs app_name). " +
      "To SEE the running app, use capture_tab instead.",
    {
      command: z.string().describe("One of: flush, status, attach, detach, localstorage_snapshot"),
      app_name: z.string().optional().describe("Target site label, e.g. 'localhost'"),
      payload: z.record(z.any()).optional().describe("Command parameters"),
    },
    async ({ command, app_name, payload }) => {
      const res = insertCommand({ app_name, command, payload });
      commandBus.emit("new");
      const done = await waitForCommand(res.id, 15000);
      const text = done
        ? JSON.stringify({ status: done.status, result: done.result }, null, 2)
        : `Command queued (ID: ${res.id}) but the browser hasn't answered yet. Is Chrome open with the extension?`;
      return { content: [{ type: "text", text }] };
    }
  );

  // Tools 4c-4e: let the agent record a session and drive the page itself
  const askBrowser = async (command, payload = {}, waitMs = 20000) => {
    const res = insertCommand({ command, payload });
    commandBus.emit("new");
    return waitForCommand(res.id, waitMs);
  };
  const asText = (done) => ({ content: [{ type: "text", text: done
    ? JSON.stringify({ status: done.status, result: done.result }, null, 2)
    : "The browser didn't answer. Is Chrome open with the Developer Companion extension?" }] });

  server.tool(
    "start_recording",
    "Starts recording the user's browser session (console, errors, network, clicks, navigation, screenshots) on " +
      "allowed sites. Then use interact_with_page to reproduce a bug, and stop_recording followed by get_latest_recording.",
    {},
    async () => asText(await askBrowser("rec_start"))
  );

  server.tool(
    "stop_recording",
    "Stops the recording and saves it. Afterwards call get_latest_recording to read what happened.",
    {},
    async () => asText(await askBrowser("rec_stop", {}, 30000))
  );

  server.tool(
    "interact_with_page",
    "Drives the user's running app (allowed sites only, e.g. localhost): click an element, fill an input, " +
      "navigate to another page of the same site, or reload. Use it with start_recording to reproduce a bug.",
    {
      action: z.enum(["click", "fill", "navigate", "reload"]),
      selector: z.string().optional().describe("CSS selector, for click and fill"),
      value: z.string().optional().describe("Text to type, for fill"),
      url: z.string().optional().describe("Address, for navigate"),
      url_contains: z.string().optional().describe("Pick the tab whose URL contains this text"),
    },
    async (args) => asText(await askBrowser("page_action", args))
  );

  // Tool 4b: capture_tab
  server.tool(
    "capture_tab",
    "Takes a screenshot of the user's running web app (a tab on an allowed site such as localhost) and " +
      "returns it as an image, plus the page URL and title. Use it after changing UI code to check how the " +
      "result actually looks, or to compare it with the user's sketch.",
    {
      url_contains: z.string().optional().describe("Only capture a tab whose URL contains this text, e.g. ':3000' or '/settings'"),
      max_width: z.number().optional().describe("Shrink the screenshot to at most this many pixels wide (default 1280)"),
    },
    async ({ url_contains, max_width = 1280 }) => {
      const { id } = insertCommand({ command: "capture_tab", payload: { url_contains, max_width } });
      commandBus.emit("new");
      const done = await waitForCommand(id, 30000);
      if (!done) {
        return { content: [{ type: "text", text: "Timed out. Make sure Chrome is open with the Developer Companion extension and the agent server is reachable from it." }] };
      }
      const r = done.result || {};
      if (done.status !== "done" || !r.dataUrl) {
        return { content: [{ type: "text", text: `Couldn't capture: ${r.error || "unknown error"}` }] };
      }
      // Keep the database small: the image goes to the agent, not into storage.
      updateCommand(id, "done", { url: r.url, title: r.title, captured: true });
      const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/.exec(r.dataUrl) || [];
      return {
        content: [
          { type: "text", text: JSON.stringify({ url: r.url, title: r.title, width: r.width, height: r.height }) },
          { type: "image", data, mimeType },
        ],
      };
    }
  );

  // Tool 5: get_companion_status
  server.tool(
    "get_companion_status",
    "Returns an overview of the Developer Companion state: sketch status, total logs captured, " +
      "recent errors, and GitHub sync status.",
    {},
    async () => {
      const stats = getSummaryStats();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error("[Companion] MCP stdio transport connection notice:", err.message || err);
  });
}
