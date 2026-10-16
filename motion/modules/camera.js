/**
 * camera.js — an orbiting perspective camera that looks at the middle of the scene.
 *
 *   yaw    turns around the vertical axis      pitch  tilts up / down      distance  how far back
 *
 * project() turns a 3D point into a screen point; rayAt() turns a screen point into a ray
 * (used to draw on planes). Inputs and outputs use CSS coordinates (y down); the maths inside
 * uses the usual y-up space, so we flip y on the way in and out.
 */

import { v3, add, sub, scale, dot, cross, norm } from "./vec3.js";

const MIN_DISTANCE = 250, MAX_DISTANCE = 4000, MAX_PITCH = 1.45;
const flip = (p) => v3(p.x, -p.y, p.z);

/** @returns a camera state object (mutate yaw / pitch / distance directly) */
export function createCamera({ yaw = -0.55, pitch = 0.32, distance = 1100, fov = (50 * Math.PI) / 180 } = {}) {
  return { yaw, pitch, distance, fov, target: v3(0, 0, 0) };
}

/** Orbit by pixel deltas; pitch is clamped so the view never flips. */
export function orbit(cam, dx, dy) {
  cam.yaw -= dx * 0.008;
  cam.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, cam.pitch + dy * 0.008));
}

/** Zoom by a wheel delta. */
export function zoom(cam, deltaY) {
  cam.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, cam.distance * Math.exp(deltaY * 0.001)));
}

/** Camera position and its right / up / forward axes (y-up space). */
export function basis(cam) {
  const t = flip(cam.target);
  const pos = add(t, scale(v3(Math.cos(cam.pitch) * Math.sin(cam.yaw), Math.sin(cam.pitch), Math.cos(cam.pitch) * Math.cos(cam.yaw)), cam.distance));
  const f = norm(sub(t, pos));
  const r = norm(cross(f, v3(0, 1, 0)));
  const u = cross(r, f);
  return { pos, f, r, u };
}

const focalLength = (cam, height) => height / 2 / Math.tan(cam.fov / 2);

/**
 * @param {object} cam   @param {{x,y,z}} p   a point in CSS coordinates
 * @returns {{x:number, y:number, depth:number, k:number}|null}  screen position, distance in front of the camera, pixels per unit
 */
export function project(cam, p, width, height, b = basis(cam)) {
  const d = sub(flip(p), b.pos);
  const depth = dot(d, b.f);
  if (depth < 1) return null;                                   // behind the camera
  const k = focalLength(cam, height) / depth;
  return { x: width / 2 + dot(d, b.r) * k, y: height / 2 - dot(d, b.u) * k, depth, k };
}

/** The ray (CSS coordinates) that passes through a screen point. */
export function rayAt(cam, sx, sy, width, height, b = basis(cam)) {
  const fl = focalLength(cam, height);
  const dir = norm(add(add(scale(b.r, (sx - width / 2) / fl), scale(b.u, -(sy - height / 2) / fl)), b.f));
  return { origin: flip(b.pos), dir: flip(dir) };
}
