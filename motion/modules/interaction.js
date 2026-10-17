/**
 * interaction.js — mouse and keyboard on the 3D canvas.
 *
 *   right-drag (or Alt-drag, or the Orbit tool)   turn the view          wheel   zoom
 *   Draw    press and drag: a freehand stroke on the chosen plane. Hold Shift to CONTINUE the selected curve
 *           (the new stroke may use another plane, which is how curves become truly 3D).
 *   Points  click to drop points, double-click or Enter to finish, Backspace removes the last, Esc cancels
 *   Edit    drag a white control point of the selected curve; it moves on the chosen plane
 *
 * Everything that changes the drawing goes through `hooks` so this file stays about pointers only.
 */

import { orbit, zoom, rayAt, project, basis } from "./camera.js";
import { hitPlane, hitNormal, planeOrigin } from "./plane-hit.js";
import { simplify, createCurve } from "./curve-model.js";
import { selectedCurve } from "./scene-state.js";
import { dist, clone } from "./vec3.js";

const MIN_STEP = 6;               // px between freehand samples
const PICK_RADIUS = 12;           // screen px to grab a control point

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} scene
 * @param {{ redraw(): void, changed(): void, committed(): void }} hooks
 */
export function attachInteraction(canvas, scene, hooks) {
  let mode = null;                // "orbit" | "draw" | "edit"
  let last = null, grabbed = null;

  const size = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  /** The 3D point under the pointer on the drawing plane (through `through`, or the plane at its offset). */
  function pointOnPlane(e, through = planeOrigin(scene.plane, scene.offset)) {
    const { w, h } = size(), p = local(e);
    return hitPlane(rayAt(scene.camera, p.x, p.y, w, h), scene.plane, through);
  }

  /** The 3D point under the pointer on the plane through `through` that faces the camera. */
  function facingHit(e, through) {
    const { w, h } = size(), p = local(e);
    const forward = rayAt(scene.camera, w / 2, h / 2, w, h).dir;
    return hitNormal(rayAt(scene.camera, p.x, p.y, w, h), forward, through);
  }

  /** Where a continued stroke must begin: the end of the selected curve. */
  const continuing = (e) => (e.shiftKey ? selectedCurve(scene) : null);

  function nearestControlPoint(e) {
    const curve = selectedCurve(scene); if (!curve) return null;
    const { w, h } = size(), b = basis(scene.camera), p = local(e);
    let best = null;
    curve.points.forEach((pt, index) => {
      const s = project(scene.camera, pt, w, h, b); if (!s) return;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d <= PICK_RADIUS && (!best || d < best.d)) best = { curve, index, d };
    });
    return best;
  }

  /** Turns the draft into a new curve, or adds it to the end of the selected one. */
  function finishDraft(extend) {
    const draft = scene.draft; scene.draft = null;
    if (!draft || draft.points.length < 2) { hooks.redraw(); return; }
    const points = simplify(draft.points, draft.freehand ? 5 : 0);
    if (extend && draft.extendId) {
      const curve = scene.curves.find((c) => c.id === draft.extendId);
      if (curve) curve.points = [...curve.points, ...points.slice(1)];
    } else {
      const curve = createCurve(scene.curves, { points });
      scene.curves.push(curve); scene.selectedId = curve.id;
    }
    hooks.changed(); hooks.committed();
  }

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    last = local(e);
    if (e.button === 2 || e.altKey || scene.tool === "orbit") { mode = "orbit"; return; }
    if (e.button !== 0) return;

    if (scene.tool === "draw") {
      const base = continuing(e), through = base ? base.points[base.points.length - 1] : undefined;
      const start = pointOnPlane(e, through); if (!start) return;
      mode = "draw";
      scene.draft = { points: base ? [clone(through), start] : [start], freehand: true, extendId: base?.id };
      hooks.redraw();
    } else if (scene.tool === "points") {
      const base = continuing(e), through = scene.draft ? scene.draft.points[0] : base ? base.points[base.points.length - 1] : undefined;   // every point of one polyline shares a plane
      const p = pointOnPlane(e, through); if (!p) return;
      if (!scene.draft) scene.draft = { points: base ? [clone(through)] : [], freehand: false, extendId: base?.id };
      scene.draft.points.push(p); hooks.redraw();
    } else if (scene.tool === "edit") {
      const hit = nearestControlPoint(e); if (!hit) return;
      grabbed = hit; mode = "edit";
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (mode === "orbit" && last) { orbit(scene.camera, p.x - last.x, p.y - last.y); last = p; hooks.redraw(); return; }
    if (mode === "draw" && scene.draft) {
      const pt = pointOnPlane(e, scene.draft.points[0]); if (!pt) return;
      if (dist(pt, scene.draft.points[scene.draft.points.length - 1]) >= MIN_STEP) { scene.draft.points.push(pt); hooks.redraw(); }
      return;
    }
    if (mode === "edit" && grabbed) {
      // Default: slide the point in the plane facing the camera (predictable from any angle).
      // Hold Shift to move it along the chosen drawing plane instead (to change its depth).
      const through = grabbed.curve.points[grabbed.index];
      const pt = e.shiftKey ? pointOnPlane(e, through) : facingHit(e, through);
      if (!pt) return;
      grabbed.curve.points[grabbed.index] = pt; hooks.changed(); return;
    }
    if (scene.tool === "points" && scene.draft) { scene.hover = pointOnPlane(e, scene.draft.points.at(-1)); hooks.redraw(); }
  });

  const end = () => {
    if (mode === "draw") finishDraft(true);
    if (mode === "edit" && grabbed) { hooks.committed(); grabbed = null; }
    mode = null; last = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener("dblclick", () => { if (scene.tool === "points" && scene.draft) { scene.draft.points.pop(); finishDraft(true); } });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom(scene.camera, e.deltaY); hooks.redraw(); }, { passive: false });

  /** Keyboard: Enter / Backspace / Escape while placing points, Delete for the selected curve is handled by the window. */
  document.addEventListener("keydown", (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (scene.tool === "points" && scene.draft) {
      if (e.key === "Enter") { e.preventDefault(); finishDraft(true); }
      if (e.key === "Escape") { scene.draft = null; hooks.redraw(); }
      if (e.key === "Backspace") { e.preventDefault(); scene.draft.points.pop(); if (!scene.draft.points.length) scene.draft = null; hooks.redraw(); }
    }
  });
}
