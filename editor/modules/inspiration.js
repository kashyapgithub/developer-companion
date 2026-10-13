/**
 * inspiration.js — wires the Inspiration library into the editor.
 *
 * Three small jobs, kept apart from the panel itself:
 *   1. build the API + panel and refresh the panel when its tab opens,
 *   2. the "Save to inspiration" button (Design panel, shown for images),
 *   3. the "Also save to Inspiration" switch in the Add screenshot menu —
 *      remembered, and applied to every image that lands on the canvas.
 */

import { createInspirationApi } from "./inspirationApi.js";
import { createInspirationPanel } from "./inspirationPanel.js";

const AUTOSAVE_KEY = "inspirationAutoSave";

/** Reads a boolean from extension storage (false if unavailable). */
const readFlag = (key) => new Promise((resolve) => {
  try { chrome.storage.local.get([key], (r) => resolve(!!r?.[key])); } catch { resolve(false); }
});

export function wireInspiration({ controller, imageImport, shotStatus }) {
  const sideEl = document.getElementById("side");
  const say = (text) => {
    shotStatus.textContent = text;
    clearTimeout(shotStatus._t);
    shotStatus._t = setTimeout(() => { shotStatus.textContent = ""; }, 4000);
  };

  const panel = createInspirationPanel({ rootEl: document.getElementById("inspiration"), api: createInspirationApi(), imageImport, say });
  sideEl.addEventListener("sidetab", (e) => { if (e.detail === "inspiration") panel.refresh(); });

  // --- Design panel button: save the selected image ---
  document.getElementById("save-inspo-btn").addEventListener("click", async () => {
    const image = controller.state.shapes.find((s) => s.id === controller.state.selectedIds[0] && s.type === "image");
    if (!image) return;
    await panel.save({ dataUrl: image.src, title: image.name || "Saved image", url: image.meta?.url });
  });

  // --- auto-save switch ---
  const autoBox = document.getElementById("insp-autosave");
  let auto = false;
  readFlag(AUTOSAVE_KEY).then((v) => { auto = v; autoBox.checked = v; });
  autoBox.addEventListener("change", () => {
    auto = autoBox.checked;
    try { chrome.storage.local.set({ [AUTOSAVE_KEY]: auto }); } catch { /* storage unavailable */ }
  });
  // Clicking the switch must not close the menu before the change registers.
  autoBox.closest("label").addEventListener("click", (e) => e.stopPropagation());

  return {
    /** Called for every image that lands on the canvas; saves it when auto-save is on (never re-saves library images). */
    autoSave({ dataUrl, name, url, kind }) {
      if (auto && kind !== "inspiration") panel.save({ dataUrl, title: name || "Capture", url });
    },
  };
}
