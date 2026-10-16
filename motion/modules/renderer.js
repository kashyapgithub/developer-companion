/**
 * renderer.js — draws the 3D scene onto a 2D canvas.
 *
 *   floor grid · axes · the element's "stage" rectangle · the drawing plane · every curve
 *   (line, floor shadow, start dot, arrowhead, colour-coded label) · control points · the stroke in progress
 *
 * `forExport` leaves out the editing aids so the picture sent to the agent is clean.
 */

import { project, basis } from "./camera.js";
import { sampleCurve } from "./curve-model.js";
import { PLANES, planeOrigin } from "./plane-hit.js";
import { v3 } from "./vec3.js";

const GRID = 50, GRID_EXTENT = 450;

/** Draws a 3D polyline; skips parts behind the camera. */
function line3d(ctx, cam, pts, w, h, b) {
  ctx.beginPath();
  let pen = false;
  for (const p of pts) {
    const s = project(cam, p, w, h, b);
    if (!s) { pen = false; continue; }
    pen ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); pen = true;
  }
  ctx.stroke();
}

function drawGrid(ctx, cam, w, h, b, floorY) {
  ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.07)";
  for (let g = -GRID_EXTENT; g <= GRID_EXTENT; g += GRID) {
    line3d(ctx, cam, [v3(g, floorY, -GRID_EXTENT), v3(g, floorY, GRID_EXTENT)], w, h, b);
    line3d(ctx, cam, [v3(-GRID_EXTENT, floorY, g), v3(GRID_EXTENT, floorY, g)], w, h, b);
  }
}

function drawAxes(ctx, cam, w, h, b) {
  const axes = [["X", v3(220, 0, 0), "#ff6b5e"], ["Y (down)", v3(0, 220, 0), "#5fd08a"], ["Z (toward you)", v3(0, 0, 220), "#4f9bff"]];
  ctx.font = "11px system-ui, sans-serif"; ctx.lineWidth = 1.5;
  for (const [name, end, color] of axes) {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    line3d(ctx, cam, [v3(0, 0, 0), end], w, h, b);
    const s = project(cam, end, w, h, b);
    if (s) ctx.fillText(name, s.x + 5, s.y + 4);
  }
}

function drawQuad(ctx, cam, corners, w, h, b, { fill, stroke, dash = [] }) {
  const pts = corners.map((p) => project(cam, p, w, h, b));
  if (pts.some((p) => !p)) return;
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.setLineDash(dash); ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
}

/** The element's box, centred on the origin at z = 0. */
function drawStage(ctx, cam, scene, w, h, b) {
  const { w: sw, h: sh } = scene.stage, x = sw / 2, y = sh / 2;
  drawQuad(ctx, cam, [v3(-x, -y, 0), v3(x, -y, 0), v3(x, y, 0), v3(-x, y, 0)], w, h, b, { fill: "rgba(255,255,255,0.05)", stroke: "rgba(255,255,255,0.45)", dash: [6, 4] });
  const s = project(cam, v3(-x, -y, 0), w, h, b);
  if (s) { ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = "11px system-ui, sans-serif"; ctx.fillText(`your element ${sw}×${sh}`, s.x, s.y - 6); }
}

/** A translucent square showing which plane a stroke will land on. */
function drawPlane(ctx, cam, scene, w, h, b) {
  const o = planeOrigin(scene.plane, scene.offset), e = 300;
  const corners = scene.plane === "front" ? [v3(-e, -e, o.z), v3(e, -e, o.z), v3(e, e, o.z), v3(-e, e, o.z)]
    : scene.plane === "floor" ? [v3(-e, o.y, -e), v3(e, o.y, -e), v3(e, o.y, e), v3(-e, o.y, e)]
    : [v3(o.x, -e, -e), v3(o.x, e, -e), v3(o.x, e, e), v3(o.x, -e, e)];
  drawQuad(ctx, cam, corners, w, h, b, { fill: "rgba(79,107,255,0.08)", stroke: "rgba(120,150,255,0.6)" });
}

function arrowhead(ctx, from, to, color) {
  const a = Math.atan2(to.y - from.y, to.x - from.x), size = 11;
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(a - 0.45), to.y - size * Math.sin(a - 0.45));
  ctx.lineTo(to.x - size * Math.cos(a + 0.45), to.y - size * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
}

function drawLabel(ctx, curve, at) {
  const text = `${curve.label} · ${curve.durationMs}ms`;
  ctx.font = "600 12px system-ui, sans-serif";
  const width = ctx.measureText(text).width + 14, x = at.x + 10, y = at.y - 26;
  ctx.fillStyle = curve.color; ctx.beginPath(); ctx.roundRect(x, y, width, 20, 10); ctx.fill();
  ctx.fillStyle = "#101114"; ctx.textBaseline = "middle"; ctx.fillText(text, x + 7, y + 10); ctx.textBaseline = "alphabetic";
}

function drawCurve(ctx, cam, scene, curve, w, h, b, { forExport }) {
  const line = sampleCurve(curve), selected = curve.id === scene.selectedId;
  if (line.length < 2) return;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (scene.guides) {                                               // the path's shadow on the floor, for depth
    ctx.strokeStyle = curve.color + "55"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    line3d(ctx, cam, line.map((p) => v3(p.x, scene.stage.h / 2, p.z)), w, h, b); ctx.setLineDash([]);
  }
  ctx.strokeStyle = curve.color; ctx.lineWidth = selected && !forExport ? 4.5 : 3.2; ctx.globalAlpha = selected || forExport || !scene.selectedId ? 1 : 0.65;
  line3d(ctx, cam, line, w, h, b); ctx.globalAlpha = 1;
  const a = project(cam, line[0], w, h, b), z = project(cam, line[line.length - 1], w, h, b), z2 = project(cam, line[line.length - 2], w, h, b);
  if (a) { ctx.fillStyle = curve.color; ctx.beginPath(); ctx.arc(a.x, a.y, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#101114"; ctx.lineWidth = 2; ctx.stroke(); drawLabel(ctx, curve, a); }
  if (z && z2) arrowhead(ctx, z2, z, curve.color);
  if (selected && !forExport) for (const p of curve.points) { const s = project(cam, p, w, h, b); if (s) { ctx.fillStyle = "#fff"; ctx.strokeStyle = curve.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } }
}

/** @param {HTMLCanvasElement} canvas @param {object} scene @param {{forExport?: boolean}} opts */
export function render(canvas, scene, { forExport = false } = {}) {
  const ctx = canvas.getContext("2d"), w = canvas.clientWidth, h = canvas.clientHeight, cam = scene.camera, b = basis(cam);
  ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  ctx.fillStyle = forExport ? "#15161b" : "#101114"; ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, cam, w, h, b, scene.stage.h / 2);
  drawAxes(ctx, cam, w, h, b);
  drawStage(ctx, cam, scene, w, h, b);
  if (!forExport && ["draw", "points"].includes(scene.tool)) drawPlane(ctx, cam, scene, w, h, b);
  for (const c of scene.curves) if (c.visible !== false) drawCurve(ctx, cam, scene, c, w, h, b, { forExport });
  if (!forExport && scene.draft && scene.draft.points.length) {
    const pts = scene.hover && scene.tool === "points" ? [...scene.draft.points, scene.hover] : scene.draft.points;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]); line3d(ctx, cam, pts, w, h, b); ctx.setLineDash([]);
  }
}

/** Matches the canvas pixel size to its CSS size (sharp on high-DPI screens). Returns true when it changed. */
export function fitCanvas(canvas) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(canvas.clientWidth * ratio), h = Math.round(canvas.clientHeight * ratio);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w; canvas.height = h; return true;
}
export { PLANES };
