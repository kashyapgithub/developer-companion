/**
 * annotate-model.js — the data and geometry behind frame annotations. Pure (no DOM).
 *
 * Coordinates are NORMALISED (0..1 of the frame's width/height), so the drawing
 * lines up whether it is shown small in the window or flattened onto the full frame.
 * A stroke is { tool: "arrow"|"box"|"pen", color, points: [{x,y}, ...] }.
 */

export const TOOLS = ["arrow", "box", "pen"];
const MIN_SIZE = 0.01;          // ignore accidental clicks (1% of the frame)
const MAX_PEN_POINTS = 600;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** Pointer position inside an element's box -> normalised point. */
export function toNormalised(clientX, clientY, rect) {
  return { x: clamp01((clientX - rect.left) / rect.width), y: clamp01((clientY - rect.top) / rect.height) };
}

/** The undo-able list of strokes for one frame. */
export function createStrokeList() {
  const strokes = [];
  return {
    get strokes() { return strokes; },
    /** Adds a finished stroke unless it is too small to be intentional. */
    add(stroke) {
      if (!isMeaningful(stroke)) return false;
      strokes.push({ ...stroke, points: stroke.points.slice(0, MAX_PEN_POINTS) });
      return true;
    },
    undo() { return strokes.pop() || null; },
    clear() { strokes.length = 0; },
    get count() { return strokes.length; },
  };
}

/** Is a stroke big enough to keep? */
export function isMeaningful(stroke) {
  const pts = stroke?.points || [];
  if (pts.length < 2) return false;
  const first = pts[0], last = pts[pts.length - 1];
  if (stroke.tool === "pen") return pts.length >= 3;
  return Math.hypot(last.x - first.x, last.y - first.y) >= MIN_SIZE;
}

/** Two points of an arrow's head, for a shaft from `from` to `to` (in pixels). */
export function arrowHead(from, to, size = 14) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [angle + Math.PI - spread, angle + Math.PI + spread].map((a) => ({ x: to.x + size * Math.cos(a), y: to.y + size * Math.sin(a) }));
}

/** Short plain-language description of what was drawn, for the agent ("2 arrows, 1 box"). */
export function describeStrokes(strokes) {
  const names = { arrow: "arrow", box: "box", pen: "freehand mark" };
  const counts = {};
  for (const s of strokes) counts[s.tool] = (counts[s.tool] || 0) + 1;
  return Object.entries(counts).map(([tool, n]) => `${n} ${names[tool]}${n === 1 ? "" : "s"}`).join(", ");
}
