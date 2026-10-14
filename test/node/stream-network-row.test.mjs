/** stream-network-row.test.mjs — one finished request becomes one readable stream line. */
import { ROOT } from "../helpers/paths.mjs";
const f = await import(ROOT + "/lib/stream-network-row.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const e = { method: "POST", url: "http://localhost:3000/api/orders?x=1", status: 201, durationMs: 84, size: 1300, type: "Fetch", mimeType: "application/json", correlationId: "req-9", requestBody: '{"qty":2}', responseBody: '{"id":7}' };
const r = f.buildNetworkRow(e);
t("line: method, short url, status, time, size", r.message === "POST /api/orders?x=1 → 201 (84ms, 1.3KB)", r.message);
t("2xx is info", r.level === "info");
t("4xx is warn, 5xx is error", f.buildNetworkRow({ ...e, status: 404 }).level === "warn" && f.buildNetworkRow({ ...e, status: 503 }).level === "error");
t("context carries url, ids and bodies", r.context.url === e.url && r.context.requestId === "req-9" && r.context.requestBody === '{"qty":2}' && r.context.responseBody === '{"id":7}');
t("tags let the agent filter network lines", r.tags.includes("network") && r.tags.includes("201") && r.tags.includes("POST"));
t("unfinished request gives null", f.buildNetworkRow({ ...e, status: null }) === null && f.buildNetworkRow(undefined) === null);
t("long bodies are cut with a count", /…\[\+\d+\]$/.test(f.buildNetworkRow({ ...e, responseBody: "x".repeat(5000) }).context.responseBody));
t("no timing or size is fine", f.buildNetworkRow({ ...e, durationMs: null, size: 0 }).message === "POST /api/orders?x=1 → 201");
t("humanSize", f.humanSize(340) === "340B" && f.humanSize(2048) === "2.0KB" && f.humanSize(0) === "");
t("shortUrl keeps path + query, tolerates junk", f.shortUrl("https://a.b/c?d=1") === "/c?d=1" && f.shortUrl("nonsense") === "nonsense");
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
