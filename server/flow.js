/**
 * flow.js — the "Explain flow to agent" hand-off.
 *
 * The editor sends one flowchart: its graph, Mermaid text, the user's explanation and a PNG.
 * We keep only the latest one under <store>/flow/ and give it to the agent through the
 * `get_latest_flow` MCP tool.
 *
 *   POST /flow     { graph, mermaid, explanation, pngBase64 }   (from the editor)
 *   GET  /flow     the stored flow without the image            (handy for checks)
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getStoreDir } from "./config.js";

const MAX_TEXT = 20000;
const dir = () => path.join(getStoreDir(), "flow");
const jsonPath = () => path.join(dir(), "latest.json");
const pngPath = () => path.join(dir(), "latest.png");

/** Checks and trims what the editor sent; throws a message fit for the user. */
export function cleanFlow(payload) {
  const g = payload?.graph;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw new Error("That doesn't look like a flowchart (no blocks or arrows).");
  const cut = (s) => String(s ?? "").slice(0, MAX_TEXT);
  return {
    exportedAt: new Date().toISOString(),
    explanation: cut(payload.explanation),
    mermaid: cut(payload.mermaid),
    graph: {
      nodes: g.nodes.slice(0, 500).map((n) => ({ id: cut(n.id).slice(0, 20), kind: cut(n.kind).slice(0, 20), label: cut(n.label).slice(0, 500) })),
      edges: g.edges.slice(0, 1000).map((e) => ({ from: cut(e.from).slice(0, 20), to: cut(e.to).slice(0, 20), label: cut(e.label).slice(0, 200) })),
      notes: (g.notes || []).slice(0, 100).map((n) => cut(n).slice(0, 500)),
      issues: (g.issues || []).slice(0, 100).map((n) => cut(n).slice(0, 300)),
    },
  };
}

/** Saves the flow (replacing the previous one). */
export function writeFlow(payload) {
  const flow = cleanFlow(payload);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(jsonPath(), JSON.stringify(flow, null, 2));
  if (payload.pngBase64) fs.writeFileSync(pngPath(), Buffer.from(String(payload.pngBase64), "base64"));
  else fs.rmSync(pngPath(), { force: true });
  return { nodes: flow.graph.nodes.length, edges: flow.graph.edges.length, issues: flow.graph.issues.length };
}

/** The saved flow, or null. */
export function readFlow() {
  try {
    const flow = JSON.parse(fs.readFileSync(jsonPath(), "utf8"));
    const png = fs.existsSync(pngPath()) ? fs.readFileSync(pngPath()).toString("base64") : null;
    return { flow, png };
  } catch { return null; }
}

/** What the agent reads first: the explanation, the Mermaid text, what looks unfinished. */
export function describeFlow(flow) {
  const out = [];
  out.push(flow.explanation ? `The user explains this flow:\n${flow.explanation}` : "The user didn't add an explanation; the diagram is the explanation.");
  out.push(`Flowchart (Mermaid):\n\`\`\`mermaid\n${flow.mermaid}\n\`\`\``);
  if (flow.graph.notes.length) out.push(`Notes written on the canvas:\n${flow.graph.notes.map((n) => `- ${n}`).join("\n")}`);
  if (flow.graph.issues.length) out.push(`Things that look unfinished (ask the user rather than guess):\n${flow.graph.issues.map((n) => `- ${n}`).join("\n")}`);
  out.push(`Block kinds: start / end = oval, step = rectangle, decision = diamond. Full structure:\n${JSON.stringify(flow.graph, null, 2)}`);
  return out.join("\n\n");
}

/** Registers the MCP tool. */
export function registerFlowTool(server) {
  server.tool(
    "get_latest_flow",
    "Returns the flowchart the user drew in Developer Companion and sent with 'Explain flow to agent': the user's " +
      "explanation, the flow as Mermaid text and as structured blocks/arrows, anything that looks unfinished, and a PNG. " +
      "Call it when the user asks you to implement, review or explain a flow, a user journey, a process or a state machine they drew.",
    {},
    async () => {
      const saved = readFlow();
      if (!saved) return { content: [{ type: "text", text: "No flow has been sent yet. The user can open the Flow panel in the Developer Companion editor, draw it and press 'Explain flow to agent'." }] };
      const content = [{ type: "text", text: describeFlow(saved.flow) }];
      if (saved.png) content.push({ type: "image", data: saved.png, mimeType: "image/png" });
      return { content };
    },
  );
}

/** HTTP side. Returns true when handled. */
export function handleFlow(req, res, pathname, { readJsonBody, respondJson }) {
  if (pathname !== "/flow") return false;
  if (req.method === "POST") {
    readJsonBody(req, res, (payload) => {
      try { respondJson(res, 200, { ok: true, ...writeFlow(payload) }); }
      catch (err) { respondJson(res, 400, { ok: false, error: err.message || String(err) }); }
    });
    return true;
  }
  if (req.method === "GET") { const saved = readFlow(); respondJson(res, 200, { ok: true, flow: saved?.flow || null }); return true; }
  return false;
}
