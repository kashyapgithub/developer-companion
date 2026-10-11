/**
 * sketchOverlay.js — the "Overlay" toolbar button.
 *
 * Renders the sketch (or the selected frame) as a transparent PNG and asks the
 * service worker to float it, semi-transparent, over the web page you were
 * just on. Click again to remove it.
 */

import { exportScope } from "./exportScope.js";

const PAGE_ORIGINS = ["http://*/*", "https://*/*"];
const DEFAULT_OPACITY = 0.5;

/** @param {{buttonEl:HTMLElement, controller:object, engine:object, onToast?:(msg:string,type?:string)=>void}} deps */
export function wireSketchOverlay({ buttonEl, controller, engine, onToast = () => {} }) {
  if (!buttonEl) return;
  let shown = false;

  const send = (message) => chrome.runtime.sendMessage(message);
  const paint = () => {
    buttonEl.classList.toggle("active", shown);
    buttonEl.setAttribute("aria-pressed", String(shown));
    buttonEl.querySelector(".lbl").textContent = shown ? "Overlay: on" : "Overlay";
  };

  /** Transparent PNG of what the agent would receive (selected frame, else everything). */
  function renderSketch() {
    const { shapes, region } = exportScope(controller.state.shapes, controller.state.selection);
    if (!shapes.length) return null;
    const { canvas, preview } = engine.renderExport(shapes, { region, background: "transparent", padding: 0, pixelRatio: 2 });
    return { dataUrl: canvas.toDataURL("image/png"), pixelRatio: preview.pixelRatio };
  }

  buttonEl.addEventListener("click", async () => {
    if (shown) {
      await send({ type: "SKETCH_OVERLAY_HIDE" });
      shown = false; paint();
      return;
    }
    const sketch = renderSketch();
    if (!sketch) { onToast("Draw something first, then overlay it on your page.", "error"); return; }
    // Page access is granted once (shared with Hover mode); it must be asked from the click.
    if (!(await chrome.permissions.contains({ origins: PAGE_ORIGINS })) && !(await chrome.permissions.request({ origins: PAGE_ORIGINS }))) {
      onToast("The overlay needs permission to show over web pages.", "error");
      return;
    }
    const res = await send({ type: "SKETCH_OVERLAY_SHOW", ...sketch, opacity: DEFAULT_OPACITY });
    if (!res?.ok) { onToast(res?.error || "Couldn't show the overlay.", "error"); return; }
    shown = true; paint();
    onToast("Overlay is on the page — use the slider there to compare.", "info");
  });

  paint();
}
