/**
 * mermaid-parse.js — reads the common subset of Mermaid flowcharts, so a flow written by your
 * agent (or pasted from docs) can be drawn on the canvas.
 *
 *   flowchart TD            direction line (TD / TB / LR / RL / BT)
 *   A([Start]) --> B[Step]  nodes:  [step]  ([oval])  ((circle))  {decision}  (rounded)  {{hexagon}}
 *   B --> C{OK?}            arrows: -->  ---  -.->  ==>   with text  -->|yes|  or  -- yes -->
 *   A --> B --> C           chains
 *
 * Not supported (skipped, and reported): subgraphs, styling, click handlers, `&` groups.
 * Returns { nodes:[{id,kind,label}], edges:[{from,to,label}], direction, skipped:[line…] }.
 */

const NODE = /^([A-Za-z_][\w]*)(?:\(\[(.*?)\]\)|\(\((.*?)\)\)|\{\{(.*?)\}\}|\[(.*?)\]|\((.*?)\)|\{(.*?)\})?/;
const EDGE = /^\s*(?:(-->|---|-\.->|==>|-\.-|===)(?:\|(.*?)\|)?|--\s*([^->]+?)\s*(?:-->|---)|-\.\s*([^.]+?)\s*\.->|==\s*([^=]+?)\s*==>)/;
const IGNORED = /^(flowchart|graph|subgraph|end|style|classDef|class|linkStyle|click|direction|%%)\b/i;

/** Label text: quotes and Mermaid's entities removed. */
const tidy = (s) => String(s ?? "").trim().replace(/^"(.*)"$/s, "$1").replace(/\u0001/g, '"').replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();

/** Which block kind a node's brackets mean (ovals are settled after the arrows are known). */
function shapeOf(m) {
  if (m[2] !== undefined || m[3] !== undefined) return "oval";
  if (m[7] !== undefined) return "decision";
  return "step";                                     // [..]  (..)  {{..}}
}

/** @param {string} text */
export function parseMermaid(text) {
  const nodes = new Map(), edges = [], skipped = [];
  let direction = "TD";
  const touch = (m) => {
    const id = m[1], label = tidy(m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7]);
    const known = nodes.get(id);
    if (!known) nodes.set(id, { id, kind: m[0].length > id.length ? shapeOf(m) : "step", label: label || id, hasShape: m[0].length > id.length });
    else if (m[0].length > id.length) Object.assign(known, { kind: shapeOf(m), label: label || known.label, hasShape: true });
    return id;
  };

  for (const raw of String(text || "").replace(/#quot;/g, "\u0001").replace(/%%.*$/gm, "").split(/\r?\n|;/)) {
    let line = raw.trim();
    if (!line) continue;
    const head = line.match(/^(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\b/i);
    if (head) { direction = head[1].toUpperCase(); continue; }
    if (IGNORED.test(line)) { if (!/^(end|flowchart|graph)\b/i.test(line)) skipped.push(raw.trim()); continue; }

    let m = line.match(NODE);
    if (!m) { skipped.push(raw.trim()); continue; }
    let prev = touch(m); line = line.slice(m[0].length);
    for (;;) {
      const e = line.match(EDGE);
      if (!e) break;
      line = line.slice(e[0].length);
      const next = line.trimStart().match(NODE);
      if (!next) break;
      line = line.trimStart().slice(next[0].length);
      const to = touch(next);
      edges.push({ from: prev, to, label: tidy(e[2] ?? e[3] ?? e[4] ?? e[5]) });
      prev = to;
    }
    if (line.trim() && !/^[&:]/.test(line.trim())) skipped.push(raw.trim());
  }

  // Ovals: nothing leads in = Start, nothing leads out = End, otherwise a plain step.
  for (const n of nodes.values()) {
    if (n.kind !== "oval") continue;
    const hasIn = edges.some((e) => e.to === n.id), hasOut = edges.some((e) => e.from === n.id);
    n.kind = !hasIn ? "start" : !hasOut ? "end" : "step";
  }
  return { nodes: [...nodes.values()].map(({ hasShape, ...n }) => n), edges, direction, skipped };
}
