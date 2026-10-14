/** visual-diff.test.mjs — image comparison maths: identical, changed region, size change, baselines. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ROOT } from "../helpers/paths.mjs";
process.env.STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dc-vd-"));
const { PNG } = await import(ROOT + "/server/node_modules/pngjs/lib/png.js");
const vd = await import(ROOT + "/server/visual-diff.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

/** A white image with optional filled rectangles. */
const make = (w, h, boxes = []) => { const p = new PNG({ width: w, height: h }); p.data.fill(255);
  for (const [bx, by, bw, bh, c] of boxes) for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) { const i = (y * w + x) * 4; p.data[i] = c[0]; p.data[i + 1] = c[1]; p.data[i + 2] = c[2]; }
  return PNG.sync.write(p); };

const a = make(400, 300, [[50, 50, 100, 40, [30, 30, 200]]]);
let r = vd.diffPng(a, a); t("identical images: 0% changed, no regions", r.changedPercent === 0 && r.regions.length === 0);
const b = make(400, 300, [[50, 50, 100, 40, [30, 30, 200]], [250, 200, 80, 60, [220, 40, 40]]]);
r = vd.diffPng(a, b); t("a new box is found as one region", r.regions.length === 1, JSON.stringify(r.regions));
t("region covers the new box (x≈250,y≈200)", r.regions[0].x <= 250 && r.regions[0].y <= 200 && r.regions[0].x + r.regions[0].w >= 330 && r.regions[0].y + r.regions[0].h >= 260);
t("changed percent matches the box area", Math.abs(r.changedPercent - 100 * 80 * 60 / (400 * 300)) < 0.1, String(r.changedPercent));
const c = make(400, 300, [[50, 50, 100, 40, [34, 30, 200]]]); t("tiny colour noise under tolerance is ignored", vd.diffPng(a, c).changedPercent === 0);
const d = make(400, 300, [[50, 50, 100, 40, [30, 30, 200]], [20, 20, 30, 30, [0, 0, 0]], [300, 20, 30, 30, [0, 0, 0]]]); t("two separate changes = two regions", vd.diffPng(a, d).regions.length === 2);
r = vd.diffPng(a, make(400, 380, [[50, 50, 100, 40, [30, 30, 200]]])); t("a taller page is reported as a size change", r.sizeChanged && r.currentSize.height === 380 && r.changedPercent > 0);
t("diff image is a valid PNG of the new size", PNG.sync.read(r.diffPng).height === 380);
t("no baseline yet -> null", vd.readBaseline("home") === null);
vd.saveBaseline("home", a); t("baseline round-trips", vd.readBaseline("home").buffer.equals(a));
vd.saveBaseline("../../evil name", a); t("baseline names can't escape the folder", fs.readdirSync(path.join(process.env.STORE_DIR, "baselines")).every((f) => !f.includes("/") && f.endsWith(".png")));
for (const [ok, n] of out) console.log((ok ? "PASS " : "FAIL ") + n); process.exit(out.every((o) => o[0]) ? 0 : 1);
