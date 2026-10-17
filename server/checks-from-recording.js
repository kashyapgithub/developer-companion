/**
 * checks-from-recording.js — turns a recorded user session (clicks + navigations) into a draft
 * acceptance check, so "I did this and it broke" becomes a repeatable test.
 *
 * Pure: takes the timeline rows queryRecording() returns. The recording never contains typed
 * text (privacy), so the draft says where inputs are still needed.
 */

import { toScenarioText } from "../lib/agent-tools/checks-spec.js";

/** Path + query of a URL, or the text if it isn't one. */
const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

/** Rows (oldest first) -> { checks, scenario, notes }. */
export function checksFromRecording(rows, { name = "Recorded flow", suggestions = [] } = {}) {
  const steps = [], notes = [];
  let pendingUrl = null;           // a navigation that came right after a click becomes an expectation

  for (const row of rows) {
    const tags = Array.isArray(row.tags) ? row.tags : [];
    if (!tags.includes("timeline")) continue;
    if (tags.includes("navigation")) {
      const path = pathOf(row.context?.url || "");
      if (!path) continue;
      const last = steps[steps.length - 1];
      if (!steps.length) steps.push({ do: "goto", url: path });
      else if (last?.do === "click" || last?.do === "press") steps.push({ expect: "url", contains: path.split("?")[0] });
      pendingUrl = path;
    } else if (tags.includes("user-action")) {
      const a = row.context?.action || {};
      if (a.kind === "submit") { notes.push("A form was submitted here; type its values with 'I type \"…\" into <field>' steps (typed text is never recorded)."); continue; }
      const step = a.label && !/^(input|textarea|select)$/.test(a.tag) ? { do: "click", text: a.label } : { do: "click", selector: a.selector };
      if (!step.text && !step.selector) continue;
      if (JSON.stringify(step) !== JSON.stringify(steps[steps.length - 1])) steps.push(step);
    }
  }
  if (!steps.some((s) => s.do === "goto")) steps.unshift({ do: "goto", url: pendingUrl || "/" });

  // The network failures during the recording are exactly what the check should guard against.
  const failed = rows.filter((r) => (r.tags || []).includes?.("network") && (r.tags || []).includes?.("failed")).length;
  if (failed) notes.push(`${failed} network request(s) failed during the recording; add 'POST /api/… returned 2xx'-style steps for the calls that matter.`);

  // Outcomes come from what the page shows now (the end of the flow): messages first, then headings. A page title is only a fallback.
  const seen = suggestions.filter((x) => x.kind !== "title").slice(0, 3);
  for (const x of seen.length ? seen : suggestions.slice(0, 1)) steps.push({ expect: "text", text: x.text });
  steps.push({ expect: "no_console_errors" });
  notes.push(suggestions.length
    ? "The 'I see' lines come from what the page shows right now. Check they describe the RESULT you want, not just the screen you ended on."
    : "Add 'I see \"…\"' steps for what the user should end up seeing: the recording captures actions, not outcomes.");
  const checks = [{ name, steps }];
  return { checks, scenario: toScenarioText(checks), notes: [...new Set(notes)] };
}
