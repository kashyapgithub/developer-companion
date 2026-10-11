/**
 * action-tracker.js — what the USER did, for the recording timeline.
 *
 * Two small pieces:
 *   - TRACKER_SOURCE: a script injected into the recorded page. It reports
 *     clicks and form submits through the `dcAction` CDP binding. It never
 *     reads typed text or field values, only what the element is.
 *   - describeAction(): turns a reported action into one readable timeline line.
 */

/** Name of the page-side binding the tracker calls (see Runtime.addBinding). */
export const BINDING_NAME = "dcAction";

/** Injected into every page of a recorded tab. Idempotent. */
export const TRACKER_SOURCE = `(() => {
  if (window.__dcTracker) return;
  window.__dcTracker = true;
  const INTERACTIVE = "a,button,input,select,textarea,summary,label,[role=button],[role=link],[onclick]";

  /** A short, value-free description of an element. */
  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\\s+/).filter(Boolean).slice(0, 2);
    const isField = tag === "input" || tag === "textarea" || tag === "select";
    const label = isField
      ? (el.getAttribute("aria-label") || el.placeholder || el.name || el.type || "")
      : (el.getAttribute("aria-label") || el.innerText || el.textContent || "");
    return {
      tag,
      selector: tag + (el.id ? "#" + el.id : "") + cls.map((c) => "." + c).join(""),
      label: String(label).replace(/\\s+/g, " ").trim().slice(0, 60),
    };
  }

  function report(kind, el, extra) {
    try { window.${BINDING_NAME}(JSON.stringify({ kind, ...describe(el), ...extra })); } catch (e) {}
  }

  addEventListener("click", (e) => {
    const el = e.target && e.target.closest ? (e.target.closest(INTERACTIVE) || e.target) : e.target;
    if (el && el.tagName) report("click", el, { x: Math.round(e.clientX), y: Math.round(e.clientY) });
  }, true);

  addEventListener("submit", (e) => {
    if (e.target && e.target.tagName) report("submit", e.target, {});
  }, true);
})();`;

/** One human-readable timeline line for a reported action. */
export function describeAction(action) {
  const verb = action.kind === "submit" ? "submitted" : "clicked";
  const label = action.label ? ` "${action.label}"` : "";
  return `👆 User ${verb} ${action.selector || action.tag}${label}`;
}
