/** inspiration.test.mjs — the library's storage rules: folders, items, moves, search, bad input. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ROOT } from "../helpers/paths.mjs";
process.env.STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dc-insp-"));
const lib = await import(ROOT + "/server/inspiration.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

t("starts empty", lib.listLibrary().items.length === 0);
const f = lib.createFolder("Dashboards"); t("creates a folder", f.name === "Dashboards" && !!f.id);
t("same name (any case) reuses the folder", lib.createFolder("dashboards").id === f.id && lib.listLibrary().folders.length === 1);
let threw = false; try { lib.createFolder("  "); } catch { threw = true; } t("blank folder name rejected", threw);

const a = lib.addItem({ dataUrl: PNG, title: "Linear board", url: "https://linear.app", note: "nice dense table", folder: f.id });
const b = lib.addItem({ dataUrl: PNG, title: "Stripe pricing", url: "https://stripe.com/pricing" });
t("items saved with file on disk", fs.existsSync(path.join(process.env.STORE_DIR, "inspiration", a.file)));
t("newest first; unknown folder falls back to Unsorted", lib.listLibrary().items[0].id === b.id && b.folder === "");
const L = lib.listLibrary(); t("folder counts", L.folders[0].count === 1 && L.unsorted === 1, JSON.stringify([L.folders[0].count, L.unsorted]));
t("image bytes read back", lib.readItemImage(a.id).mime === "image/png" && lib.readItemImage(a.id).buffer.length > 20);

threw = false; try { lib.addItem({ dataUrl: "data:text/html;base64,AAAA", title: "x" }); } catch { threw = true; } t("non-image refused", threw);
threw = false; try { lib.addItem({ dataUrl: "data:image/svg+xml;base64,AAAA", title: "x" }); } catch { threw = true; } t("SVG refused (can carry scripts)", threw);

lib.updateItem(b.id, { folder: f.id, note: "pricing page layout" });
t("move + note update", lib.listLibrary().items.find((i) => i.id === b.id).folder === f.id && lib.searchItems({ folder: "Dashboards" }).items.length === 2);
threw = false; try { lib.updateItem(b.id, { folder: "nope" }); } catch { threw = true; } t("move to a missing folder refused", threw);

t("search by folder name, case-insensitive", lib.searchItems({ folder: "DASHBOARDS" }).items.length === 2);
t("search by text in note/title/url", lib.searchItems({ query: "pricing" }).items.length === 1 && lib.searchItems({ query: "linear.app" }).items.length === 1);
t("unknown folder -> nothing", lib.searchItems({ folder: "ghost" }).items.length === 0);

lib.renameFolder(f.id, "Dense UIs"); t("rename folder", lib.searchItems({ folder: "Dense UIs" }).items.length === 2);
lib.deleteFolder(f.id); t("deleting a folder keeps its images (moved to Unsorted)", lib.listLibrary().items.length === 2 && lib.listLibrary().unsorted === 2);
t("delete item removes the file", lib.deleteItem(a.id) && !fs.existsSync(path.join(process.env.STORE_DIR, "inspiration", a.file)) && lib.listLibrary().items.length === 1);
fs.writeFileSync(path.join(process.env.STORE_DIR, "inspiration", "index.json"), "{broken"); t("corrupt index -> empty library, no crash", lib.listLibrary().items.length === 0);

for (const [ok, n] of out) console.log((ok ? "PASS " : "FAIL ") + n); process.exit(out.every((o) => o[0]) ? 0 : 1);
