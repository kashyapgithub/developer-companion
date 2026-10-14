/** log-lines.test.mjs — how dev-server output becomes log rows. */
import { ROOT } from "../helpers/paths.mjs";
const { createLineCollector, rowFromLine } = await import(ROOT + "/server/log-lines.js");
const { parseArgs } = await import(ROOT + "/server/tail.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const run = (lines) => { const c = createLineCollector({ name: "api" }); const rows = []; for (const l of lines) rows.push(...c.push(l, "stdout")); rows.push(...c.flush()); return rows; };

let rows = run(["Server listening on 3000", "\x1b[31mError: db down\x1b[0m", "    at query (/app/db.js:10:5)", "    at handler (/app/h.js:3:1)", "next line"]);
t("stack lines fold into the error before them", rows.length === 3 && /db down/.test(rows[1].message) && /db.js:10/.test(rows[1].stack_trace) && /h.js:3/.test(rows[1].stack_trace));
t("ANSI colours stripped", !/\x1b/.test(rows[1].message));
t("plain lines are info, errors are error", rows[0].level === "info" && rows[1].level === "error");
t("rows are tagged for the server side", rows[0].environment === "server" && rows[0].app_name === "api");
rows = run(["POST /api/orders 500 12ms req-abc-9", "GET /health 200 1ms", "PUT /x 404 2ms"]);
t("access log: 5xx = error, 2xx = info, 4xx = warn", rows[0].level === "error" && rows[1].level === "info" && rows[2].level === "warn");
t("access log details extracted", rows[0].context.http.path === "/api/orders" && rows[0].context.http.status === 500);
t("request id extracted (req-… style)", rows[0].request_id === "req-abc-9");
t("request id extracted (key=value style)", rowFromLine("handled request_id=7f3a9c ok", "stdout").request_id === "7f3a9c");
t("blank lines ignored", run(["", "   "]).length === 0);
t("Python traceback folds too", run(["Traceback (most recent call last):", '  File "app.py", line 3, in <module>', "ValueError: bad"]).some((r) => /app.py/.test(r.stack_trace || "")));
const a = parseArgs(["--name", "api", "--", "npm", "run", "dev"]); t("args: name + command split at --", a.opts.name === "api" && a.command.join(" ") === "npm run dev");
t("args: no command -> empty", parseArgs(["--name", "x"]).command.length === 0);
for (const [ok, n] of out) console.log((ok ? "PASS " : "FAIL ") + n); process.exit(out.every((o) => o[0]) ? 0 : 1);
