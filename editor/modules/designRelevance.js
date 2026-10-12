/**
 * designRelevance.js — the Design panel only shows controls that mean
 * something for what is selected.
 *
 * A rectangle has no "points" and a text box has no "elbow connector", so
 * those rows disappear instead of sitting there doing nothing. With nothing
 * selected only the common controls (fill, stroke, opacity) remain.
 */

const BOX = ["rect", "frame", "section"];
const FILLED = [...BOX, "ellipse", "polygon", "star", "path"];

/** Which shape types each control applies to. Key = control element id. */
const APPLIES_TO = {
  "elbow-enabled": ["connector"],
  "corner-radius": BOX,
  "font-size": ["text"],
  rotation: [...BOX, "ellipse", "image", "text", "polygon", "star"],
  "shape-count": ["polygon", "star"],
  "shape-inner": ["star"],
  "gradient-enabled": FILLED,
};

/** The visible wrapper to hide for a control: its settings row, or its number cell. */
const wrapperOf = (el) => el.closest(".row, label.num");

/** Builds the updater once; call it with the selected shapes whenever the selection changes. */
export function createDesignRelevance(root = document) {
  const controls = Object.entries(APPLIES_TO)
    .map(([id, types]) => ({ wrap: wrapperOf(root.getElementById(id) || document.createElement("i")), types }))
    .filter((c) => c.wrap);
  const textSection = root.getElementById("font-size")?.closest(".sec");

  return function update(selection) {
    const selected = new Set(selection.map((s) => s.type));
    for (const { wrap, types } of controls) wrap.hidden = !types.some((t) => selected.has(t));
    // "Shape & text" is empty when none of its fields apply: hide the whole section.
    if (textSection) textSection.hidden = [...textSection.querySelectorAll("label.num")].every((l) => l.hidden);
  };
}
