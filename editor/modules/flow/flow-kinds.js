/**
 * flow-kinds.js — the four building blocks of a flowchart and how each one is drawn.
 *
 *   start / end   rounded oval     where the flow begins / finishes
 *   step          rectangle        something happens
 *   decision      diamond          a question with two or more labelled exits
 *
 * A block is an ordinary shape (so move / resize / style / layers all work) with a `flowKind`
 * tag and its label in `text`. Hand-drawn shapes without the tag are still understood
 * (see inferKind in flow-graph.js).
 */

import { createShape } from "../shapes.js";

export const FLOW_KINDS = {
  start: { label: "Start", type: "ellipse", w: 140, h: 56, fill: "#e3f6ea", stroke: "#2f8f56" },
  step: { label: "Step", type: "rect", w: 170, h: 64, fill: "#eef2ff", stroke: "#3a5bd9", cornerRadius: 8 },
  decision: { label: "Decision", type: "polygon", w: 170, h: 110, fill: "#fff4dc", stroke: "#c78a00", count: 4 },
  end: { label: "End", type: "ellipse", w: 140, h: 56, fill: "#fde8e6", stroke: "#c8372d" },
};

/** The kinds in the order they are offered in the panel. */
export const FLOW_KIND_ORDER = ["start", "step", "decision", "end"];

/** A new block centred on (cx, cy). */
export function makeFlowShape(kind, cx, cy, text = "") {
  const k = FLOW_KINDS[kind];
  if (!k) throw new Error(`Unknown flow block: ${kind}`);
  return createShape(k.type, {
    x: Math.round(cx - k.w / 2), y: Math.round(cy - k.h / 2), w: k.w, h: k.h,
    fill: k.fill, stroke: k.stroke, strokeWidth: 2, cornerRadius: k.cornerRadius || 0, count: k.count || 5,
    text: text || k.label, fontSize: 16, flowKind: kind,
  });
}
