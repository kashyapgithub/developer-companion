/** annotate-model.test.mjs — stroke geometry, filtering of accidental clicks, undo and descriptions. */
import { toNormalised, createStrokeList, isMeaningful, arrowHead, describeStrokes } from "../../video/annotate-model.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const rect = { left: 100, top: 50, width: 200, height: 100 };
t("pointer maps to 0..1", JSON.stringify(toNormalised(200, 100, rect)) === '{"x":0.5,"y":0.5}');
t("outside the box is clamped", toNormalised(0, 999, rect).x === 0 && toNormalised(0, 999, rect).y === 1);
t("a click is not an arrow", !isMeaningful({ tool: "arrow", points: [{ x: .5, y: .5 }, { x: .5, y: .5 }] }));
t("a drag is an arrow", isMeaningful({ tool: "arrow", points: [{ x: .1, y: .1 }, { x: .5, y: .5 }] }));
t("a two-point pen is a dot, dropped", !isMeaningful({ tool: "pen", points: [{ x: .1, y: .1 }, { x: .1, y: .1 }] }));
const l = createStrokeList();
t("add keeps real strokes", l.add({ tool: "box", color: "#f00", points: [{ x: 0, y: 0 }, { x: .4, y: .4 }] }) && l.count === 1);
t("add refuses tiny strokes", !l.add({ tool: "box", color: "#f00", points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }) && l.count === 1);
t("undo removes the last", l.undo().tool === "box" && l.count === 0);
t("undo on empty is safe", l.undo() === null);
const [h1, h2] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
t("arrow head sits behind the tip, symmetric", h1.x < 100 && h2.x < 100 && Math.abs(h1.y + h2.y) < 1e-9);
t("description counts per tool", describeStrokes([{ tool: "arrow" }, { tool: "arrow" }, { tool: "box" }]) === "2 arrows, 1 box");
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
