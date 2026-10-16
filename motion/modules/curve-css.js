/**
 * curve-css.js — turns drawn curves into what an agent can build from:
 *   • a plain-English summary of each move,
 *   • CSS @keyframes using translate3d (relative to where the curve starts),
 *   • the whole scene as one JSON document.
 */

import { sampleCurve, resample, pathLength, bounds } from "./curve-model.js";
import { sub, round } from "./vec3.js";

const SAMPLES = 12;                    // keyframe stops per curve
const px = (n) => `${Math.round(n * 10) / 10}px`;

/** "my curve!" -> "my-curve" (a safe CSS name). */
export const slug = (text, fallback) => (String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback);

/** Words for a movement vector: "right 120px, up 40px, toward the viewer 200px". */
export function describeMove(d) {
  const parts = [];
  if (Math.abs(d.x) >= 4) parts.push(`${d.x > 0 ? "right" : "left"} ${px(Math.abs(d.x))}`);
  if (Math.abs(d.y) >= 4) parts.push(`${d.y > 0 ? "down" : "up"} ${px(Math.abs(d.y))}`);
  if (Math.abs(d.z) >= 4) parts.push(`${d.z > 0 ? "toward the viewer" : "away from the viewer"} ${px(Math.abs(d.z))}`);
  return parts.length ? parts.join(", ") : "no net movement (a loop)";
}

/** The @keyframes block plus a ready-to-use animation rule for one curve. */
export function keyframesFor(curve, name) {
  const line = sampleCurve(curve), stops = resample(line, SAMPLES), origin = stops[0];
  const frames = stops.map((p, i) => {
    const d = sub(p, origin), pct = Math.round((i / (stops.length - 1)) * 1000) / 10;
    return `  ${pct}% { transform: translate3d(${px(d.x)}, ${px(d.y)}, ${px(d.z)}); }`;
  });
  return {
    keyframes: `@keyframes ${name} {\n${frames.join("\n")}\n}`,
    rule: `animation: ${name} ${Math.round(curve.durationMs)}ms ${curve.easing} ${curve.loop ? "infinite" : "1"} both;`,
  };
}

/** Everything the agent should know about one curve. */
export function describeCurve(curve, index) {
  const line = sampleCurve(curve), name = `motion-${slug(curve.label, `curve-${index + 1}`)}`;
  const start = curve.points[0], end = curve.points[curve.points.length - 1];
  const css = keyframesFor(curve, name);
  return {
    label: curve.label, target: curve.target, notes: curve.notes, color: curve.color,
    durationMs: curve.durationMs, easing: curve.easing, loop: curve.loop,
    summary: `${curve.label}${curve.target ? ` (${curve.target})` : ""}: ${describeMove(sub(end, start))} over ${curve.durationMs}ms, ${curve.easing}${curve.loop ? ", looping" : ""}. Path length ${px(pathLength(line))}.`,
    start: round(start), end: round(end), controlPoints: curve.points.map((p) => round(p)),
    bounds: bounds(line) && { min: round(bounds(line).min), max: round(bounds(line).max) },
    animationName: name, keyframes: css.keyframes, animationRule: css.rule,
  };
}

/**
 * The document sent to the agent.
 * @param {{curves: object[], perspective: number, stage: {w:number,h:number}, notes: string}} scene
 */
export function buildMotionDoc(scene) {
  const curves = scene.curves.filter((c) => c.visible !== false && c.points.length >= 2);
  return {
    schema: "dc-motion/v1", exportedAt: new Date().toISOString(),
    coordinates: "CSS: x to the right, y DOWN, z toward the viewer. Units are px. Each curve's keyframes are relative to its start point, so 0% is where the element normally sits.",
    perspective: `${scene.perspective}px`, stage: scene.stage, notes: scene.notes || "",
    usage: `Put perspective: ${scene.perspective}px on the parent (or use transform: perspective(${scene.perspective}px) …), and transform-style: preserve-3d if children also move in 3D.`,
    curves: curves.map(describeCurve),
  };
}
