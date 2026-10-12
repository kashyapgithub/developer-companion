/**
 * element-picker.js — background side of "point at an element".
 *
 * Flow
 *   editor  --PICK_ELEMENT{requestId}-->  here: remember the request, bring the
 *           page forward, hide the floating window, inject picker/picker.js
 *   page    --ELEMENT_PICKED{payload}-->  here: screenshot the tab, crop to the
 *           element, restore the editor, broadcast ELEMENT_RESULT to the editor
 *
 * The pending request lives in chrome.storage.session so it survives the
 * service worker going to sleep while the user hunts for the right element.
 */

import { captureTab, resolveTargetTab } from "./tab-capture.js";

const REQUEST_KEY = "dcPickRequest";
const CROP_PADDING = 6; // CSS px of context around the element

// ---- start -----------------------------------------------------------------

/**
 * @param {{requestId:string, senderTab?:chrome.tabs.Tab}} opts
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function startPicking({ requestId, senderTab }) {
  const origins = ["http://*/*", "https://*/*"];
  if (!(await chrome.permissions.contains({ origins }))) {
    return { ok: false, error: "Allow access to web pages first (turn on “Hover over tabs” once to grant it)." };
  }
  const target = await resolveTargetTab(senderTab);
  if (!target) return { ok: false, error: "Open the page you want to pick from first." };

  const floating = senderTab?.id === target.id;     // the editor is the floating window on this tab
  await chrome.storage.session.set({
    [REQUEST_KEY]: { requestId, targetTabId: target.id, returnToTabId: floating ? null : senderTab?.id ?? null, floating },
  });

  try {
    if (!target.active) await chrome.tabs.update(target.id, { active: true });
    if (floating) await chrome.tabs.sendMessage(target.id, { type: "HOVER_SET_VISIBLE", visible: false }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId: target.id }, files: ["picker/describe.js", "picker/picker.js"] });
    return { ok: true };
  } catch (err) {
    await finish(target.id, { returnToTabId: senderTab?.id ?? null, floating });
    await chrome.storage.session.remove(REQUEST_KEY);
    return { ok: false, error: "Chrome doesn't allow picking on this page." };
  }
}

// ---- results ---------------------------------------------------------------

/** Called when the page picked an element. */
export async function handlePicked(payload, senderTab) {
  const { [REQUEST_KEY]: req } = await chrome.storage.session.get(REQUEST_KEY);
  if (!req) return;
  await chrome.storage.session.remove(REQUEST_KEY);

  // The picker already removed its overlay; give the floating window back only AFTER the screenshot.
  const shot = await captureTab({ tabId: req.targetTabId });
  let crop = null;
  if (shot.ok) crop = await cropToElement(shot.dataUrl, payload.rect, payload.viewport).catch(() => null);

  await finish(req.targetTabId, req);
  broadcast({
    type: "ELEMENT_RESULT",
    requestId: req.requestId,
    ok: true,
    cropDataUrl: crop || shot.dataUrl || null,
    element: payload,
  });
}

export async function handleCancelled() {
  const { [REQUEST_KEY]: req } = await chrome.storage.session.get(REQUEST_KEY);
  if (!req) return;
  await chrome.storage.session.remove(REQUEST_KEY);
  await finish(req.targetTabId, req);
  broadcast({ type: "ELEMENT_RESULT", requestId: req.requestId, ok: false, cancelled: true });
}

/** Puts the user back where they started: floating window visible, or the editor tab in front. */
async function finish(targetTabId, req) {
  if (req.floating) chrome.tabs.sendMessage(targetTabId, { type: "HOVER_SET_VISIBLE", visible: true }).catch(() => {});
  if (req.returnToTabId != null) await chrome.tabs.update(req.returnToTabId, { active: true }).catch(() => {});
}

/** Extension pages (the editor) listen for this; ignore "nobody is listening" errors. */
function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ---- cropping ----------------------------------------------------------------

/** Crops a full-viewport screenshot down to `rect` (viewport CSS px) plus a little context. */
export async function cropToElement(dataUrl, rect, viewport) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = bitmap.width / viewport.w;                       // device pixels per CSS px
  const x = Math.max(0, Math.floor((rect.x - CROP_PADDING) * scale));
  const y = Math.max(0, Math.floor((rect.y - CROP_PADDING) * scale));
  const w = Math.min(bitmap.width - x, Math.ceil((rect.w + CROP_PADDING * 2) * scale));
  const h = Math.min(bitmap.height - y, Math.ceil((rect.h + CROP_PADDING * 2) * scale));
  if (w < 2 || h < 2) { bitmap.close?.(); return null; }         // element is off-screen
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  bitmap.close?.();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}
