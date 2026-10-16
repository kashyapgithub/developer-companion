/**
 * motion.js — wires the 3D motion window together.
 *
 *   state (scene-state.js)  ·  pointers (interaction.js)  ·  drawing (renderer.js)
 *   curve cards (curve-list.js)  ·  toolbar + persistence + send (this file)
 */

import { createScene, createHistory, selectedCurve, toSaved, applySaved } from "./modules/scene-state.js";
import { attachInteraction } from "./modules/interaction.js";
import { render, fitCanvas } from "./modules/renderer.js";
import { createCurveList } from "./modules/curve-list.js";
import { createCamera } from "./modules/camera.js";
import { buildMotionDoc } from "./modules/curve-css.js";
import { sendMotion } from "./modules/motion-api.js";
import { PLANES } from "./modules/plane-hit.js";

const $ = (id) => document.getElementById(id);
const SAVE_KEY = "dcMotionScene";
const HINTS = {
  draw: "Draw: press and drag on the plane. Shift+drag continues the selected curve (switch plane first to bend it into 3D). Right-drag turns the view, wheel zooms.",
  points: "Points: click to place points, double-click or Enter to finish, Backspace removes the last, Esc cancels.",
  edit: "Edit: drag a white point of the selected curve. It moves on the chosen plane, so change the plane to move it in another direction.",
  orbit: "Orbit: drag to turn the view, wheel to zoom.",
};

const scene = createScene();
const history = createHistory(scene);
const canvas = $("view");
let saveTimer = null;

// ---- drawing --------------------------------------------------------------------------------
const redraw = () => { fitCanvas(canvas); render(canvas, scene); };
const list = createCurveList($("curves"), scene, {
  redraw, changed: () => changed(), select: (id) => { scene.selectedId = id; list.render(); redraw(); },
  remove: (id) => { scene.curves = scene.curves.filter((c) => c.id !== id); if (scene.selectedId === id) scene.selectedId = scene.curves.at(-1)?.id || ""; history.commit(); changed(true); },
});

/** After any edit: redraw, refresh the preview and save. `structural` rebuilds the cards too. */
function changed(structural = false) {
  if (structural) list.render();
  redraw(); updateSendState(); scheduleSave();
}

function updateSendState() {
  const doc = buildMotionDoc(scene);
  $("send").disabled = !doc.curves.length;
  $("css-preview").textContent = doc.curves.map((c) => `${c.summary}\n${c.keyframes}\n.${c.animationName.replace("motion-", "")} { ${c.animationRule} }`).join("\n\n");
}

// ---- toolbar ---------------------------------------------------------------------------------
function setTool(tool) {
  scene.tool = tool; scene.draft = null; canvas.dataset.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
  $("hint").textContent = HINTS[tool]; redraw();
}
document.querySelectorAll("button[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
$("plane").addEventListener("change", (e) => { scene.plane = e.target.value; redraw(); scheduleSave(); });
$("offset").addEventListener("input", (e) => { scene.offset = Number(e.target.value); $("offset-out").textContent = String(scene.offset); redraw(); });
$("guides").addEventListener("change", (e) => { scene.guides = e.target.checked; redraw(); scheduleSave(); });
$("perspective").addEventListener("input", (e) => { scene.perspective = Math.max(100, Number(e.target.value) || 800); updateSendState(); scheduleSave(); });
for (const [id, key] of [["stage-w", "w"], ["stage-h", "h"]]) $(id).addEventListener("input", (e) => { scene.stage[key] = Math.max(20, Number(e.target.value) || 100); redraw(); updateSendState(); scheduleSave(); });
$("notes").addEventListener("input", (e) => { scene.notes = e.target.value; scheduleSave(); });
$("undo").addEventListener("click", undo);
$("reset-view").addEventListener("click", () => { scene.camera = createCamera(); redraw(); });
$("clear").addEventListener("click", () => { if (!scene.curves.length) return; scene.curves = []; scene.selectedId = ""; history.commit(); changed(true); });

function undo() { if (history.undo()) changed(true); }
document.addEventListener("keydown", (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  if ((e.key === "Delete" || e.key === "Backspace") && !scene.draft && selectedCurve(scene)) { const id = scene.selectedId; scene.curves = scene.curves.filter((c) => c.id !== id); scene.selectedId = scene.curves.at(-1)?.id || ""; history.commit(); changed(true); }
});

// ---- sending -----------------------------------------------------------------------------------
const say = (text, cls = "") => { $("status").textContent = text; $("status").className = cls; };
$("send").addEventListener("click", async () => {
  const doc = buildMotionDoc(scene);
  $("send").disabled = true; say("Sending…");
  try {
    const draft = scene.draft; scene.draft = null;
    fitCanvas(canvas); render(canvas, scene, { forExport: true });
    const png = canvas.toDataURL("image/png").split(",")[1];
    scene.draft = draft; redraw();
    await sendMotion(doc, png);
    say(`Sent ${doc.curves.length} curve${doc.curves.length > 1 ? "s" : ""} to your agent.`, "ok");
  } catch (err) { say(err.message || "Couldn't send.", "err"); }
  finally { updateSendState(); }
});

// ---- persistence (so closing the window loses nothing) -----------------------------------------
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => chrome.storage?.local.set({ [SAVE_KEY]: toSaved(scene) }).catch(() => {}), 300); }

function syncControls() {
  $("plane").value = scene.plane; $("offset").value = scene.offset; $("offset-out").textContent = String(scene.offset);
  $("guides").checked = scene.guides; $("perspective").value = scene.perspective; $("stage-w").value = scene.stage.w; $("stage-h").value = scene.stage.h; $("notes").value = scene.notes;
}

attachInteraction(canvas, scene, { redraw, changed: () => changed(), committed: () => { history.commit(); changed(true); } });
new ResizeObserver(redraw).observe(canvas);
setTool("draw");

chrome.storage?.local.get(SAVE_KEY).then((r) => { applySaved(scene, r?.[SAVE_KEY]); if (!(scene.plane in PLANES)) scene.plane = "front"; history.reset(); syncControls(); changed(true); }).catch(() => changed(true));

/** Handle for tests and debugging. */
window.__dcMotion = { scene, redraw, changed, setTool, history, buildMotionDoc: () => buildMotionDoc(scene) };
