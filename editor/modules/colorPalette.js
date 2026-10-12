/**
 * colorPalette.js — quick colour swatches for a native <input type="color">.
 *
 * Each palette renders three things into its container:
 *   1. a row of preset swatches,
 *   2. a row of recently used colours (remembered in localStorage),
 *   3. an eyedropper button (only where the browser supports EyeDropper).
 *
 * Picking a swatch writes the value into the colour input and fires a normal
 * "input" event, so the existing style wiring (toolbar.js) applies it to the
 * selection and to the next shape — no special cases.
 */

/** Preset colours: neutrals first, then a spread of hues. */
export const PRESET_COLORS = [
  "#1b1c20", "#6b7280", "#d1d5db", "#ffffff",
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
];

const RECENT_KEY = "dc-recent-colors";
const MAX_RECENT = 8;

// ---- recent colours (shared by every palette) -----------------------------------

/** Reads the recent list; storage can be blocked, so failures mean "empty". */
function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

function saveRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage blocked: skip */ }
}

/** Moves `color` to the front of the recent list (no duplicates, capped). */
export function rememberColor(color) {
  const c = String(color).toLowerCase();
  const list = [c, ...loadRecent().filter((x) => x.toLowerCase() !== c)].slice(0, MAX_RECENT);
  saveRecent(list);
  return list;
}

// ---- DOM helpers ----------------------------------------------------------------

/** One clickable colour dot. */
function swatch(color, onPick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.style.background = color;
  b.title = color;
  b.setAttribute("aria-label", `Color ${color}`);
  b.dataset.color = color;
  b.addEventListener("click", () => onPick(color));
  return b;
}

/** Eyedropper button, or null when the browser has no EyeDropper API. */
function eyedropperButton(onPick) {
  if (typeof EyeDropper === "undefined") return null;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch eyedropper";
  b.title = "Pick a color from the screen";
  b.setAttribute("aria-label", "Eyedropper");
  b.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 2.5l3 3-1.2 1.2-3-3zM9 4l-6 6v3h3l6-6"/></svg>';
  b.addEventListener("click", async () => {
    try { onPick((await new EyeDropper().open()).sRGBHex); } catch { /* user pressed Esc */ }
  });
  return b;
}

// ---- public ---------------------------------------------------------------------

/**
 * Builds a palette into `container` that drives `input` (a colour input).
 * Returns { refreshRecent } so tests/other code can force a redraw.
 */
export function createColorPalette(container, input) {
  const presets = document.createElement("div");
  presets.className = "swatch-row";
  const recent = document.createElement("div");
  recent.className = "swatch-row recent";

  /** Sets the input and lets the normal "input" listeners apply it. */
  const pick = (color) => {
    input.value = color;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    rememberColor(color);
    refreshRecent();
  };

  function refreshRecent() {
    recent.replaceChildren(...loadRecent().map((c) => swatch(c, pick)));
    recent.hidden = recent.childElementCount === 0;
  }

  presets.append(...PRESET_COLORS.map((c) => swatch(c, pick)));
  const dropper = eyedropperButton(pick);
  if (dropper) presets.append(dropper);

  // Colours chosen with the native picker count as "recent" once the picker closes.
  input.addEventListener("change", () => { rememberColor(input.value); refreshRecent(); });

  container.append(presets, recent);
  refreshRecent();
  return { refreshRecent };
}
