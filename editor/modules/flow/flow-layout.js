/**
 * flow-layout.js — tidy layered layout for a flow graph (pure).
 *
 * Each block goes one layer after its furthest parent; loops (arrows that point back) are ignored
 * when layering so they can't tangle things. Layers run top→bottom (TD) or left→right (LR) and
 * each layer is centred on the others.
 *
 *   layoutFlow(graph, { direction, gapX, gapY }) -> Map(nodeId -> { x, y })   (block centres)
 */

/** Marks arrows that close a loop (found by depth-first search), so layering can skip them. */
function backEdges(nodes, edges) {
  const state = new Map(), back = new Set();
  const out = (id) => edges.filter((e) => e.from === id);
  const visit = (id) => {
    state.set(id, 1);
    for (const e of out(id)) {
      if (state.get(e.to) === 1) back.add(e);
      else if (!state.has(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  const hasIn = new Set(edges.map((e) => e.to));
  for (const n of nodes.filter((n) => !hasIn.has(n.id))) if (!state.has(n.id)) visit(n.id);
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);             // cycles with no entry point
  return back;
}

export function layoutFlow(graph, { direction = "TD", gapX = 230, gapY = 150 } = {}) {
  const { nodes, edges } = graph;
  const back = backEdges(nodes, edges);
  const forward = edges.filter((e) => !back.has(e));
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {                    // longest path; at most n passes on a DAG
    let changed = false;
    for (const e of forward) if (depth.get(e.to) < depth.get(e.from) + 1) { depth.set(e.to, depth.get(e.from) + 1); changed = true; }
    if (!changed) break;
  }
  const layers = new Map();
  for (const n of nodes) { const d = depth.get(n.id); if (!layers.has(d)) layers.set(d, []); layers.get(d).push(n.id); }

  const horizontal = direction === "LR" || direction === "RL", flip = direction === "BT" || direction === "RL";
  const at = new Map();
  const layerCount = layers.size;
  for (const [d, ids] of layers) {
    const along = (flip ? layerCount - 1 - d : d) * (horizontal ? gapX : gapY);
    ids.forEach((id, i) => {
      const across = (i - (ids.length - 1) / 2) * (horizontal ? gapY : gapX);
      at.set(id, horizontal ? { x: along, y: across } : { x: across, y: along });
    });
  }
  return at;
}
