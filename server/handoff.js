/**
 * handoff.js — bundle everything the agent can see into ONE json file, and load it back.
 *
 * Use it to move a session to another computer/VM, hand it to a teammate, or attach it
 * to a bug report. The bundle holds: the sketch, the X-ray selection, the video review
 * (notes + frames, NOT the video file), the inspiration library, and a read-only summary
 * of the latest log recording. Import restores everything except that summary.
 *
 * Pure orchestration over storage.js / inspiration.js; nothing here touches HTTP.
 */

import fs from "node:fs";
import path from "node:path";
import * as store from "./storage.js";
import * as insp from "./inspiration.js";

export const BUNDLE_FORMAT = "developer-companion-handoff";
export const BUNDLE_VERSION = 1;

const jpegUrl = (b64) => `data:image/jpeg;base64,${b64}`;
const pngUrl = (b64) => `data:image/png;base64,${b64}`;

// ---- export --------------------------------------------------------------------------

/** Sketch (json + png) or null. */
function exportSketch() {
  const s = store.readSketch();
  return s ? { json: s.json, pngBase64: s.pngBase64 } : null;
}

/** X-ray selection with crops inline, or null. */
function exportXray() {
  const x = store.readXray();
  return x ? { doc: x.doc, images: x.images } : null;
}

/** Newest video review: notes and frames, minus the (huge) video file. */
function exportVideo() {
  const v = store.readVideoReview();
  if (!v) return null;
  const { video_file, ...doc } = v.doc;
  return { doc, frames: v.frames };
}

/** Whole inspiration library with image bytes inline. */
function exportInspiration() {
  const lib = insp.listLibrary();
  const images = {};
  for (const item of lib.items) {
    const img = insp.readItemImage(item.id);
    if (img) images[item.id] = { mime: img.mime, base64: img.buffer.toString("base64") };
  }
  return { folders: lib.folders.map(({ count, ...f }) => f), items: lib.items, images };
}

/** Read-only digest of the newest log recording (never fails the export). */
function exportRecordingSummary() {
  try { const id = store.latestRecordingId(); return id ? { id, summary: store.summarizeRecording(id) } : null; }
  catch { return null; }
}

/** Builds the bundle. `inspiration:false` leaves the library out to keep it small. */
export function buildBundle({ inspiration = true } = {}) {
  return {
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, createdAt: new Date().toISOString(),
    sketch: exportSketch(), xray: exportXray(), video: exportVideo(),
    inspiration: inspiration ? exportInspiration() : null,
    recording_summary: exportRecordingSummary(),
  };
}

/** Which parts a bundle holds, with counts — for status lines and tool replies. */
export function describeBundle(b) {
  return {
    sketch: !!b.sketch,
    xray_elements: b.xray?.doc?.elements?.length || 0,
    video_moments: b.video?.doc?.moments?.length || 0,
    inspiration_images: b.inspiration?.items?.length || 0,
    recording_summary: !!b.recording_summary,
  };
}

/** Writes a bundle file under the store dir and returns its path. */
export function saveBundleFile(bundle, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `handoff-${bundle.createdAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle));
  return file;
}

// ---- import --------------------------------------------------------------------------

/** Throws a readable error unless `b` looks like one of our bundles. */
export function validateBundle(b) {
  if (!b || typeof b !== "object" || b.format !== BUNDLE_FORMAT) throw new Error("This isn't a Developer Companion handoff file.");
  if (b.version > BUNDLE_VERSION) throw new Error("This handoff was made by a newer version. Update Developer Companion first.");
}

function importXray(x) {
  const elements = (x.doc.elements || []).map((el, i) => {
    const { screenshot_file, ...rest } = el;
    return x.images?.[i] ? { ...rest, screenshot: pngUrl(x.images[i]) } : rest;
  });
  store.writeXray({ ...x.doc, elements });
  return elements.length;
}

function importVideo(v) {
  const moments = (v.doc.moments || []).map((m, i) => {
    const { frame_file, ...rest } = m;
    return v.frames?.[i] ? { ...rest, frame: jpegUrl(v.frames[i]) } : rest;
  });
  store.writeVideoReview({ ...v.doc, moments });
  return moments.length;
}

/** Merges the library: folders matched by name, images added (skipping ones already there: same title, size and source). */
function importInspiration(lib) {
  const folderIdByOld = {};
  for (const f of lib.folders || []) folderIdByOld[f.id] = insp.createFolder(f.name).id;
  const have = new Set(insp.listLibrary().items.map((i) => `${i.title}|${i.bytes}|${i.url}`));
  let added = 0;
  for (const item of [...(lib.items || [])].reverse()) {      // oldest first, so newest ends on top again
    const img = lib.images?.[item.id];
    if (!img || have.has(`${item.title}|${item.bytes}|${item.url}`)) continue;
    insp.addItem({ dataUrl: `data:${img.mime};base64,${img.base64}`, title: item.title, url: item.url, note: item.note, folder: folderIdByOld[item.folder] ?? "" });
    added++;
  }
  return added;
}

/** Restores a bundle. Each part is independent: one bad part doesn't stop the rest. */
export function importBundle(b) {
  validateBundle(b);
  const result = { imported: {}, problems: [] };
  const part = (name, present, run) => {
    if (!present) return;
    try { result.imported[name] = run(); } catch (err) { result.problems.push(`${name}: ${err.message || err}`); }
  };
  part("sketch", b.sketch?.json, () => { store.writeSketch(b.sketch); return true; });
  part("xray_elements", b.xray?.doc, () => importXray(b.xray));
  part("video_moments", b.video?.doc, () => importVideo(b.video));
  part("inspiration_images", b.inspiration, () => importInspiration(b.inspiration));
  return result;
}
