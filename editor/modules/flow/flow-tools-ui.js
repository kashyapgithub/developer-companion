/**
 * flow-tools-ui.js — the panel's "Tidy up", "Draw from Mermaid" and "Copy Mermaid" controls.
 *
 *   Tidy up           re-lays the blocks you drew into clean rows, loops and all
 *   Draw from Mermaid paste a flow (your agent can write one) and it appears on the canvas
 *   Copy Mermaid      the current flow as text, for docs or a chat
 */

import { parseMermaid } from "./mermaid-parse.js";
import { shapesFromGraph, tidyShapes } from "./flow-draw.js";
import { buildFlowGraph } from "./flow-graph.js";
import { toMermaid } from "./flow-mermaid.js";
import { visibleShapes } from "../shapes.js";

const $ = (root, sel) => root.querySelector(sel);

/**
 * @param {{ panelEl: HTMLElement, controller: object, engine: object, say: (text: string, cls?: string) => void }} opts
 */
export function wireFlowTools({ panelEl, controller, engine, say }) {
  const input = $(panelEl, "#flow-paste");

  /** Fits the blocks into the part of the canvas the panel isn't covering. */
  function fitBeside(shapes) {
    engine.fit(shapes.filter((s) => s.type !== "connector"));
    const board = document.getElementById("board").getBoundingClientRect();
    const covered = panelEl.offsetWidth + 20, factor = Math.min(1, (board.width - covered) / board.width);
    engine.zoomAt(board.width / 2, board.height / 2, factor);
    engine.panBy(-covered / 2, 0);
  }

  /** Centre of what is visible, in drawing coordinates. */
  const viewCenter = () => {
    const r = document.getElementById("board").getBoundingClientRect();
    return engine.toWorld(r.left + (r.width - panelEl.offsetWidth) / 2, r.top + r.height / 2);
  };

  $(panelEl, "#flow-draw").addEventListener("click", () => {
    const graph = parseMermaid(input.value);
    if (!graph.nodes.length) return say("Nothing to draw. Paste a Mermaid flowchart, for example: flowchart TD, A([Start]) --> B[Step].", "err");
    const c = viewCenter();
    const horizontal = graph.direction === "LR" || graph.direction === "RL";
    const fresh = shapesFromGraph(graph, { cx: c.x, cy: c.y, direction: graph.direction });
    controller.loadShapes([...controller.state.shapes, ...fresh]);        // one undo step for the whole flow
    controller.select(fresh.map((s) => s.id), { expand: false });
    fitBeside(fresh);
    say(`Drew ${graph.nodes.length} blocks and ${graph.edges.length} arrows${horizontal ? " (left to right)" : ""}.${graph.skipped.length ? ` Skipped ${graph.skipped.length} line(s) it doesn't understand.` : ""}`, "ok");
  });

  $(panelEl, "#flow-tidy").addEventListener("click", () => {
    const shapes = visibleShapes(controller.state.shapes);
    const moved = tidyShapes(buildFlowGraph(shapes), controller.state.shapes);
    if (!moved) return say("Add some blocks first.", "err");
    controller.loadShapes(controller.state.shapes);                          // commits one undo step
    fitBeside(controller.state.shapes);
    say(`Tidied ${moved} blocks.`, "ok");
  });

  $(panelEl, "#flow-copy").addEventListener("click", async () => {
    const graph = buildFlowGraph(visibleShapes(controller.state.shapes));
    if (!graph.nodes.length) return say("Nothing to copy yet.", "err");
    try { await navigator.clipboard.writeText(toMermaid(graph)); say("Mermaid copied.", "ok"); }
    catch { say("Chrome blocked the clipboard. Open “What the agent reads” and copy from there.", "err"); }
  });
}
