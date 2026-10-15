/**
 * flow-place.js — where a new flow block goes, and the arrow that joins it to the previous one.
 *
 * Select a block, press "Step" (or any kind): the new block appears next to it and is already
 * connected. Out of a decision the exits are pre-labelled Yes, then No.
 */

import { makeFlowShape } from "./flow-kinds.js";
import { getWorldBounds, createShape } from "../shapes.js";

const GAP = 70;                                  // empty space between two blocks
const NODE_TYPES = new Set(["rect", "ellipse", "polygon"]);

/** Exit slots, in the order they are used: below, then right, then left. */
const SLOTS = [(b, w, h) => ({ x: b.x + b.w / 2, y: b.y + b.h + GAP + h / 2 }),
               (b, w, h) => ({ x: b.x + b.w + GAP + w / 2, y: b.y + b.h / 2 }),
               (b, w, h) => ({ x: b.x - GAP - w / 2, y: b.y + b.h / 2 })];

/** The one selected block, if exactly one block is selected. */
export function selectedBlock(selection) {
  return selection.length === 1 && NODE_TYPES.has(selection[0].type) ? selection[0] : null;
}

/**
 * @param {string} kind start | step | decision | end
 * @param {{ shapes: object[], selection: object[], viewCenter: {x:number,y:number} }} ctx
 * @returns {{ shape: object, connector: object|null }} what to add to the drawing
 */
export function planBlock(kind, { shapes, selection, viewCenter }) {
  const from = selectedBlock(selection);
  if (!from) return { shape: makeFlowShape(kind, viewCenter.x, viewCenter.y), connector: null };

  const used = shapes.filter((s) => s.type === "connector" && s.fromId === from.id).length;
  const probe = makeFlowShape(kind, 0, 0);
  const at = SLOTS[used % SLOTS.length](getWorldBounds(from), probe.w, probe.h);
  const shape = makeFlowShape(kind, at.x, at.y);
  const label = from.flowKind === "decision" ? ["Yes", "No"][used] || "" : "";
  const connector = createShape("connector", { fromId: from.id, toId: shape.id, label, route: used === 0 ? "straight" : "elbow", stroke: "#1b1c20", strokeWidth: 2 });
  return { shape, connector };
}
