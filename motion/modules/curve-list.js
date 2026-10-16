/**
 * curve-list.js — the side list: one card per curve with its colour, label, what moves,
 * duration, easing, loop and visibility.
 *
 * Cards are rebuilt only when curves are added / removed / selected; typing in a field edits the
 * curve in place and just asks for a redraw, so focus is never lost.
 */

import { el, fill } from "../../api/modules/dom.js";
import { EASINGS } from "./curve-model.js";
import { describeMove } from "./curve-css.js";
import { sub } from "./vec3.js";

/**
 * @param {HTMLElement} container
 * @param {object} scene
 * @param {{ redraw(): void, changed(): void, select(id: string): void, remove(id: string): void }} hooks
 */
export function createCurveList(container, scene, hooks) {
  function card(curve) {
    const move = curve.points.length >= 2 ? describeMove(sub(curve.points.at(-1), curve.points[0])) : "draw something first";
    const field = (label, input) => el("label", { class: "cf" }, el("span", {}, label), input);
    const edit = (key, parse = (x) => x) => (e) => { curve[key] = parse(e.target.value); hooks.changed(); };
    return el("div", { class: `curve-card${curve.id === scene.selectedId ? " selected" : ""}`, "data-id": curve.id, style: `--c:${curve.color}`, onclick: () => hooks.select(curve.id) },
      el("div", { class: "cc-head" },
        el("input", { type: "color", value: curve.color, title: "Curve colour", onclick: (e) => e.stopPropagation(), oninput: (e) => { curve.color = e.target.value; hooks.changed(); e.target.closest(".curve-card").style.setProperty("--c", curve.color); } }),
        el("input", { class: "cc-label", value: curve.label, placeholder: "Label", spellcheck: "false", onclick: (e) => e.stopPropagation(), oninput: edit("label") }),
        el("button", { class: "icon", title: curve.visible === false ? "Show" : "Hide", onclick: (e) => { e.stopPropagation(); curve.visible = curve.visible === false; hooks.changed(); render(); } }, curve.visible === false ? "◌" : "●"),
        el("button", { class: "icon", title: "Delete this curve", onclick: (e) => { e.stopPropagation(); hooks.remove(curve.id); } }, "✕")),
      el("div", { class: "cc-move" }, move),
      el("div", { class: "cc-grid", onclick: (e) => e.stopPropagation() },
        field("What moves", el("input", { value: curve.target, placeholder: ".card, logo, camera…", spellcheck: "false", oninput: edit("target") })),
        field("Duration (ms)", el("input", { type: "number", min: 50, max: 20000, step: 50, value: curve.durationMs, oninput: edit("durationMs", (x) => Math.max(50, Number(x) || 800)) })),
        field("Easing", el("select", { onchange: edit("easing") }, EASINGS.map((o) => el("option", { value: o, selected: o === curve.easing }, o)))),
        el("label", { class: "cf check" }, el("input", { type: "checkbox", checked: curve.loop, onchange: (e) => { curve.loop = e.target.checked; hooks.changed(); } }), el("span", {}, "Loop forever")),
        el("label", { class: "cf wide" }, el("span", {}, "Notes for the agent"), el("input", { value: curve.notes, placeholder: "e.g. fast start, settles softly", spellcheck: "false", oninput: edit("notes") }))));
  }

  function render() {
    fill(container, scene.curves.length ? scene.curves.map(card) : el("p", { class: "empty-hint" }, "No curves yet. Pick Draw and drag on the canvas, or Points and click."));
  }
  return { render };
}
