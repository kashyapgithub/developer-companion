/** flow-mermaid-parse.test.mjs — Mermaid text -> graph -> layout -> shapes, and tidy-up of existing blocks. */
import { parseMermaid } from "../../editor/modules/flow/mermaid-parse.js";
import { toMermaid } from "../../editor/modules/flow/flow-mermaid.js";
import { layoutFlow } from "../../editor/modules/flow/flow-layout.js";
import { shapesFromGraph, tidyShapes } from "../../editor/modules/flow/flow-draw.js";
import { buildFlowGraph } from "../../editor/modules/flow/flow-graph.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const src = `%% a comment
flowchart LR
  A([Start]) --> B{"Valid?"}
  B -->|Yes| C[Save #quot;it#quot;]
  B -- No --> D(Show error)
  D -.-> B
  C --> E([Done]); style C fill:#f00
  subgraph x
  end`;
const g = parseMermaid(src);
t("direction is read", g.direction === "LR");
t("all five blocks are found", g.nodes.map((n) => n.id).join() === "A,B,C,D,E");
t("brackets decide the kind", g.nodes.map((n) => n.kind).join() === "start,decision,step,step,end", g.nodes.map((n) => n.kind).join());
t("quotes and entities are cleaned", g.nodes[1].label === "Valid?" && g.nodes[2].label === 'Save "it"');
t("both arrow-label styles work", g.edges.filter((e) => e.label).map((e) => e.label).join() === "Yes,No");
t("dotted arrows and loops are kept", g.edges.some((e) => e.from === "D" && e.to === "B"));
t("styling lines are skipped and reported", g.skipped.length >= 1 && g.skipped.some((l) => l.startsWith("style")));
t("chains make several arrows", parseMermaid("A --> B --> C").edges.length === 2);
t("a node used before it is described keeps its later label", parseMermaid("A --> B\nB[Later]").nodes[1].label === "Later");
t("garbage does not throw", parseMermaid("???").nodes.length === 0 && parseMermaid("").nodes.length === 0);

// Round trip with our own writer.
const again = parseMermaid(toMermaid({ nodes: [{ id: "n1", kind: "start", label: "Go" }, { id: "n2", kind: "decision", label: 'Is "it" ok?' }, { id: "n3", kind: "end", label: "Stop" }], edges: [{ from: "n1", to: "n2", label: "" }, { from: "n2", to: "n3", label: "Yes" }] }));
t("our own Mermaid reads back", again.nodes.map((n) => n.kind).join() === "start,decision,end" && again.nodes[1].label === 'Is "it" ok?' && again.edges[1].label === "Yes");

// Layout.
const pos = layoutFlow(g, { direction: "TD" });
t("layers go downward", pos.get("A").y < pos.get("B").y && pos.get("B").y < pos.get("C").y);
t("branches sit side by side", pos.get("C").y === pos.get("D").y && pos.get("C").x !== pos.get("D").x);
t("a loop does not push blocks around", pos.get("D").y > pos.get("B").y);
const lr = layoutFlow(g, { direction: "LR" });
t("left-to-right layout advances in x", lr.get("A").x < lr.get("B").x);
t("a pure cycle still lays out", layoutFlow({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] }).size === 2);

// Shapes + tidy.
const shapes = shapesFromGraph(g, { cx: 0, cy: 0, direction: "LR" });
t("a block and an arrow per node and edge", shapes.filter((s) => s.flowKind).length === 5 && shapes.filter((s) => s.type === "connector").length === 5);
const messy = shapes.filter((s) => s.flowKind); messy.forEach((s, i) => { s.x = (i * 37) % 90; s.y = (i * 53) % 70; });
const graph = buildFlowGraph(shapes);
t("tidy moves every block", tidyShapes(graph, shapes) === 5);
const boxes = shapes.filter((s) => s.flowKind);
t("tidy leaves no overlaps", boxes.every((a, i) => boxes.every((b, j) => i === j || a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)));
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
