/** state-format.test.mjs — page-state shaping: masking, parsing, caps. */
import { shapeValue, shapeStorage, shapeGlobals, buildPageState, clip } from "../../lib/agent-tools/state-format.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

t("sensitive key is masked", shapeValue("authToken", "abc") === "[REDACTED]");
t("JSON string is parsed", shapeValue("prefs", '{"theme":"dark"}').theme === "dark");
t("nested secret masked", shapeValue("user", '{"name":"a","password":"x"}').password === "[REDACTED]");
t("JWT-looking value masked under a plain key", shapeValue("blob", "eyJhbGciOi.eyJzdWIiOi.abc123") === "[REDACTED]");
t("plain string kept", shapeValue("lang", "en") === "en");
t("long values clipped", /\+\d+ chars/.test(shapeValue("big", "x".repeat(5000))));
t("clip leaves short text", clip("hi") === "hi");
const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => ["k" + i, "v"]));
const shaped = shapeStorage(many);
t("storage entries capped with a note", Object.keys(shaped).length === 61 && /20 more/.test(shaped["…"]));
t("globals masked", shapeGlobals({ __NEXT_DATA__: { props: { apiKey: "k", ok: 1 } } }).__NEXT_DATA__.props.apiKey === "[REDACTED]");
t("huge globals truncated", !!shapeGlobals({ __NUXT__: { d: "y".repeat(9000) } }).__NUXT__.truncated);
const r = buildPageState({ page: { url: "u" }, localStorage: { a: "1" }, sessionStorage: {}, cookieNames: ["sid"], globals: {} });
t("report has cookie names only", r.cookie_names.length === 1 && r.cookie_names[0] === "sid" && !("cookies" in r));

for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
