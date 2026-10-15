/**
 * server.js — Unified Agent Companion Bridge & MCP Server
 *
 * One process, two jobs:
 *   1. Local HTTP API on port 5959 (with /save, /logs, /commands, /health, /api/github/context)
 *   2. Model Context Protocol (MCP) server over stdio exposing tools to coding agents
 *      (Claude Code, Cursor, Antigravity, Windsurf, Gemini CLI)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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
  openVideoWrite,
  writeVideoReview,
  readVideoReview,
  readXray,
} from "./storage.js";
import { readConfig, codeMatches, getStoreDir } from "./config.js";
import { isOriginAllowed, isHostAllowed, applyCors } from "./guard.js";
import { handleInspiration } from "./inspiration-routes.js";
import { handleHandoff } from "./handoff-routes.js";
import { buildBundle, describeBundle, saveBundleFile } from "./handoff.js";
import { searchItems, readItemImage } from "./inspiration.js";
import { registerBrowserTools } from "./browser-tools.js";
import { registerWatchConsole } from "./watch-console.js";
import { handleApiClient } from "./api/routes.js";
import { registerApiTools } from "./api/tools.js";
import { handleFlow, registerFlowTool } from "./flow.js";

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

    // Video review: raw video upload (streamed to disk, never held in memory), then the notes
    if (req.method === "POST" && pathname === "/video/upload") {
      const id = url.searchParams.get("id");
      if (!id) return respondJson(res, 400, { ok: false, error: "id is required" });
      const { stream, cap } = openVideoWrite(id);
      let size = 0, tooBig = false;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > cap) { tooBig = true; req.destroy(); stream.destroy(); return; }
        stream.write(chunk);
      });
      req.on("end", () => stream.end(() => respondJson(res, 200, { ok: true, bytes: size })));
      req.on("error", () => { if (tooBig) respondJson(res, 413, { ok: false, error: "Video too large" }); });
      return;
    }
    if (req.method === "POST" && pathname === "/video/review") {
      readJsonBody(req, res, (payload) => {
        try { respondJson(res, 200, { ok: true, id: writeVideoReview(payload).id }); }
        catch (err) { respondJson(res, 400, { ok: false, error: String(err) }); }
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

    // Session handoff: export / import everything the agent sees as one file
    if (handleHandoff(req, res, pathname, url.searchParams, { readJsonBody, respondJson })) return;

    // Explain flow to agent: the flowchart the user drew
    if (handleFlow(req, res, pathname, { readJsonBody, respondJson })) return;

    // API client (collections, environments, send requests): the popup window talks to these
    if (handleApiClient(req, res, pathname, { readJsonBody, respondJson })) return;

    // Inspiration library (folders of saved screenshots)
    if (handleInspiration(req, res, pathname, { readJsonBody, respondJson })) return;

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

  // Tool: get_inspiration
  server.tool(
    "get_inspiration",
    "Returns screenshots the user saved to their inspiration library (designs and sites they like), with " +
      "title, source URL, folder and their notes, plus the images. Use it when the user says to match the " +
      "style of, or take ideas from, their saved inspiration or a named folder. Call with no arguments to " +
      "see the folder names first.",
    {
      folder: z.string().optional().describe("Folder name, e.g. 'Dashboards' (or 'Unsorted')"),
      query: z.string().optional().describe("Text to find in titles, notes and URLs"),
      limit: z.number().int().min(1).max(30).optional().describe("Max items listed (default 12)"),
      include_images: z.boolean().optional().describe("Attach the images (default true, at most 4)"),
    },
    async ({ folder, query, limit, include_images }) => {
      const found = searchItems({ folder, query, limit });
      if (!found.items.length) {
        return { content: [{ type: "text", text: JSON.stringify({ message: "No saved inspiration matched. Ask the user to save screenshots to the Inspiration tab.", folders: found.folders }, null, 2) }] };
      }
      const content = [{ type: "text", text: JSON.stringify(found, null, 2) }];
      if (include_images !== false) {
        for (const item of found.items.slice(0, 4)) {
          const img = readItemImage(item.id);
          if (!img) continue;
          content.push({ type: "text", text: `Image: ${item.title}${item.note ? " — " + item.note : ""}` });
          content.push({ type: "image", data: img.buffer.toString("base64"), mimeType: img.mime });
        }
      }
      return { content };
    }
  );

  // Tool: get_video_review
  server.tool(
    "get_video_review",
    "Returns a screen recording the user made while reviewing their app, with the moments they paused on. " +
      "Each moment has the time, a screenshot of that exact frame, what the user WANTS ('expected') and what is " +
      "(the user may have drawn arrows/boxes on the frame to point at the problem; 'annotations' says what) " +
      "ACTUALLY happening ('actual'). Start from the moments: compare each frame with the expectation and fix the " +
      "difference. The full video file path is included for tools that can watch video. If a log recording was " +
      "captured at the same time, its id is given: read it with get_latest_recording.",
    { id: z.string().optional().describe("A specific review id (default: the newest)") },
    async ({ id }) => {
      const found = readVideoReview(id);
      if (!found) return { content: [{ type: "text", text: "No video review yet. Ask the user to press Video in Developer Companion, record, pause on the moments that matter and write what they want vs what happens." }] };
      const { doc, frames } = found;
      const summary = {
        id: doc.id, duration_seconds: doc.durationSeconds, source: doc.source || null,
        video_file: doc.video_file, log_recording_id: doc.recordingId || null,
        moments: doc.moments.map((m, i) => ({ n: i + 1, at: m.at, expected: m.expected, actual: m.actual, note: m.note || undefined, annotations: m.annotations || undefined })),
      };
      const content = [{ type: "text", text: JSON.stringify(summary, null, 2) }];
      frames.slice(0, MAX_SHOTS_RETURNED + 4).forEach((data, i) => {
        if (!data) return;
        const m = doc.moments[i];
        content.push({ type: "text", text: `Moment ${i + 1} at ${m.at}\nWANTED: ${m.expected || "(not written)"}\nHAPPENING: ${m.actual || "(not written)"}${m.annotations ? `\nThe user drew on this frame (${m.annotations}) to point at the problem area.` : ""}` });
        content.push({ type: "image", data, mimeType: "image/jpeg" });
      });
      return { content };
    }
  );

  // Tool: export_handoff
  server.tool(
    "export_handoff",
    "Packs everything the user has shared in this session (sketch, X-ray selection, video review notes and frames, " +
      "inspiration library, log recording summary) into ONE json file and returns its path and contents list. Use it " +
      "to hand the session to someone else or another machine. The user can import it from Agent settings > Import handoff.",
    { include_inspiration: z.boolean().optional().describe("Include the inspiration library images (default true; can be large)") },
    async ({ include_inspiration }) => {
      const bundle = buildBundle({ inspiration: include_inspiration !== false });
      const file = saveBundleFile(bundle, path.join(getStoreDir(), "handoffs"));
      return { content: [{ type: "text", text: JSON.stringify({ file, size_kb: Math.round(fs.statSync(file).size / 1024), contains: describeBundle(bundle) }, null, 2) }] };
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

  registerBrowserTools(server, { askBrowser });
  registerWatchConsole(server);
  registerApiTools(server);
  registerFlowTool(server);

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
