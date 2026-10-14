/** watch-console.test.mjs — cursor queries and the long-poll wait behind watch_console. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { ROOT } from "../helpers/paths.mjs";
process.env.STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dc-wc-"));
const store = await import(ROOT + "/server/storage.js");
const wc = await import(ROOT + "/server/watch-console.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const add = (message, level = "info", app = "localhost", environment = "browser") => store.insertLogs({ app_name: app, environment, level, message });

t("empty store starts at cursor 0", store.latestLogId() === 0);
add("one"); add("two", "warn"); add("three", "error"); add("from server", "info", "api", "server");
const all = store.queryLogsAfter(0);
t("rows come oldest first", all.map((r) => r.message).join() === "one,two,three,from server");
const cur = all[1].id;
t("cursor returns only newer rows", store.queryLogsAfter(cur).map((r) => r.message).join() === "three,from server");
t("environment filter keeps browser rows only", store.queryLogsAfter(0, { environment: "browser" }).length === 3);
t("app filter", store.queryLogsAfter(0, { app: "api" }).length === 1);
t("level filter", store.queryLogsAfter(0, { levels: ["error"] }).map((r) => r.message).join() === "three");
t("limit", store.queryLogsAfter(0, { limit: 2 }).length === 2);
t("latestLogId is the newest id", store.latestLogId() === all[3].id);

t("pickLevels warn -> warn,error,fatal", wc.pickLevels("warn").join() === "warn,error,fatal");
t("pickLevels unknown -> undefined", wc.pickLevels("loud") === undefined && wc.pickLevels() === undefined);
const line = wc.formatLine({ created_at: "2026-10-14T12:03:41.220Z", level: "error", app_name: "localhost", message: "boom", stack_trace: "a\nb\nc\nd\ne\nf" });
t("line format: time, level, app, message", line.startsWith("12:03:41.220 error [localhost] boom"));
t("error lines carry a short stack", line.split("\n").length === 1 + 4);
t("info lines carry no stack", wc.formatLine({ created_at: "2026-10-14T12:03:41.220Z", level: "info", app_name: "x", message: "m", stack_trace: "s" }).split("\n").length === 1);

// Long poll
let t0 = Date.now(); let rows = await wc.waitForRows(all[3].id, {}, 300, { poll: 50 });
t("waits the full time when nothing happens", rows.length === 0 && Date.now() - t0 >= 280, String(Date.now() - t0));
t0 = Date.now(); setTimeout(() => add("late arrival"), 250);
rows = await wc.waitForRows(all[3].id, {}, 5000, { poll: 50 });
t("returns as soon as something arrives (not after the full wait)", rows.length === 1 && rows[0].message === "late arrival" && Date.now() - t0 < 1500, String(Date.now() - t0));
t("returns immediately when rows already exist", (await wc.waitForRows(0, {}, 5000)).length >= 4);

for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
