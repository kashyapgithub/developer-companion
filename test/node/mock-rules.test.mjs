/** mock-rules.test.mjs — the mock rule book: validation, matching order, fulfil params. */
import { addRule, listRules, clearRules, matchRule, toFulfillParams, validateSpec, toBase64 } from "../../lib/agent-tools/mock-rules.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

t("url_contains required", !!validateSpec({}).error);
t("bad status refused", !!validateSpec({ url_contains: "/a", status: 42 }).error);
t("object body becomes JSON", validateSpec({ url_contains: "/a", body: { x: 1 } }).rule.bodyText === '{"x":1}');
t("JSON content type guessed", validateSpec({ url_contains: "/a", body: "[1]" }).rule.contentType === "application/json");
t("delay capped", validateSpec({ url_contains: "/a", delay_ms: 99999 }).rule.delayMs === 10000);

const a = addRule(1, { url_contains: "/api", status: 200, body: "broad" }).rule;
const b = addRule(1, { url_contains: "/api/orders", status: 500, body: "narrow" }).rule;
t("newest rule wins", matchRule(1, "http://x/api/orders", "GET").id === b.id);
t("falls back to older rule", matchRule(1, "http://x/api/users", "GET").id === a.id);
t("hits are counted", listRules(1).find((r) => r.id === b.id).hits === 1);
addRule(2, { url_contains: "/p", method: "post" });
t("method must match", matchRule(2, "http://x/p", "GET") === null && matchRule(2, "http://x/p", "POST") !== null);
t("rules are per tab", matchRule(3, "http://x/api", "GET") === null);
const f = toFulfillParams(b);
t("fulfil params carry status, body, mock marker", f.responseCode === 500 && atob(f.body) === "narrow" && f.responseHeaders.some((h) => h.name === "x-developer-companion-mock"));
t("unicode survives base64", new TextDecoder().decode(Uint8Array.from(atob(toBase64("₹ नमस्ते")), (c) => c.charCodeAt(0))) === "₹ नमस्ते");
t("clear one", clearRules(1, a.id) === 1 && listRules(1).length === 1);
t("clear all", clearRules(1) === 1 && listRules(1).length === 0);
for (let i = 0; i < 20; i++) addRule(4, { url_contains: "/x" + i });
t("rule count capped", !!addRule(4, { url_contains: "/over" }).error);
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
