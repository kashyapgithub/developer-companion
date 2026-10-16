/**
 * flow-draw.js — turns a flow graph into shapes: new blocks and arrows from Mermaid, or a
 * tidy-up of blocks that are already on the canvas.
 */

import { makeFlowShape } from "./flow-kinds.js";
import { layoutFlow } from "./flow-layout.js";
import { createShape, getWorldBounds } from "../shapes.js";

/**
 * Shapes for a parsed Mermaid flow, laid out around (cx, cy).
 * @returns {object[]} blocks first, then arrows
 */
export function shapesFromGraph(graph, { cx = 0, cy = 0, direction = "TD" } = {}) {
  const spots = layoutFlow(graph, { direction });
  const byId = new Map();
  const blocks = graph.nodes.map((n) => {
    const p = spots.get(n.id);
    const shape = makeFlowShape(n.kind, cx + p.x, cy + p.y, n.label);
    byId.set(n.id, shape);
    return shape;
  });
  const arrows = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => createShape("connector", {
    fromId: byId.get(e.from).id, toId: byId.get(e.to).id, label: e.label, route: isReturnArrow(e, graph) ? "elbow" : "straight", stroke: "#1b1c20", strokeWidth: 2,
  }));
  return [...blocks, ...arrows];
}

/** An arrow that goes back to a block that already points at its source (a retry loop): drawn with a bend so the pair doesn't overlap. */
function isReturnArrow(e, graph) {
  const order = (id) => graph.nodes.findIndex((n) => n.id === id);
  return graph.edges.some((o) => o.from === e.to && o.to === e.from) && order(e.from) > order(e.to);
}

/**
 * Moves the blocks of a drawn flow into the tidy layout (keeping the middle where it was).
 * @param {object} graph from buildFlowGraph (nodes carry shapeId)
 * @param {object[]} shapes the drawing's shapes (mutated)
 * @returns {number} how many blocks moved
 */
export function tidyShapes(graph, shapes, direction = "TD") {
  const spots = layoutFlow(graph, { direction });
  const blocks = graph.nodes.map((n) => ({ n, shape: shapes.find((s) => s.id === n.shapeId) })).filter((b) => b.shape);
  if (!blocks.length) return 0;
  const boxes = blocks.map((b) => getWorldBounds(b.shape));
  const mid = { x: avg(boxes.map((b) => b.x + b.w / 2)), y: avg(boxes.map((b) => b.y + b.h / 2)) };
  for (const { n, shape } of blocks) {
    const p = spots.get(n.id);
    shape.x = Math.round(mid.x + p.x - shape.w / 2); shape.y = Math.round(mid.y + p.y - shape.h / 2); shape.rotation = 0;
  }
  return blocks.length;
}
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
