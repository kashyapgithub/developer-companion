/**
 * annotate-draw.js — paints strokes onto a canvas 2D context at any size.
 *
 * Used twice: live on the overlay while the user draws, and once onto the full frame
 * when the moment is saved. Line width scales with the canvas so both look the same.
 */

import { arrowHead } from "./annotate-model.js";

const WIDTH_FRACTION = 0.004;    // line width as a fraction of the canvas width
const MIN_WIDTH = 2;

/** Draws every stroke. The ctx's canvas size decides the scale. */
export function drawStrokes(ctx, strokes) {
  const { width, height } = ctx.canvas;
  const px = (p) => ({ x: p.x * width, y: p.y * height });
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(MIN_WIDTH, width * WIDTH_FRACTION);
  for (const s of strokes) {
    ctx.strokeStyle = ctx.fillStyle = s.color;
    const pts = s.points.map(px);
    const a = pts[0], b = pts[pts.length - 1];
    ctx.beginPath();
    if (s.tool === "box") ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    else if (s.tool === "arrow") {
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      const [h1, h2] = arrowHead(a, b, Math.max(12, width * 0.02));
      ctx.moveTo(b.x, b.y); ctx.lineTo(h1.x, h1.y); ctx.moveTo(b.x, b.y); ctx.lineTo(h2.x, h2.y);
    } else { pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); }
    ctx.stroke();
  }
  ctx.restore();
}

/** Loads a data URL into an Image. */
const loadImage = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

/** The frame with the strokes burned in, as a JPEG data URL (same quality as a plain frame). */
export async function flattenFrame(frameDataUrl, strokes, quality = 0.85) {
  if (!strokes.length) return frameDataUrl;
  const img = await loadImage(frameDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  drawStrokes(ctx, strokes);
  return canvas.toDataURL("image/jpeg", quality);
}
