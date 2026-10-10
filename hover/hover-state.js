/**
 * hover-state.js  (content script 2/5)
 * --------------------------------------------------------------------------
 * Where the floating window lives and whether it is minimized.
 * Persisted in chrome.storage.local so the window keeps its place when you
 * switch tabs (every tab reads the same state, and changes sync live).
 *
 * Pure helpers (defaultState, clampRect, normalize) have no DOM access so
 * they are trivial to test.
 * -------------------------------------------------------------------------- */
(function () {
  const ns = self.__dcHover;
  const { STATE_KEY, MIN_W, MIN_H, BUBBLE, EDGE } = ns.config;

  /** First-run layout: window top-right, bubble bottom-right. */
  function defaultState(vw, vh) {
    const w = Math.min(960, Math.round(vw * 0.8));
    const h = Math.min(640, Math.round(vh * 0.8));
    return {
      minimized: true,
      panel: { x: Math.max(EDGE, vw - w - 24), y: 24, w, h },
      bubble: { x: vw - BUBBLE - 24, y: vh - BUBBLE - 24 },
    };
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  /**
   * Keeps a rect inside the viewport. Rects with w/h (the window) are also
   * held above the minimum size; point-like rects (the bubble) are not.
   */
  function clampRect(r, vw, vh) {
    const sized = r.w != null && r.h != null;
    const w = sized ? clamp(r.w, MIN_W, vw - EDGE) : BUBBLE;
    const h = sized ? clamp(r.h, MIN_H, vh - EDGE) : BUBBLE;
    // Always leave a grabbable strip on screen, even if the window is dragged past an edge.
    const x = clamp(r.x, EDGE - w + 80, vw - 80);
    const y = clamp(r.y, 0, vh - 40);
    return sized ? { x, y, w, h } : { x, y };
  }

  /** Repairs anything read from storage (missing keys, off-screen, wrong types). */
  function normalize(saved, vw, vh) {
    const base = defaultState(vw, vh);
    const s = saved && typeof saved === "object" ? saved : {};
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    const p = s.panel || {}, b = s.bubble || {};
    return {
      minimized: typeof s.minimized === "boolean" ? s.minimized : base.minimized,
      panel: clampRect({ x: num(p.x, base.panel.x), y: num(p.y, base.panel.y), w: num(p.w, base.panel.w), h: num(p.h, base.panel.h) }, vw, vh),
      bubble: clampRect({ x: num(b.x, base.bubble.x), y: num(b.y, base.bubble.y) }, vw, vh),
    };
  }

  async function loadState() {
    try {
      const got = await chrome.storage.local.get(STATE_KEY);
      return normalize(got[STATE_KEY], innerWidth, innerHeight);
    } catch {
      return defaultState(innerWidth, innerHeight);
    }
  }

  function saveState(state) {
    try { chrome.storage.local.set({ [STATE_KEY]: state }); } catch { /* extension reloaded: ignore */ }
  }

  ns.state = { defaultState, clampRect, normalize, loadState, saveState };
})();
