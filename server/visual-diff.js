/**
 * visual-diff.js — "what changed on screen?" for the agent.
 *
 * Keeps named baseline screenshots on disk, compares a new screenshot to one,
 * and produces: the share of changed pixels, the changed regions as boxes, and
 * a diff image (the new screenshot dimmed, changed pixels red, regions boxed).
 *
 * Pure image maths on PNG buffers (pngjs); no browser needed, so it is unit-testable.
 */

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { getStoreDir } from "./config.js";

const CELL = 24;               // the image is judged in CELL x CELL blocks
const CELL_MIN_SHARE = 0.02;   // a block counts as "changed" when 2% of its pixels differ
const MAX_REGIONS = 12;

// ---- baselines on disk --------------------------------------------------------------

const dir = () => path.join(getStoreDir(), "baselines");
const safeName = (n) => String(n || "default").replace(/[^\w.-]/g, "_").slice(0, 60) || "default";
const fileFor = (name) => path.join(dir(), `${safeName(name)}.png`);

export function saveBaseline(name, pngBuffer) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(fileFor(name), pngBuffer);
  return { name: safeName(name), savedAt: new Date().toISOString() };
}

/** { buffer, savedAt } or null. */
export function readBaseline(name) {
  try { return { buffer: fs.readFileSync(fileFor(name)), savedAt: fs.statSync(fileFor(name)).mtime.toISOString() }; }
  catch { return null; }
}

// ---- comparing ----------------------------------------------------------------------

/** Per-pixel test: any channel differing by more than `tolerance` (0-255) counts. */
const pixelDiffers = (a, b, i, tolerance) =>
  Math.abs(a[i] - b[i]) > tolerance || Math.abs(a[i + 1] - b[i + 1]) > tolerance || Math.abs(a[i + 2] - b[i + 2]) > tolerance;

/** Merges touching changed blocks into bounding boxes (flood fill over the block grid). */
function regionsFromCells(cells, cols, rows, w, h) {
  const seen = new Uint8Array(cells.length), regions = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start]) continue;
    let minC = cols, maxC = 0, minR = rows, maxR = 0, changed = 0, total = 0;
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop(), c = idx % cols, r = (idx / cols) | 0;
      minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      changed += cells[idx]; total++;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr, n = nr * cols + nc;
        if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && cells[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    const x = minC * CELL, y = minR * CELL;
    regions.push({ x, y, w: Math.min(w, (maxC + 1) * CELL) - x, h: Math.min(h, (maxR + 1) * CELL) - y, changed_pixels: changed });
  }
  return regions.sort((a, b) => b.changed_pixels - a.changed_pixels).slice(0, MAX_REGIONS);
}

/** Draws a 2px rectangle outline into an RGBA PNG. */
function outline(png, { x, y, w, h }, [r, g, b]) {
  const put = (px, py) => { if (px < 0 || py < 0 || px >= png.width || py >= png.height) return; const i = (py * png.width + px) * 4; png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255; };
  for (let t = 0; t < 2; t++) for (let k = 0; k < w; k++) { put(x + k, y + t); put(x + k, y + h - 1 - t); }
  for (let t = 0; t < 2; t++) for (let k = 0; k < h; k++) { put(x + t, y + k); put(x + w - 1 - t, y + k); }
}

/**
 * Compares two PNG buffers. If the sizes differ only the overlapping top-left area is
 * compared and `sizeChanged` says so (a layout that grew or shrank is itself a finding).
 */
export function diffPng(baselineBuf, currentBuf, { tolerance = 16 } = {}) {
  const base = PNG.sync.read(baselineBuf), cur = PNG.sync.read(currentBuf);
  const w = Math.min(base.width, cur.width), h = Math.min(base.height, cur.height);
  const cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
  const cells = new Float32Array(cols * rows);                 // changed pixels per block
  const out = new PNG({ width: cur.width, height: cur.height });
  let changed = 0;

  for (let y = 0; y < cur.height; y++) for (let x = 0; x < cur.width; x++) {
    const i = (y * cur.width + x) * 4;
    const inBoth = x < w && y < h;
    const differs = inBoth ? pixelDiffers(base.data, cur.data, (y * base.width + x) * 4, tolerance) : true; // new area = changed
    if (differs) {
      changed++;
      if (inBoth) cells[((y / CELL) | 0) * cols + ((x / CELL) | 0)]++;
      out.data[i] = 235; out.data[i + 1] = 40; out.data[i + 2] = 60;      // changed pixel: red
    } else {                                                               // unchanged: the screenshot, faded
      out.data[i] = 255 - (255 - cur.data[i]) * 0.35; out.data[i + 1] = 255 - (255 - cur.data[i + 1]) * 0.35; out.data[i + 2] = 255 - (255 - cur.data[i + 2]) * 0.35;
    }
    out.data[i + 3] = 255;
  }

  const blockArea = CELL * CELL;
  const marked = Uint8Array.from(cells, (n) => (n / blockArea >= CELL_MIN_SHARE ? n : 0));
  const regions = regionsFromCells(marked, cols, rows, w, h).map((r) => ({ ...r, changed_percent: round(100 * r.changed_pixels / (r.w * r.h)) }));
  for (const r of regions) outline(out, r, [255, 200, 0]);

  return {
    changedPercent: round(100 * changed / (cur.width * cur.height)),
    regions: regions.map(({ changed_pixels, ...r }) => r),
    sizeChanged: base.width !== cur.width || base.height !== cur.height,
    baselineSize: { width: base.width, height: base.height },
    currentSize: { width: cur.width, height: cur.height },
    diffPng: PNG.sync.write(out),
  };
}

const round = (n) => Math.round(n * 100) / 100;
