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
import { saveBaseline, readBaseline, diffPng } from "./visual-diff.js";

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

  // ---- 3. visual diff -------------------------------------------------------------
  server.tool(
    "visual_diff",
    "Compares the running app's screen with a saved 'before' screenshot and shows exactly what changed: " +
      "percent of pixels changed, the changed regions as boxes (x, y, width, height), and a diff image with " +
      "changes in red. First call saves the baseline; after editing code call it again. Use it to check that " +
      "a CSS/UI change did what you meant and nothing else moved. Pass update_baseline:true to accept the " +
      "current look as the new baseline.",
    {
      name: z.string().optional().describe("Baseline name, e.g. 'settings-page' (default 'default'); use one per page or state"),
      url_contains: z.string().optional().describe("Which tab, e.g. ':3000/settings'"),
      max_width: z.number().int().min(300).max(2000).optional().describe("Screenshot width for both baseline and compare (default 1000)"),
      update_baseline: z.boolean().optional().describe("Replace the baseline with the current screen"),
      tolerance: z.number().int().min(0).max(80).optional().describe("Colour difference ignored per pixel, 0-255 (default 16)"),
    },
    async ({ name = "default", url_contains, max_width = 1000, update_baseline, tolerance }) => {
      const done = await askBrowser("capture_tab", { url_contains, max_width, format: "png" }, 30000);
      if (!done) return text(NO_ANSWER);
      if (done.status !== "done" || !done.result?.dataUrl) return text(`Couldn't capture: ${done.result?.error || "unknown error"}`);
      const current = Buffer.from(done.result.dataUrl.split(",")[1], "base64");
      const base = readBaseline(name);

      if (!base || update_baseline) {
        saveBaseline(name, current);
        return { content: [
          { type: "text", text: JSON.stringify({ baseline: name, saved: true, message: base ? "Baseline updated." : "Baseline saved. Make your change, then call visual_diff again with the same name.", page: done.result.url }, null, 2) },
          imageBlock(done.result.dataUrl),
        ] };
      }
      let result;
      try { result = diffPng(base.buffer, current, { tolerance }); }
      catch (e) { return text(`Couldn't compare the screenshots (${e.message}). Call again with update_baseline:true.`); }
      const verdict = result.changedPercent === 0 && !result.sizeChanged ? "No visual change." : `${result.changedPercent}% of the screen changed in ${result.regions.length} region(s).`;
      return { content: [
        { type: "text", text: JSON.stringify({ baseline: name, baseline_saved_at: base.savedAt, page: done.result.url, verdict,
          changed_percent: result.changedPercent, size_changed: result.sizeChanged, baseline_size: result.baselineSize, current_size: result.currentSize, regions: result.regions }, null, 2) },
        imageBlock("data:image/png;base64," + result.diffPng.toString("base64")),
      ] };
    }
  );

  // ---- 4. design tokens -----------------------------------------------------------
  server.tool(
    "get_design_tokens",
    "Measures the look of the user's open web page (allowed sites): the colours, fonts, font sizes, border radii, " +
      "shadows and spacing it actually uses, ranked by how much they appear, plus the site's own CSS variables. " +
      "Returns ready-to-paste CSS custom properties and a Tailwind theme.extend snippet. Use it to match an existing " +
      "design or to turn a site the user likes into tokens for their project.",
    { url_contains: z.string().optional().describe("Which tab, e.g. 'stripe.com' (default: the active allowed tab)") },
    async ({ url_contains }) => resultText(await askBrowser("design_tokens", { url_contains }, 30000))
  );

  // ---- 8. API mock mode --------------------------------------------------------------
  server.tool(
    "set_mock",
    "Answers matching requests of the user's running app (allowed sites) with a fake response, without touching the " +
      "backend — so you can see how the UI looks on an error, an empty list, a slow response or a failed connection. " +
      "Give url_contains (and optionally method), then status/body, or fail:true for a network failure, or delay_ms " +
      "to make it slow. from_recorded:true starts from the last real response (secrets are masked in it). " +
      "Reload or re-trigger the request afterwards. Always call clear_mocks when done.",
    {
      url_contains: z.string().describe("Part of the request URL to intercept, e.g. '/api/orders'"),
      method: z.string().optional().describe("Only this HTTP method, e.g. 'POST'"),
      status: z.number().int().min(100).max(599).optional().describe("HTTP status (default 200)"),
      body: z.union([z.string(), z.record(z.any()), z.array(z.any())]).optional().describe("Response body: text, or JSON"),
      content_type: z.string().optional().describe("Content-Type (default: JSON if the body looks like JSON)"),
      headers: z.record(z.string()).optional().describe("Extra response headers"),
      delay_ms: z.number().int().min(0).max(10000).optional().describe("Wait this long before answering"),
      fail: z.boolean().optional().describe("Make the request fail like a dropped connection"),
      from_recorded: z.boolean().optional().describe("Start from the last recorded real response"),
      url_contains_tab: z.string().optional().describe("Which tab (part of its URL)"),
    },
    async (args) => resultText(await askBrowser("set_mock", args, 20000))
  );

  server.tool(
    "list_mocks",
    "Lists the active API mocks on the user's app tab and how many requests each answered.",
    { url_contains_tab: z.string().optional().describe("Which tab") },
    async (args) => resultText(await askBrowser("list_mocks", args, 15000))
  );

  server.tool(
    "clear_mocks",
    "Removes API mocks from the user's app tab: one by id, or all of them. Real requests flow again.",
    { id: z.string().optional().describe("Mock id from set_mock/list_mocks (omit to clear all)"), url_contains_tab: z.string().optional().describe("Which tab") },
    async (args) => resultText(await askBrowser("clear_mocks", args, 15000))
  );

  // ---- 7. accessibility + performance scan -----------------------------------------
  server.tool(
    "audit_page",
    "Quick accessibility and performance scan of the user's open web page (allowed sites). Accessibility: missing alt " +
      "text, unnamed buttons/links, unlabelled form fields, heading order, missing lang/title, low colour contrast. " +
      "Performance: first paint, largest paint, layout shift, request count, transfer size, slowest resources — each " +
      "rated good / needs work / poor. Issues include a selector so you can find the element. Not a full WCAG audit.",
    { url_contains: z.string().optional().describe("Which tab") },
    async ({ url_contains }) => resultText(await askBrowser("audit_page", { url_contains }, 30000))
  );

  // ---- 6. page state snapshot -------------------------------------------------------
  server.tool(
    "get_page_state",
    "Reads the client-side state of the user's open web page (allowed sites): localStorage, sessionStorage, cookie " +
      "NAMES (never values) and framework globals like __NEXT_DATA__ / __NUXT__ / __INITIAL_STATE__. Secrets are masked. " +
      "Use it to debug 'why is the UI in this state' — logged-in or not, feature flags, cached data.",
    { url_contains: z.string().optional().describe("Which tab") },
    async ({ url_contains }) => resultText(await askBrowser("page_state", { url_contains }, 20000))
  );

  // ---- 5. responsive capture + network throttle -------------------------------------
  server.tool(
    "capture_responsive",
    "Screenshots the user's running app at several screen widths (default phone 375, tablet 768, desktop 1280) and " +
      "reports, for each, whether the page scrolls sideways (a common mobile bug). Use it after changing layout " +
      "or CSS to check every size in one call. The browser's size is restored afterwards.",
    {
      widths: z.array(z.number().int().min(200).max(3000)).max(4).optional().describe("Screen widths in px (default [375, 768, 1280])"),
      url_contains: z.string().optional().describe("Which tab"),
      height: z.number().int().min(300).max(2000).optional().describe("Screen height in px (default 800)"),
      full_page: z.boolean().optional().describe("Capture the whole scrollable page, not just the first screen"),
    },
    async (args) => {
      const done = await askBrowser("capture_responsive", args, 60000);
      if (!done || done.status !== "done") return resultText(done);
      const { url, title, shots } = done.result;
      const summary = shots.map(({ dataUrl, ...s }) => s);
      const content = [{ type: "text", text: JSON.stringify({ url, title, sizes: summary, sideways_scroll_at: summary.filter((s) => s.overflowX).map((s) => s.width) }, null, 2) }];
      for (const s of shots) { content.push({ type: "text", text: `${s.width}px wide${s.overflowX ? " — scrolls sideways!" : ""}` }); const img = imageBlock(s.dataUrl); if (img) content.push(img); }
      return { content };
    }
  );

  server.tool(
    "set_network_throttle",
    "Slows or cuts the network for the user's running app tab so you can see loading and error states: " +
      "'slow-3g', 'fast-3g', 'offline', or 'none' to go back to normal. Remember to set 'none' when done.",
    {
      profile: z.enum(["slow-3g", "fast-3g", "offline", "none"]).describe("Network speed to emulate"),
      url_contains: z.string().optional().describe("Which tab"),
    },
    async (args) => resultText(await askBrowser("network_throttle", args))
  );
}
