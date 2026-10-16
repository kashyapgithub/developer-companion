/**
 * flow-panel.js — the "Explain flow" panel.
 *
 *   [Start] [Step] [Decision] [End]   add a block (joined to the selected one, if any)
 *   [Arrow tool]                      drag from one block to another
 *   notes box                         explain the flow in your own words
 *   live check                        what the agent will see, and what still looks unfinished
 *   [Explain flow to agent]           sends the flowchart + notes + picture
 *
 * Double-click a block to rename it, an arrow to label it.
 */

import { FLOW_KINDS, FLOW_KIND_ORDER } from "./flow-kinds.js";
import { planBlock } from "./flow-place.js";
import { buildFlowGraph } from "./flow-graph.js";
import { toMermaid } from "./flow-mermaid.js";
import { sendFlow } from "./flow-api.js";
import { visibleShapes } from "../shapes.js";
import { wireFlowTools } from "./flow-tools-ui.js";

const NOTES_KEY = "dcFlowNotes";

const $ = (root, sel) => root.querySelector(sel);

/**
 * @param {{ buttonEl: HTMLElement, panelEl: HTMLElement, controller: object, engine: object, send?: Function }} opts
 * @returns {{ update(state): void, open(): void, close(): void }}
 */
export function wireFlowPanel({ buttonEl, panelEl, controller, engine, send = sendFlow }) {
  const els = {
    kinds: $(panelEl, "#flow-kinds"), arrow: $(panelEl, "#flow-arrow"), notes: $(panelEl, "#flow-notes"),
    issues: $(panelEl, "#flow-issues"), summary: $(panelEl, "#flow-summary"), code: $(panelEl, "#flow-mermaid"),
    send: $(panelEl, "#flow-send"), status: $(panelEl, "#flow-status"), close: $(panelEl, "#flow-close"),
  };
  let timer = null;

  // ---- building blocks ------------------------------------------------------------------
  for (const kind of FLOW_KIND_ORDER) {
    const b = document.createElement("button");
    b.type = "button"; b.className = `flow-kind flow-${kind}`; b.dataset.kind = kind; b.textContent = FLOW_KINDS[kind].label;
    b.title = `Add a ${FLOW_KINDS[kind].label} block${kind === "start" ? "" : " (joined to the selected block)"}`;
    b.addEventListener("click", () => addBlock(kind));
    els.kinds.append(b);
  }
  els.arrow.addEventListener("click", () => controller.setTool("connector"));

  /** Where the middle of the visible canvas is, in drawing coordinates. */
  function viewCenter() {
    const r = document.getElementById("board").getBoundingClientRect();
    return engine.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  function addBlock(kind) {
    const { shape, connector } = planBlock(kind, { shapes: controller.state.shapes, selection: controller.state.selection, viewCenter: viewCenter() });
    controller.addShape(shape);                       // selects the new block, so the next click chains from it
    if (connector) { controller.addShape(connector); controller.select([shape.id], { expand: false }); }
    keepInView(shape);
  }

  /** Pans the canvas when a new block lands under the panel or the tool dock. */
  function keepInView(shape) {
    const board = document.getElementById("board").getBoundingClientRect();
    const safeW = board.width - panelEl.offsetWidth - 20, safeH = board.height - 90;     // minus panel on the right, dock at the bottom
    const a = engine.toScreen(shape.x, shape.y), b = engine.toScreen(shape.x + shape.w, shape.y + shape.h);
    if (a.x >= 0 && a.y >= 0 && b.x <= safeW && b.y <= safeH) return;
    engine.panBy(safeW / 2 - (a.x + b.x) / 2, safeH / 2 - (a.y + b.y) / 2);
  }

  // ---- live check -------------------------------------------------------------------------
  /** What would be sent right now. */
  function snapshot() {
    const shapes = visibleShapes(controller.state.shapes);
    const graph = buildFlowGraph(shapes);
    return { shapes, graph, mermaid: toMermaid(graph) };
  }

  function refresh() {
    const { graph, mermaid } = snapshot();
    els.summary.textContent = graph.nodes.length ? `${graph.nodes.length} blocks · ${graph.edges.length} arrows` : "No blocks yet";
    els.issues.replaceChildren(...graph.issues.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
    els.code.textContent = graph.nodes.length ? mermaid : "";
    els.send.disabled = !graph.nodes.length;
  }

  // ---- sending ------------------------------------------------------------------------------
  async function sendNow() {
    const { shapes, graph, mermaid } = snapshot();
    els.send.disabled = true; setStatus("Sending…");
    try {
      const rendered = engine.renderExport(shapes);
      await send({ graph, mermaid, explanation: els.notes.value.trim(), pngBase64: rendered.canvas.toDataURL("image/png").split(",")[1] });
      setStatus(graph.issues.length ? `Sent. The agent was told about ${graph.issues.length} loose end(s).` : "Sent to your agent.", "ok");
    } catch (err) { setStatus(err.message || "Couldn't send the flow.", "err"); }
    finally { els.send.disabled = !buildFlowGraph(shapes).nodes.length; }
  }
  const setStatus = (text, cls = "") => { els.status.textContent = text; els.status.className = cls; };
  els.send.addEventListener("click", sendNow);
  wireFlowTools({ panelEl, controller, engine, say: (text, cls) => setStatus(text, cls) });

  // Your explanation survives closing the editor.
  chrome.storage?.local.get(NOTES_KEY).then((r) => { if (r?.[NOTES_KEY] && !els.notes.value) els.notes.value = r[NOTES_KEY]; }).catch(() => {});
  els.notes.addEventListener("input", () => chrome.storage?.local.set({ [NOTES_KEY]: els.notes.value }).catch(() => {}));

  // ---- open / close -------------------------------------------------------------------------
  const isOpen = () => !panelEl.classList.contains("hidden");
  function open() { panelEl.classList.remove("hidden"); buttonEl.setAttribute("aria-pressed", "true"); refresh(); }
  function close() { panelEl.classList.add("hidden"); buttonEl.setAttribute("aria-pressed", "false"); }
  buttonEl.addEventListener("click", () => (isOpen() ? close() : open()));
  els.close.addEventListener("click", close);

  return {
    /** Called on every drawing change; refreshes the check shortly after the last one. */
    update() { if (!isOpen()) return; clearTimeout(timer); timer = setTimeout(refresh, 150); },
    open, close,
  };
}
