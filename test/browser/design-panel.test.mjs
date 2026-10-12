/** The Design panel only shows controls that apply to the selected shape. */
import fs from "node:fs";
import { launchPlain, ROOT } from "../helpers/launch.mjs";
const B = "http://127.0.0.1:8777";
const stub = fs.readFileSync(ROOT + "/test/browser/layer-delete.test.mjs", "utf8").split("\n")[2].replace(/^const stub=`/, "").replace(/`;$/, "").replace(/\$\{B\}/g, B);
const b = await launchPlain(); const p = await b.newPage(); await p.setViewport({ width: 1440, height: 860 });
await p.evaluateOnNewDocument(stub); await p.goto(B + "/ext/editor/editor.html"); await new Promise((r) => setTimeout(r, 1000));
const R = []; const t = (n, c, x = "") => R.push([c, n + (x ? " — " + x : "")]);

/** Which of the type-specific controls are visible right now. */
const visible = () => p.evaluate(() => Object.fromEntries(["elbow-enabled", "corner-radius", "font-size", "shape-count", "shape-inner"]
  .map((id) => [id, !document.getElementById(id).closest(".row, label.num").hidden])));
/** Selects one new shape of `type` and waits for the panel to react. */
const select = async (type) => {
  await p.evaluate(async (type) => {
    const m = await import("./modules/shapes.js"); const c = window.__uiSketch.controller;
    const s = m.createShape(type, { x: 50, y: 50, w: 100, h: 80, text: "Hi" }); c.addShape(s); c.state.selectedIds = [s.id]; c.notify?.();
    window.__uiSketch.engine.scheduleRender(c.state);
  }, type);
  await new Promise((r) => setTimeout(r, 300));
};

let v = await visible();
t("nothing selected: only common controls", !Object.values(v).some(Boolean), JSON.stringify(v));
await select("rect"); v = await visible(); t("rectangle: radius yes, points no", v["corner-radius"] && !v["shape-count"] && !v["elbow-enabled"]);
await select("star"); v = await visible(); t("star: points and inner radius, no corner radius", v["shape-count"] && v["shape-inner"] && !v["corner-radius"]);
await select("text"); v = await visible(); t("text: font size, no points", v["font-size"] && !v["shape-count"]);
t("Shape & text section is shown when it has fields", await p.evaluate(() => !document.getElementById("font-size").closest(".sec").hidden));
await b.close();
for (const [c, n] of R) console.log((c ? "PASS " : "FAIL ") + n);
