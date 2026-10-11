/**
 * main.js
 * --------------------------------------------------------------------------
 * Entry point. Deliberately thin: constructs the modules and connects them.
 * The engine doubles as the "viewport" the tools use to convert pointer
 * positions into world coordinates.
 * -------------------------------------------------------------------------- */

import { createCanvasEngine } from "./modules/canvasEngine.js";
import { createToolController } from "./modules/tools.js";
import { wireToolbar } from "./modules/toolbar.js";
import { wireImageImport } from "./modules/imageImport.js";
import { wireViewportControls } from "./modules/viewportControls.js";
import { createLayersPanel } from "./modules/layersPanel.js";
import { createEffectsPanel } from "./modules/effectsPanel.js";
import { createDock } from "./modules/dock.js";
import { createComments } from "./modules/comments.js";
import { createInspectPanel } from "./modules/inspect.js";
import { buildCommands, createActionsPalette } from "./modules/actions.js";
import { topHit } from "./modules/selection.js";
import { wireScreenshotMenu } from "./modules/screenshotMenu.js";
import { wireHoverToggle } from "./modules/hoverToggle.js";
import { createAutosave } from "./modules/autosave.js";
import { createElementPicker } from "./modules/elementPicker.js";
import { wireSideTabs, wirePopover } from "./modules/sidePanel.js";
import { wireRecorder } from "./modules/recorder.js";
import { applyEmbeddedClass } from "./modules/embedMode.js";

applyEmbeddedClass(); // before first paint, so the floating-window layout doesn't flash

/**
 * Design <-> Dev mode. Dev mode is read-only (the controller refuses every edit),
 * hides the editing UI, and shows the Inspect panel with measurements and CSS.
 */
function setMode(mode) {
  document.body.dataset.mode = mode;
  document.getElementById("inspect-panel").classList.toggle("hidden", mode !== "dev");
  if (mode === "dev") document.getElementById("effects-panel").classList.add("hidden");
  window.__uiSketch?.controller.setReadOnly(mode === "dev");
  if (mode === "dev") inspect?.update(window.__uiSketch.controller.state);
}

const canvasEl = document.getElementById("board");
const canvasWrapEl = document.getElementById("canvas-wrap");
const textInputEl = document.getElementById("text-input");

const engine = createCanvasEngine(canvasEl);

let toolbar = null; // assigned below; the controller's first callbacks happen after that
let layers = null;
let effectsPanel = null;
let dock = null;
let imageImport = null;
let palette = null;
let comments = null;
let inspect = null;
let autosave = null;

const controller = createToolController({
  canvasEl,
  textInputEl,
  viewport: engine,
  onCommentRequest: (pt) => comments?.beginDraft(pt),
  onChange: (state) => {
    engine.scheduleRender(state);
    toolbar?.syncFromSelection(state.selection);
    layers?.update(state);
    effectsPanel?.update(state);
    dock?.sync(state.currentTool);
    comments?.update(state);
    autosave?.schedule();
    if (document.body.dataset.mode === "dev") inspect?.update(state);
  },
});

toolbar = wireToolbar({ controller, engine });
inspect = createInspectPanel({ panelEl: document.getElementById("inspect-panel"), controller });
comments = createComments({ wrapEl: canvasWrapEl, popEl: document.getElementById("comment-popover"), controller, engine });
layers = createLayersPanel({ listEl: document.getElementById("layers-list"), controller });

// Right-click a shape on the canvas: same menu as the layers list (arrange, group, rename, lock, hide, delete).
canvasEl.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const pt = engine.toWorld(e.clientX, e.clientY);
  const hit = topHit(controller.state.shapes, pt.x, pt.y, 6 / engine.getScale(), engine.getScale());
  if (!hit) return;
  if (!controller.state.selectedIds.includes(hit.id)) controller.select([hit.id], { expand: true });
  layers.openMenuAt(e.clientX, e.clientY, hit);
});
effectsPanel = createEffectsPanel({
  panelEl: document.getElementById("effects-panel"),
  buttonEl: document.getElementById("effects-btn"),
  countEl: document.getElementById("effects-count"),
  controller,
});
wireViewportControls({ canvasEl, engine, getShapes: () => controller.state.shapes, getTool: () => controller.state.currentTool });
imageImport = wireImageImport({
  canvasWrapEl, canvasEl, controller, viewport: engine, pickerEl: document.getElementById("image-picker"),
});

const shotStatus = document.getElementById("screenshot-status");
const elementPicker = createElementPicker({ imageImport, say: (t) => { shotStatus.textContent = t; clearTimeout(shotStatus._t); shotStatus._t = setTimeout(() => { shotStatus.textContent = ""; }, 5000); } });
wireScreenshotMenu({
  buttonEl: document.getElementById("screenshot-btn"),
  menuEl: document.getElementById("screenshot-menu"),
  statusEl: document.getElementById("screenshot-status"),
  imageImport,
  elementPicker,
});

dock = createDock({
  rootEl: document.getElementById("dock"),
  controller,
  onAction: (action) => { if (action === "image") imageImport.pick(); },
  onOpenActions: () => palette.open(),
  onMode: (mode) => setMode(mode),
});

// Draft autosave + cross-tab sync (needed by the hover window), then the hover button.
autosave = createAutosave({ controller });
autosave.restore();
wireSideTabs(document.getElementById("side"));
wirePopover({ buttonEl: document.getElementById("agent-settings-btn"), popoverEl: document.getElementById("agent-popover") });
wireRecorder();
wireHoverToggle({ buttonEl: document.getElementById("hover-mode-btn") });

engine.scheduleRender(controller.state);
layers.update(controller.state);
toolbar.syncFromSelection(controller.state.selection);

// Debug/test hook: lets automated tests drive the editor. Nothing in the app reads it.
window.__uiSketch = { controller, engine };

// Actions menu (Ctrl/Cmd+K, or the grid button in the dock).
const togglePanel = (id) => document.getElementById(id).classList.toggle("hidden");
palette = createActionsPalette({
  modalEl: document.getElementById("actions-modal"),
  inputEl: document.getElementById("actions-input"),
  listEl: document.getElementById("actions-list"),
  commands: buildCommands({
    controller, engine,
    ui: {
      pickImage: () => imageImport.pick(),
      toggle: (name) => togglePanel(name === "layers" ? "side" : "effects-panel"),
      setMode: (mode) => dock.setMode(mode),
      exportNow: () => document.getElementById("export-btn").click(),
    },
  }),
});
