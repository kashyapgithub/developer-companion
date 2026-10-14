/**
 * handoff.test.mjs — export a populated store, import it into an EMPTY store, compare.
 * STORE_DIR is switched between two temp dirs (config reads it per call).
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ROOT } from "../helpers/paths.mjs";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "dc-ha-")); const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "dc-hb-"));
process.env.STORE_DIR = dirA;
const store = await import(ROOT + "/server/storage.js");
const insp = await import(ROOT + "/server/inspiration.js");
const h = await import(ROOT + "/server/handoff.js");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG = "iVBORw0KGgo=";

// -- populate store A
store.writeSketch({ json: { shapes: [{ type: "rect" }] }, pngBase64: PNG.split(",")[1] });
store.writeXray({ page: { url: "http://x" }, elements: [{ selector: "button#a", screenshot: PNG }] });
store.writeVideoReview({ id: "video-1", durationSeconds: 5, moments: [{ at: "00:02", expected: "blue", actual: "grey", annotations: "1 arrow", frame: "data:image/jpeg;base64," + JPG }] });
const f = insp.createFolder("Dashboards"); insp.addItem({ dataUrl: PNG, title: "Linear", folder: f.id, note: "nice" }); insp.addItem({ dataUrl: PNG, title: "Loose" });

const bundle = JSON.parse(JSON.stringify(h.buildBundle()));
const d = h.describeBundle(bundle);
t("bundle labelled and versioned", bundle.format === h.BUNDLE_FORMAT && bundle.version === 1);
t("bundle lists every part", d.sketch && d.xray_elements === 1 && d.video_moments === 1 && d.inspiration_images === 2, JSON.stringify(d));
t("video file is not in the bundle", !("video_file" in bundle.video.doc));
t("include inspiration:false leaves it out", h.buildBundle({ inspiration: false }).inspiration === null);

// -- validation
let err = ""; try { h.validateBundle({ format: "nope" }); } catch (e) { err = e.message; }
t("foreign file refused", /isn't a Developer Companion/.test(err));
err = ""; try { h.validateBundle({ format: h.BUNDLE_FORMAT, version: 99 }); } catch (e) { err = e.message; }
t("newer version refused", /newer version/.test(err));

// -- import into empty store B
process.env.STORE_DIR = dirB;
t("store B starts empty", store.readSketch() === null || !fs.existsSync(path.join(dirB, "inspiration")));
const r = h.importBundle(bundle);
t("import reports every part", r.imported.sketch === true && r.imported.xray_elements === 1 && r.imported.video_moments === 1 && r.imported.inspiration_images === 2 && r.problems.length === 0, JSON.stringify(r));
t("sketch restored", store.readSketch().json.shapes[0].type === "rect");
const x = store.readXray(); t("xray crop restored", x.doc.elements[0].selector === "button#a" && x.images[0]?.length > 20);
const v = store.readVideoReview(); t("video notes + frame restored", v.doc.moments[0].expected === "blue" && v.doc.moments[0].annotations === "1 arrow" && v.frames[0] === JPG);
const lib = insp.listLibrary();
t("inspiration folder + items restored", lib.folders.length === 1 && lib.folders[0].name === "Dashboards" && lib.items.length === 2);
t("item stays in its folder with its note", lib.items.find((i) => i.title === "Linear").folder === lib.folders[0].id && lib.items.find((i) => i.title === "Linear").note === "nice");
t("loose item stays unsorted", lib.items.find((i) => i.title === "Loose").folder === "");

// -- importing twice must not duplicate the library
const again = h.importBundle(bundle);
t("second import adds no duplicate images", again.imported.inspiration_images === 0 && insp.listLibrary().items.length === 2, JSON.stringify(again.imported));

// -- one bad part doesn't block the others
const broken = JSON.parse(JSON.stringify(bundle)); broken.inspiration.items = [{ id: "z", title: "bad", folder: "" }]; broken.inspiration.images = { z: { mime: "text/html", base64: "AAAA" } };
const rb = h.importBundle(broken);
t("a bad part is reported, the rest still import", rb.problems.length === 1 && /inspiration/.test(rb.problems[0]) && rb.imported.sketch === true, JSON.stringify(rb));

// -- file saving
const file = h.saveBundleFile(bundle, path.join(dirB, "handoffs"));
t("bundle file written and re-readable", JSON.parse(fs.readFileSync(file, "utf8")).format === h.BUNDLE_FORMAT);
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
