/** captured-to-request.test.mjs — recorded browser calls become safe, editable requests. */
import { capturedToRequest, splitUrl, isApiCall } from "../../lib/captured-to-request.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const r = capturedToRequest({ method: "POST", url: "https://api.x.com/v1/users?page=2&q=a", type: "Fetch",
  requestHeaders: { Authorization: "[REDACTED]", "Content-Type": "application/json", "User-Agent": "Mozilla", "x-trace": "abc", "x-secret": "[REDACTED]" },
  requestBody: '{"name":"a","password":"[REDACTED]"}' });
t("query string moves into params", r.url === "https://api.x.com/v1/users" && r.params.length === 2 && r.params[0].key === "page");
t("authorization becomes a {{token}} placeholder", r.auth.type === "bearer" && r.auth.token === "{{token}}");
t("masked and browser-noise headers are dropped", r.headers.map((h) => h.key).join() === "Content-Type,x-trace");
t("JSON body is kept, secrets stay masked", r.body.mode === "json" && r.body.content.includes("[REDACTED]"));
t("name shows method and path", r.name === "POST /v1/users");
t("basic auth is recognised", capturedToRequest({ method: "GET", url: "http://a/b", requestHeaders: { authorization: "Basic abc" } }).auth.type === "basic");
t("form bodies become rows", capturedToRequest({ method: "POST", url: "http://a/b", requestHeaders: { "content-type": "application/x-www-form-urlencoded" }, requestBody: "a=1&b=2" }).body.form.length === 2);
t("no body = none", capturedToRequest({ method: "GET", url: "http://a/b" }).body.mode === "none");
t("bad URL does not throw", splitUrl("not a url").url === "not a url");
t("only fetch/XHR count as API calls", isApiCall({ type: "XHR" }) && !isApiCall({ type: "Image" }));
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
