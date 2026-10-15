/**
 * shape-label.js — draws a shape's own `text` centred inside it (used by flow blocks).
 * Long labels wrap on spaces and shrink a little rather than overflowing.
 */

import { getBounds, fontCss } from "../shapes.js";

const LABELLED = new Set(["rect", "ellipse", "polygon"]);

/** Splits `text` into lines no wider than `maxWidth` (measured with the context's current font). */
export function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Draws the label. Call with the shape's transform already applied. */
export function drawShapeLabel(ctx, shape) {
  if (!LABELLED.has(shape.type) || !shape.text) return;
  const { x, y, w, h } = getBounds(shape);
  const inset = shape.type === "polygon" ? 0.5 : shape.type === "ellipse" ? 0.72 : 0.9;   // usable share of the width
  const maxW = Math.max(20, w * inset - 8);
  let size = shape.fontSize || 16, lines;
  ctx.save();
  ctx.fillStyle = "#1b1c20"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  do { ctx.font = fontCss(size); lines = wrapLines(ctx, shape.text, maxW); size -= 1; }
  while (size > 9 && lines.length * (size + 1) * 1.25 > h - 8);
  const lineH = (size + 1) * 1.25, top = y + h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, top + i * lineH));
  ctx.restore();
}
