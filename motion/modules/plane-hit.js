/**
 * plane-hit.js — where a screen click lands on one of the three drawing planes.
 *
 *   front  the XY plane, at depth z = offset        (like the face of your element)
 *   floor  the XZ plane, at y = offset              (looking down on the scene)
 *   side   the YZ plane, at x = offset
 */

import { v3, sub, dot } from "./vec3.js";

export const PLANES = {
  front: { label: "Front (X, Y)", normal: v3(0, 0, 1), axis: "z" },
  floor: { label: "Floor (X, Z)", normal: v3(0, 1, 0), axis: "y" },
  side: { label: "Side (Y, Z)", normal: v3(1, 0, 0), axis: "x" },
};

/** A point on the plane `planeId` that sits `offset` px along its normal. */
export const planeOrigin = (planeId, offset = 0) => v3(planeId === "side" ? offset : 0, planeId === "floor" ? offset : 0, planeId === "front" ? offset : 0);

/**
 * @param {{origin, dir}} ray
 * @param {string} planeId
 * @param {{x,y,z}} through  a point the plane passes through
 * @returns {{x,y,z}|null} null when the ray is parallel to the plane or points away from it
 */
export function hitPlane(ray, planeId, through) { return hitNormal(ray, PLANES[planeId].normal, through); }

/** Same, for any plane given by its normal (used for "the plane facing the camera"). */
export function hitNormal(ray, n, through) {
  const denom = dot(ray.dir, n);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot(sub(through, ray.origin), n) / denom;
  if (t < 0) return null;
  return v3(ray.origin.x + ray.dir.x * t, ray.origin.y + ray.dir.y * t, ray.origin.z + ray.dir.z * t);
}
