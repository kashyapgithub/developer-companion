/**
 * vitals-tools.js — MCP tool `get_vitals`: measures Core Web Vitals in the user's tab, can save the result
 * as a named baseline and compare against one ("did my change make it slower?").
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getStoreDir } from "./config.js";
import { compareVitals } from "../lib/agent-tools/vitals-format.js";

const NO_ANSWER = "The browser didn't answer. Is Chrome open with the Developer Companion extension, and is the app open on an allowed site (localhost by default)?";
const text = (t) => ({ content: [{ type: "text", text: t }] });
const dir = () => path.join(getStoreDir(), "vitals");
const safe = (n) => String(n || "default").replace(/[^\w.-]/g, "_").slice(0, 60) || "default";
const file = (name) => path.join(dir(), `${safe(name)}.json`);

/** Saves a report as a baseline. */
export function saveVitalsBaseline(name, report) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify({ savedAt: new Date().toISOString(), report }, null, 2));
  return { name: safe(name) };
}
/** { savedAt, report } or null. */
export function readVitalsBaseline(name) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch { return null; }
}

export function registerVitalsTool(server, { askBrowser }) {
  server.tool(
    "get_vitals",
    "Measures the Core Web Vitals of the user's open page (allowed sites): LCP, INP, CLS, plus FCP, TTFB and main-thread blocking, " +
      "each rated good / needs work / poor, with attribution (which element is the LCP, what shifts the layout, which interaction is slowest) and a 'fix_first' list. " +
      "INP needs an interaction first (click around or run run_checks). Use `save_baseline` before a change and `compare_to` after it to see " +
      "whether performance regressed. `reload: true` measures a fresh page load. Lab measurement in the user's browser.",
    {
      url_contains: z.string().optional().describe("Which tab"),
      reload: z.boolean().optional().describe("Reload the page first to measure a fresh load (loses INP interactions)"),
      save_baseline: z.string().optional().describe("Save this measurement under this name, e.g. 'before-refactor'"),
      compare_to: z.string().optional().describe("Compare with a saved baseline of this name"),
    },
    async ({ url_contains, reload, save_baseline, compare_to }) => {
      const done = await askBrowser("get_vitals", { url_contains, reload }, 45000);
      if (!done) return text(NO_ANSWER);
      if (done.status !== "done") return text(`Failed: ${done.result?.error || "unknown error"}`);
      const report = done.result;
      if (compare_to) {
        const base = readVitalsBaseline(compare_to);
        report.comparison = base ? { baseline: compare_to, baselineSavedAt: base.savedAt, ...compareVitals(report, base.report) } : { error: `No baseline named "${compare_to}". Save one first with save_baseline.` };
      }
      if (save_baseline) report.saved_baseline = saveVitalsBaseline(save_baseline, report).name;
      return text(JSON.stringify(report, null, 2));
    },
  );
}
