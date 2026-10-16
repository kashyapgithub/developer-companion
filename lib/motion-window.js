/**
 * motion-window.js — opens the 3D motion window (draw 3D curves for CSS animation).
 * A small popup window, same pattern as api-window.js.
 */

const WINDOW_KEY = "dcMotionWindowId";
const SIZE = { width: 1180, height: 780 };

/** Opens the window, or focuses it if it is already open. */
export async function openMotionWindow() {
  const { [WINDOW_KEY]: existing } = await chrome.storage.session.get(WINDOW_KEY);
  if (existing != null) {
    try { await chrome.windows.update(existing, { focused: true }); return { ok: true }; } catch { /* closed: open a new one */ }
  }
  const win = await chrome.windows.create({ url: chrome.runtime.getURL("motion/motion.html"), type: "popup", ...SIZE });
  await chrome.storage.session.set({ [WINDOW_KEY]: win.id });
  return { ok: true };
}
