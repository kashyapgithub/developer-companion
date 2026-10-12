/**
 * video-window.js — opens the Video review window and routes its frames to the editor.
 *
 * The recording must live in a window of its own: it keeps running while you
 * work in your app, and the screen-share picker needs a real extension page.
 */

const WINDOW_KEY = "dcVideoWindowId";
const SIZE = { width: 420, height: 680 };

/** Opens the window, or focuses it if it is already open. */
export async function openVideoWindow() {
  const { [WINDOW_KEY]: existing } = await chrome.storage.session.get(WINDOW_KEY);
  if (existing != null) {
    try { await chrome.windows.update(existing, { focused: true }); return { ok: true }; } catch { /* closed: open a new one */ }
  }
  const win = await chrome.windows.create({ url: chrome.runtime.getURL("video/video.html"), type: "popup", ...SIZE });
  await chrome.storage.session.set({ [WINDOW_KEY]: win.id });
  return { ok: true };
}

/** Delivers an image to the full-tab editor (the one place a frame can be drawn on). */
export async function sendImageToEditor({ dataUrl, name, meta }) {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("editor/editor.html") + "*" });
  const editor = tabs.find((t) => !t.url.includes("embedded=1"));
  if (!editor) return { ok: false, error: "Open the editor first." };
  try {
    return await chrome.tabs.sendMessage(editor.id, { type: "ADD_IMAGE_TO_CANVAS", dataUrl, name, meta });
  } catch {
    return { ok: false, error: "The editor didn't answer." };
  }
}
