/**
 * scene-state.js — everything the 3D window remembers, plus undo.
 *
 * `scene` is plain data (so it can be saved and sent). `history` keeps snapshots of the curves
 * only, so undo never touches the camera or tool settings.
 */

import { createCamera } from "./camera.js";

const MAX_HISTORY = 60;

export function createScene() {
  return {
    curves: [], selectedId: "", notes: "",
    perspective: 800, stage: { w: 320, h: 200 },
    tool: "draw", plane: "front", offset: 0, guides: true,
    camera: createCamera(), draft: null, hover: null,
  };
}

const snapshot = (scene) => JSON.stringify({ curves: scene.curves, selectedId: scene.selectedId });

/** Undo / redo-free history: call `commit` after every change you want to be undoable. */
export function createHistory(scene) {
  const stack = [snapshot(scene)];
  return {
    commit() { const s = snapshot(scene); if (s !== stack[stack.length - 1]) { stack.push(s); if (stack.length > MAX_HISTORY) stack.shift(); } },
    undo() { if (stack.length < 2) return false; stack.pop(); const s = JSON.parse(stack[stack.length - 1]); scene.curves = s.curves; scene.selectedId = s.selectedId; return true; },
    reset() { stack.length = 0; stack.push(snapshot(scene)); },
  };
}

export const selectedCurve = (scene) => scene.curves.find((c) => c.id === scene.selectedId) || null;

/** What is saved between sessions (no camera, no draft). */
export const toSaved = (scene) => ({ curves: scene.curves, selectedId: scene.selectedId, notes: scene.notes, perspective: scene.perspective, stage: scene.stage, plane: scene.plane, offset: scene.offset, guides: scene.guides });
export function applySaved(scene, saved) {
  if (!saved || typeof saved !== "object") return;
  if (Array.isArray(saved.curves)) scene.curves = saved.curves.filter((c) => c && Array.isArray(c.points));
  for (const k of ["selectedId", "notes", "perspective", "stage", "plane", "offset", "guides"]) if (saved[k] !== undefined) scene[k] = saved[k];
}
