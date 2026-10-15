/**
 * flow-mermaid.js — writes a flow graph as Mermaid `flowchart TD` text.
 * Agents (and GitHub / most docs tools) read this format natively.
 */

const SHAPES = { start: ["([", "])"], end: ["([", "])"], decision: ["{", "}"], step: ["[", "]"] };

/** Mermaid labels sit inside quotes; swap the characters that would break them. */
const esc = (s) => String(s || "").replace(/"/g, "#quot;").replace(/[\r\n]+/g, " ");

/** @param {{nodes: object[], edges: object[]}} graph */
export function toMermaid(graph) {
  const lines = ["flowchart TD"];
  for (const n of graph.nodes) {
    const [open, close] = SHAPES[n.kind] || SHAPES.step;
    lines.push(`  ${n.id}${open}"${esc(n.label || n.id)}"${close}`);
  }
  for (const e of graph.edges) lines.push(`  ${e.from} -->${e.label ? `|"${esc(e.label)}"|` : ""} ${e.to}`);
  return lines.join("\n");
}
