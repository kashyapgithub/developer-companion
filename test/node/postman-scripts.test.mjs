/** postman-scripts.test.mjs — common Postman scripts become tests and extract rules; the rest is reported. */
import { convertScript } from "../../server/api/postman-scripts.js";
import { importPostmanCollection } from "../../server/api/postman.js";
import { runAssertions } from "../../server/api/assertions.js";
import { importNotes } from "../../api/modules/import-dialog.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const script = `
// login checks
pm.test("Status is 200", function () {
    pm.response.to.have.status(200);
});
pm.test("Fast enough", () => {
  pm.expect(pm.response.responseTime).to.be.below(800);
});
const jsonData = pm.response.json();
pm.test("Has a token", function () {
    pm.expect(jsonData.data.token).to.exist;
    pm.expect(jsonData.data.user.name).to.eql("Ada");
    pm.expect(jsonData.items).to.be.an("array");
    pm.expect(jsonData.items).to.have.lengthOf(3);
    pm.expect(jsonData).to.have.property("id");
    pm.expect(jsonData.count).to.be.above(0);
    pm.expect(jsonData.status).to.not.eql("failed");
    pm.expect(jsonData.email).to.match(/@/);
});
pm.test("Json type", () => pm.expect(pm.response.headers.get("Content-Type")).to.include("json"));
pm.response.to.be.ok;
pm.environment.set("token", jsonData.data.token);
pm.collectionVariables.set("reqId", pm.response.headers.get("X-Request-Id"));
pm.environment.set("first", pm.response.json().items[0].id);
const x = computeSomething(jsonData);
pm.environment.set("ts", Date.now());
`.split("\n");
const c = convertScript(script);
const byName = (n) => c.tests.find((x) => x.name === n);
t("status check", byName("Status is 200").type === "status" && byName("Status is 200").value === 200);
t("response time check", byName("Fast enough").type === "time" && byName("Fast enough").op === "lt" && byName("Fast enough").value === 800);
const group = c.tests.filter((x) => x.name === "Has a token");
t("json checks inside one pm.test keep its name", group.length === 8, String(group.length));
t("exists / equals / type / length / property / gt / not equals / regex",
  group[0].op === "exists" && group[0].path === "data.token" && group[1].value === "Ada" && group[2].op === "type" && group[3].path === "items.length" && group[3].value === 3 && group[4].path === "id" && group[5].op === "gt" && group[6].op === "not_equals" && group[7].op === "matches" && group[7].value === "@");
t("one-line pm.test with a header check", c.tests.some((x) => x.type === "header" && x.name === "Content-Type" && x.op === "contains"));
t("pm.response.to.be.ok becomes 2xx", c.tests.some((x) => x.type === "status" && x.value === "2xx"));
t("environment/collection sets become extract rules", c.extract.length === 3 && c.extract[0].var === "token" && c.extract[0].from === "data.token" && c.extract[1].from === "header:x-request-id" && c.extract[2].from === "items[0].id", JSON.stringify(c.extract));
t("unconvertible lines are reported, not lost", c.ignored.length === 2 && /computeSomething/.test(c.ignored[0]), JSON.stringify(c.ignored));

// Run the converted tests on a real-looking response
const res = { status: 200, headers: { "content-type": "application/json" }, bodyText: "", durationMs: 50, json: { data: { token: "t", user: { name: "Ada" } }, items: [1, 2, 3], id: 1, count: 2, status: "ok", email: "a@b.c" } };
const ran = runAssertions(c.tests, res);
t("converted tests actually pass against a matching response", ran.every((x) => x.pass), JSON.stringify(ran.filter((x) => !x.pass)));
t("and fail against a wrong one", runAssertions(c.tests, { ...res, status: 500 }).some((x) => !x.pass));

// whole collection import
const imp = importPostmanCollection({ info: { name: "S" }, item: [
  { name: "Login", request: { method: "POST", url: "http://x/login" }, event: [{ listen: "test", script: { exec: script } }, { listen: "prerequest", script: { exec: ["pm.environment.set('a', 1)"] } }] },
  { name: "Plain", request: { method: "GET", url: "http://x/p" } }] });
const login = imp.collection.requests[0];
t("imported request carries tests and extract", login.tests.length === c.tests.length && login.extract.length === 3);
t("notes count conversions, leftovers and pre-request scripts", imp.notes.testsConverted === c.tests.length && imp.notes.extractsConverted === 3 && imp.notes.preRequestScripts === 1 && imp.notes.scripts === 2, JSON.stringify(imp.notes));
const text = importNotes(imp.notes).join("; ");
t("the import message says it in plain words", /turned scripts into \d+ tests/.test(text) && /pre-request script/.test(text) && /can't be converted/.test(text), text);
t("a request without scripts is untouched", imp.collection.requests[1].tests.length === 0);
for (const [ok, n] of out) console.log((ok ? "PASS " : "FAIL ") + n);
