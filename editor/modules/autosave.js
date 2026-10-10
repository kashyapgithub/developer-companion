/**
 * autosave.js — keeps the canvas alive across tabs and reloads.
 *
 * Why: the hover window is a separate iframe on every tab, so without this
 * each tab would start with an empty canvas. The drawing is saved (debounced)
 * to chrome.storage.local and every open editor follows changes made in
 * another one, so hopping between tabs feels like one continuous canvas.
 *
 * Echo protection: each editor has a random `by` id. Remote writes are
 * applied but never re-saved, which prevents ping-pong between instances.
 */

const DRAFT_KEY = "dcCanvasDraft";
const SAVE_DELAY_MS = 400;

const instanceId = Math.random().toString(36).slice(2);

/**
 * @param {{controller: {state:{shapes:object[]}, loadShapes:(s:object[])=>void}}} deps
 * @returns {{schedule:()=>void, restore:()=>Promise<void>}}
 */
export function createAutosave({ controller }) {
  let timer = null;
  let applyingRemote = false;
  let lastSerialized = "";

  async function writeNow() {
    const shapes = controller.state.shapes;
    const serialized = JSON.stringify(shapes);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    try {
      await chrome.storage.local.set({ [DRAFT_KEY]: { by: instanceId, at: Date.now(), shapes } });
    } catch (err) {
      console.warn("[autosave] could not save draft:", err);
    }
  }

  /** Call from the controller's onChange. Cheap: just (re)arms a timer. */
  function schedule() {
    if (applyingRemote) return;
    clearTimeout(timer);
    timer = setTimeout(writeNow, SAVE_DELAY_MS);
  }

  function applyRemote(shapes) {
    if (!Array.isArray(shapes)) return;
    applyingRemote = true;
    lastSerialized = JSON.stringify(shapes);
    controller.loadShapes(shapes);
    applyingRemote = false;
  }

  /** Load the saved draft once at startup. */
  async function restore() {
    try {
      const got = await chrome.storage.local.get(DRAFT_KEY);
      if (got[DRAFT_KEY]?.shapes?.length) applyRemote(got[DRAFT_KEY].shapes);
    } catch { /* storage unavailable: start empty */ }
  }

  // Follow edits made in another editor instance (e.g. on another tab).
  chrome.storage.onChanged.addListener((changes, area) => {
    const draft = area === "local" && changes[DRAFT_KEY]?.newValue;
    if (draft && draft.by !== instanceId) applyRemote(draft.shapes);
  });

  return { schedule, restore };
}
