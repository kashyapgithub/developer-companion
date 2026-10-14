/**
 * annotate-overlay.js — a drawing layer on top of the paused frame.
 *
 * createAnnotator(img, canvas, toolbar) wires pointer drawing (arrow / box / pen),
 * colour, undo and clear. It never touches the frame itself: strokes stay as data
 * until flatten() burns them into a copy at save time.
 */

import { createStrokeList, toNormalised, describeStrokes } from "./annotate-model.js";
import { drawStrokes, flattenFrame } from "./annotate-draw.js";

/**
 * @param {HTMLImageElement} img     the paused frame
 * @param {HTMLCanvasElement} canvas overlay sitting exactly over the image
 * @param {{ tool: () => string, color: () => string }} getters current tool + colour from the UI
 */
export function createAnnotator(img, canvas, getters) {
  const list = createStrokeList();
  let draft = null;                                   // stroke being drawn right now

  /** Matches the overlay's pixel size to how big the frame is shown. */
  function fit() {
    const r = img.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width)); canvas.height = Math.max(1, Math.round(r.height));
    repaint();
  }

  function repaint() {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStrokes(ctx, draft ? [...list.strokes, draft] : list.strokes);
  }

  const point = (e) => toNormalised(e.clientX, e.clientY, canvas.getBoundingClientRect());

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    const p = point(e);
    draft = { tool: getters.tool(), color: getters.color(), points: [p, p] };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!draft) return;
    const p = point(e);
    if (draft.tool === "pen") draft.points.push(p); else draft.points[1] = p;
    repaint();
  });
  const finish = () => { if (!draft) return; list.add(draft); draft = null; repaint(); };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", () => { draft = null; repaint(); });

  return {
    fit,
    undo() { list.undo(); repaint(); },
    clear() { list.clear(); repaint(); },
    get count() { return list.count; },
    get strokes() { return list.strokes; },
    /** "2 arrows, 1 box" or "" — handy as a note for the agent. */
    describe: () => describeStrokes(list.strokes),
    /** The frame with annotations burned in (the plain frame if nothing was drawn). */
    flatten: (frameDataUrl) => flattenFrame(frameDataUrl, list.strokes),
  };
}
