/**
 * vec3.js — tiny 3D vector helpers.
 * Coordinates everywhere in the motion window follow CSS: x → right, y → DOWN, z → toward the viewer
 * (so a point is exactly what you would pass to translate3d(x, y, z)).
 */

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, k) => v3(a.x * k, a.y * k, a.z * k);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const dist = (a, b) => len(sub(a, b));
export const norm = (a) => { const l = len(a) || 1; return scale(a, 1 / l); };
export const lerp = (a, b, t) => v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const clone = (a) => v3(a.x, a.y, a.z);
export const round = (a, digits = 1) => { const k = 10 ** digits; return v3(Math.round(a.x * k) / k, Math.round(a.y * k) / k, Math.round(a.z * k) / k); };
