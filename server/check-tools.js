/**
 * check-tools.js — MCP tools for acceptance checks.
 *
 *   run_checks             run Given/When/Then scenarios (or structured checks) in the user's real tab
 *   checks_from_recording  draft a scenario from the newest recording of what the user did
 */

import { z } from "zod";
import { checksFromRecording } from "./checks-from-recording.js";
import { latestRecordingId, queryRecording } from "./storage.js";

const NO_ANSWER = "The browser didn't answer. Is Chrome open with the Developer Companion extension, and is the app open on an allowed site (localhost by default)?";
const text = (t) => ({ content: [{ type: "text", text: t }] });

const stepSchema = z.object({
  do: z.enum(["goto", "click", "type", "press", "wait"]).optional(), expect: z.enum(["text", "no_text", "selector", "no_selector", "url", "no_console_errors", "request"]).optional(),
  url: z.string().optional(), selector: z.string().optional(), text: z.string().optional(), key: z.string().optional(), ms: z.number().optional(),
  contains: z.string().optional(), url_contains: z.string().optional(), method: z.string().optional(), status: z.union([z.string(), z.number()]).optional(),
}).describe("One step: { do: 'goto'|'click'|'type'|'press'|'wait', … } or { expect: 'text'|'no_text'|'selector'|'no_selector'|'url'|'no_console_errors'|'request', … }");

/** Report -> MCP content: JSON without the images, then the failure screenshots as images. */
export function reportContent(done) {
  if (!done) return text(NO_ANSWER);
  if (done.status !== "done") return text(`Failed: ${done.result?.error || "unknown error"}`);
  const images = [];
  const clean = { ...done.result, results: done.result.results.map((r) => {
    if (!r.evidence?.screenshot) return r;
    images.push({ type: "image", data: r.evidence.screenshot, mimeType: "image/png" });
    const { screenshot, ...evidence } = r.evidence;
    return { ...r, evidence: { ...evidence, screenshot: `image ${images.length} below` } };
  }) };
  return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }, ...images] };
}

export function registerCheckTools(server, { askBrowser }) {
  server.tool(
    "run_checks",
    "Runs acceptance checks in the user's real browser tab (allowed sites only) and tells you which passed, with evidence for " +
      "each failure: the failing step and why, a screenshot, console errors, failed requests and the page text. Give either " +
      "`scenarios` — plain Given/When/Then text, e.g. 'Scenario: Sign in / Given I open /login / When I type \"a@b.co\" into #email / " +
      "And I click \"Sign in\" / Then I see \"Welcome\" / And the url contains /dashboard / And POST /api/login returned 200 / And there are no console errors' — " +
      "or structured `checks`. Use it after you build a feature to PROVE it works the way the user described, and re-run it after every fix. " +
      "Clicks and typing are real input events. Steps run in order; a check stops at its first failure.",
    {
      scenarios: z.string().optional().describe("Given/When/Then text with 'Scenario: name' blocks"),
      checks: z.array(z.object({ name: z.string().optional(), steps: z.array(stepSchema) })).optional().describe("Structured alternative to scenarios"),
      url_contains: z.string().optional().describe("Which tab"),
      timeout_ms: z.number().int().min(500).max(15000).optional().describe("How long each expectation may wait (default 3000)"),
    },
    async (args) => {
      if (!args.scenarios && !args.checks) return text("Give `scenarios` (Given/When/Then text) or `checks`.");
      return reportContent(await askBrowser("run_checks", args, 120000));
    },
  );

  server.tool(
    "checks_from_recording",
    "Drafts an acceptance check from the user's newest recording (what they clicked and where they went), as Given/When/Then text " +
      "you can edit and pass to run_checks. Typed values are never recorded, so add them. Use it to turn 'I did this and it broke' into a repeatable test.",
    { session: z.string().optional().describe("Recording id (default: the newest)"), name: z.string().optional().describe("Scenario name") },
    async ({ session, name }) => {
      const id = session || latestRecordingId();
      if (!id) return text("No recording yet. Ask the user to press Record in the extension, do the flow, and press Stop.");
      const rows = queryRecording(id, { verbosity: "all", limit: 2000 });
      // The end of the recorded flow is usually still on screen: read it to draft the "I see …" expectations.
      const page = await askBrowser("suggest_assertions", {}, 8000);
      const suggestions = page?.status === "done" ? page.result.suggestions || [] : [];
      const draft = checksFromRecording(rows, { name, suggestions });
      return text(`Draft from recording ${id}:\n\n${draft.scenario}\n\nTo finish:\n${draft.notes.map((n) => `- ${n}`).join("\n")}\n\nPass the final text to run_checks as \`scenarios\`.`);
    },
  );
}
