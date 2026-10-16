/**
 * curve-model.js — what a curve is, and the maths to simplify, smooth and measure it.
 *
 *   curve = { id, label, target, notes, color, points:[{x,y,z}], durationMs, easing, loop, visible }
 *
 * `points` are the control points the user drew (few, after simplifying). The smooth line you see
 * and the animation keyframes are both sampled from the same Catmull-Rom spline through them.
 */

import { v3, sub, add, scale, dot, len, dist, lerp, clone } from "./vec3.js";

/** Eight colours that stay apart from each other and read on a dark canvas. */
export const PALETTE = ["#ff6b5e", "#ffb340", "#5fd08a", "#4f9bff", "#b58cff", "#ff6fb5", "#2ec4d6", "#c9d34a"];
export const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];

let counter = 0;
const newId = () => `c${Date.now().toString(36)}${(counter += 1)}`;

/** A new curve; colour and label default to the next free ones. */
export function createCurve(existing, overrides = {}) {
  const used = new Set(existing.map((c) => c.color));
  const index = existing.length + 1;
  return {
    id: newId(), label: `Curve ${index}`, target: "", notes: "", color: PALETTE.find((c) => !used.has(c)) || PALETTE[index % PALETTE.length],
    points: [], durationMs: 800, easing: "ease-in-out", loop: false, visible: true, ...overrides,
  };
}

/** Distance from point p to the segment a–b. */
function segmentDistance(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  if (!l2) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/** Ramer–Douglas–Peucker: keeps the points that matter, drops the rest (epsilon in px). */
export function simplify(points, epsilon = 5) {
  if (points.length < 3) return points.map(clone);
  let worst = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points[points.length - 1]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= epsilon) return [clone(points[0]), clone(points[points.length - 1])];
  return [...simplify(points.slice(0, at + 1), epsilon).slice(0, -1), ...simplify(points.slice(at), epsilon)];
}

/** Catmull-Rom spline through the control points; `perSegment` samples between each pair. */
export function smooth(points, perSegment = 12) {
  if (points.length < 3) return points.map(clone);
  const out = [];
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push(v3(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z)));
    }
  }
  out.push(clone(points[points.length - 1]));
  return out;
}

/** Total length of a polyline. */
export const pathLength = (pts) => pts.slice(1).reduce((sum, p, i) => sum + dist(pts[i], p), 0);

/** `n` points spaced evenly ALONG the line (so equal steps mean equal distance travelled). */
export function resample(pts, n) {
  if (pts.length < 2 || n < 2) return pts.map(clone);
  const total = pathLength(pts);
  if (!total) return Array.from({ length: n }, () => clone(pts[0]));
  const out = [clone(pts[0])];
  let seg = 0, walked = 0;
  for (let i = 1; i < n - 1; i++) {
    const want = (total * i) / (n - 1);
    while (seg < pts.length - 2 && walked + dist(pts[seg], pts[seg + 1]) < want) { walked += dist(pts[seg], pts[seg + 1]); seg += 1; }
    const l = dist(pts[seg], pts[seg + 1]) || 1;
    out.push(lerp(pts[seg], pts[seg + 1], Math.max(0, Math.min(1, (want - walked) / l))));
  }
  out.push(clone(pts[pts.length - 1]));
  return out;
}

/** Axis-aligned box around the points. */
export function bounds(pts) {
  const min = v3(Infinity, Infinity, Infinity), max = v3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) for (const k of ["x", "y", "z"]) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return pts.length ? { min, max, size: sub(max, min) } : null;
}

/** The smooth sampled line of a curve (what is drawn and animated). */
export const sampleCurve = (curve, perSegment = 12) => smooth(curve.points, perSegment);
export { len };
