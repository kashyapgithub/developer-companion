/**
 * flow-graph.js — reads a drawing as a flowchart. Pure (no DOM), so it is easy to test.
 *
 *   buildFlowGraph(shapes) -> { nodes, edges, notes, issues }
 *
 * - nodes: rectangles, ovals and diamonds, numbered n1, n2… in reading order (top→bottom, left→right)
 * - label: the shape's own text, plus any text shape lying inside it
 * - kind:  the block's `flowKind`, or guessed from the geometry (diamond = decision, oval = start/end)
 * - edges: connectors between two nodes, with their label ("Yes", "No"…)
 * - notes: free text lying outside every node (the user's annotations)
 * - issues: things that look unfinished, so the agent can ask instead of guessing
 */

import { getWorldBounds } from "../shapes.js";

const NODE_TYPES = new Set(["rect", "ellipse", "polygon"]);

const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** Reading order: rows of similar height first, then left to right. */
function readingOrder(a, b) {
  return Math.abs(a.cy - b.cy) > 30 ? a.cy - b.cy : a.cx - b.cx;
}

/** Guesses what a block is when it has no `flowKind` tag. */
function inferKind(shape, hasIn, hasOut) {
  if (shape.flowKind) return shape.flowKind;
  if (shape.type === "polygon" && Math.round(shape.count) === 4) return "decision";
  if (shape.type === "ellipse") return !hasIn ? "start" : !hasOut ? "end" : "step";
  return "step";
}

/** @param {object[]} shapes visible shapes of the drawing */
export function buildFlowGraph(shapes) {
  const candidates = shapes.filter((s) => NODE_TYPES.has(s.type) && !s.hidden).map((s) => {
    const b = getWorldBounds(s), c = centre(b);
    return { shape: s, bounds: b, cx: c.x, cy: c.y };
  }).sort(readingOrder);
  candidates.forEach((n, i) => { n.id = `n${i + 1}`; });
  const byShapeId = new Map(candidates.map((n) => [n.shape.id, n]));

  // Text lying inside a node becomes part of its label; text outside every node is a note.
  const labels = new Map(candidates.map((n) => [n.id, [clean(n.shape.text)].filter(Boolean)]));
  const notes = [];
  for (const t of shapes.filter((s) => s.type === "text" && clean(s.text))) {
    const b = getWorldBounds(t);
    const host = [...candidates].reverse().find((n) => inside(n.bounds, centre(b)));       // smallest/topmost wins
    if (host) labels.get(host.id).push(clean(t.text)); else notes.push(clean(t.text));
  }

  const edges = shapes.filter((s) => s.type === "connector").flatMap((c) => {
    const from = byShapeId.get(c.fromId), to = byShapeId.get(c.toId);
    return from && to ? [{ from: from.id, to: to.id, label: clean(c.label) }] : [];
  });
  const incoming = (id) => edges.filter((e) => e.to === id), outgoing = (id) => edges.filter((e) => e.from === id);

  const nodes = candidates.map((n) => ({
    id: n.id, kind: inferKind(n.shape, incoming(n.id).length > 0, outgoing(n.id).length > 0),
    label: labels.get(n.id).join(" — "), shapeId: n.shape.id,
  }));
  return { nodes, edges, notes, issues: findIssues(nodes, edges, incoming, outgoing) };
}

/** Things that look unfinished or ambiguous. */
function findIssues(nodes, edges, incoming, outgoing) {
  const issues = [];
  const name = (n) => (n.label ? `"${n.label}"` : `${n.id} (no label)`);
  if (!nodes.length) return ["There are no blocks yet. Add Start, Step, Decision and End blocks, then connect them."];
  for (const n of nodes) {
    if (!n.label) issues.push(`${n.id} has no label.`);
    if (!incoming(n.id).length && !outgoing(n.id).length) issues.push(`${name(n)} isn't connected to anything.`);
    if (n.kind === "decision") {
      const out = outgoing(n.id);
      if (out.length < 2) issues.push(`Decision ${name(n)} has ${out.length} exit(s); a decision needs at least 2.`);
      else if (out.some((e) => !e.label)) issues.push(`Decision ${name(n)} has exits without a label (like Yes / No).`);
    }
    if (n.kind === "end" && outgoing(n.id).length) issues.push(`End ${name(n)} has an arrow leaving it.`);
    if (n.kind !== "end" && n.kind !== "decision" && incoming(n.id).length && !outgoing(n.id).length) issues.push(`${name(n)} is a dead end (nothing follows it) but isn't marked End.`);
  }
  const starts = nodes.filter((n) => n.kind === "start");
  if (!starts.length && !nodes.some((n) => !incoming(n.id).length && outgoing(n.id).length)) issues.push("There is no clear starting point.");
  if (starts.length > 1) issues.push(`There are ${starts.length} Start blocks; is that intended?`);
  return issues;
}
