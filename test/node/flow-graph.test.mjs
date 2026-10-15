/** flow-graph.test.mjs — drawing -> flowchart graph, issues and Mermaid; and where new blocks are placed. */
import { buildFlowGraph } from "../../editor/modules/flow/flow-graph.js";
import { toMermaid } from "../../editor/modules/flow/flow-mermaid.js";
import { makeFlowShape } from "../../editor/modules/flow/flow-kinds.js";
import { planBlock } from "../../editor/modules/flow/flow-place.js";
import { createShape } from "../../editor/modules/shapes.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const conn = (a, b, label = "") => createShape("connector", { fromId: a.id, toId: b.id, label });
const at = (kind, x, y, text) => { const s = makeFlowShape(kind, x, y, text); return s; };

const start = at("start", 300, 50, "Sign up"), check = at("decision", 300, 200, "Code correct?");
const ok = at("step", 150, 380, "Create account"), bad = at("step", 450, 380, "Show error"), end = at("end", 150, 520, "Done");
const shapes = [end, bad, ok, check, start, conn(start, check), conn(check, ok, "Yes"), conn(check, bad, "No"), conn(ok, end), conn(bad, check, "retry"),
  createShape("text", { x: 20, y: 20, text: "Lock after 3 tries", w: 100, h: 20 })];
let g = buildFlowGraph(shapes);

t("blocks are numbered in reading order", g.nodes.map((n) => n.label).join("|") === "Sign up|Code correct?|Create account|Show error|Done", g.nodes.map((n) => n.label).join("|"));
t("kinds come from the blocks", g.nodes.map((n) => n.kind).join() === "start,decision,step,step,end");
t("arrows keep their labels", g.edges.filter((e) => e.label).map((e) => e.label).join() === "Yes,No,retry");
t("loose text becomes a note", g.notes.join() === "Lock after 3 tries");
t("a finished flow has no issues", g.issues.length === 0, g.issues.join("; "));

const m = toMermaid(g);
t("mermaid starts as a top-down flowchart", m.startsWith("flowchart TD"));
t("decision uses braces, start uses an oval", m.includes('n2{"Code correct?"}') && m.includes('n1(["Sign up"])'));
t("labelled arrows are written", m.includes('n2 -->|"Yes"| n3'));
t("quotes in labels are escaped", toMermaid({ nodes: [{ id: "n1", kind: "step", label: 'say "hi"' }], edges: [] }).includes("#quot;"));

// Problems are reported, not hidden.
const lone = at("step", 700, 50); lone.text = "";
const sloppy = [start, check, lone, conn(start, check), conn(check, ok)];
g = buildFlowGraph([...sloppy, ok]);
t("a decision with one exit is flagged", g.issues.some((i) => /needs at least 2/.test(i)));
t("an unlabeled, unconnected block is flagged", g.issues.some((i) => /no label/.test(i)) && g.issues.some((i) => /isn't connected/.test(i)));
t("a dead end that isn't End is flagged", g.issues.some((i) => /dead end/.test(i)));
t("an empty drawing explains what to do", buildFlowGraph([]).issues[0].includes("no blocks"));

// Hand-drawn shapes (no flowKind) are understood too.
const d = createShape("polygon", { x: 0, y: 100, w: 100, h: 80, count: 4, text: "ok?" }), a = createShape("rect", { x: 0, y: 0, w: 100, h: 40, text: "go" });
g = buildFlowGraph([a, d, conn(a, d)]);
t("a hand-drawn diamond is a decision", g.nodes.find((n) => n.label === "ok?").kind === "decision");

// Placement: chained from the selected block.
const first = at("start", 0, 0, "A");
const plan = planBlock("step", { shapes: [first], selection: [first], viewCenter: { x: 500, y: 500 } });
t("a new block goes below the selected one", plan.shape.y > first.y + first.h && Math.abs(plan.shape.x + plan.shape.w / 2) < 1);
t("and is joined to it", plan.connector.fromId === first.id && plan.connector.toId === plan.shape.id);
t("with nothing selected it lands in view", planBlock("step", { shapes: [], selection: [], viewCenter: { x: 500, y: 500 } }).connector === null);
const dec = at("decision", 0, 0, "Q?"); const used = [conn(dec, first)];
const p2 = planBlock("step", { shapes: used, selection: [dec], viewCenter: { x: 0, y: 0 } });
t("a decision's first exit is Yes, second No", planBlock("step", { shapes: [], selection: [dec], viewCenter: { x: 0, y: 0 } }).connector.label === "Yes" && p2.connector.label === "No");
t("the second exit goes to the side", p2.shape.x > dec.x + dec.w);
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
