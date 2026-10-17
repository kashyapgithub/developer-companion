/** checks.test.mjs — the acceptance-check language and runner (fake driver; the real browser is tested separately). */
import { parseScenarios, parseSentence, normalizeChecks, toScenarioText, describeStep } from "../../lib/agent-tools/checks-spec.js";
import { runChecks } from "../../lib/agent-tools/checks-run.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const throws = (fn) => { try { fn(); return ""; } catch (e) { return e.message; } };

// ---- language ----
const text = `Feature: Checkout
Scenario: Buyer pays
  Given I open /cart
  When I click "Pay now"
  And I type "4242" into #card
  And I press Enter
  Then I see "Thank you"
  And I do not see "Declined"
  And the url contains /done
  And POST /api/orders returned 201
  And there are no console errors
Scenario: Empty cart
  Given I open "/cart?empty=1"
  Then #empty-state is visible
  And .checkout-btn is not visible`;
const checks = parseScenarios(text);
t("two scenarios parse", checks.length === 2 && checks[0].name === "Buyer pays");
t("every kind of step is understood", checks[0].steps.length === 9 && checks[0].steps[0].do === "goto" && checks[0].steps[2].selector === "#card" && checks[0].steps[7].status === "201");
t("quoted URL and selector assertions", checks[1].steps[0].url === "/cart?empty=1" && checks[1].steps[1].expect === "selector" && checks[1].steps[2].expect === "no_selector");
t("click on bare words means visible text", parseSentence("click Save").text === "Save" && parseSentence("click #save").selector === "#save");
t("status classes like 2xx are kept", parseSentence("GET /api/x returns 2xx").status === "2xx");
t("waits understand seconds", parseSentence("wait 2 s").ms === 2000);
t("text round-trips", JSON.stringify(parseScenarios(toScenarioText(checks))) === JSON.stringify(checks));
t("unreadable lines name the line", /Line 2: Couldn't read: "juggle"/.test(throws(() => parseScenarios("Scenario: x\nGiven juggle"))));
t("bad JSON steps are explained", /unknown action "fly"/.test(throws(() => normalizeChecks([{ name: "x", steps: [{ do: "fly" }] }]))) && /needs a selector/.test(throws(() => normalizeChecks([{ steps: [{ do: "type", text: "a" }] }]))));
t("no checks is an error", /No checks/.test(throws(() => normalizeChecks([]))));
t("describeStep reads naturally", describeStep({ expect: "request", method: "POST", url_contains: "/a", status: "201" }) === "POST /a returned 201");

// ---- runner with a fake page ----
let nowMs = 0; const sleep = async (ms) => { nowMs += ms; }; const now = () => nowMs;
const fakeDriver = (page) => {
  const log = [];
  return { log,
    async begin() { log.push("begin"); },
    async goto(u) { log.push("goto " + u); page.url = u; },
    async click({ text, selector }) { log.push("click " + (text || selector)); if ((text || selector) === "Missing") throw new Error("No element matches."); page.onClick?.(); },
    async type() {}, async press() {},
    async probe(s) {
      if (s.expect === "text") return { ok: page.texts.includes(s.text) && (!page.appearsAt || nowMs >= page.appearsAt) };
      if (s.expect === "no_text") return { ok: !page.texts.includes(s.text) };
      if (s.expect === "no_console_errors") return page.errors.length ? { ok: false, detail: `Console error: ${page.errors[0]}` } : { ok: true };
      if (s.expect === "url") return { ok: page.url.includes(s.contains), detail: `URL is ${page.url}` };
      return { ok: true };
    },
    async evidence() { return { url: page.url, consoleErrors: page.errors, screenshot: "PNG" }; } };
};
let page = { url: "", texts: ["Thank you"], errors: [] };
let r = await runChecks(normalizeChecks([{ name: "ok", steps: [{ do: "goto", url: "/x" }, { do: "click", text: "Go" }, { expect: "text", text: "Thank you" }, { expect: "no_console_errors" }] }]), fakeDriver(page), { sleep, now });
t("a passing check passes", r.passed === 1 && r.summary === "1/1 checks passed" && r.results[0].steps.every((s) => s.status === "passed"));

page = { url: "", texts: [], errors: [], appearsAt: 800 }; page.texts.push("Saved"); nowMs = 0;
r = await runChecks(normalizeChecks([{ name: "slow", steps: [{ expect: "text", text: "Saved" }] }]), fakeDriver(page), { sleep, now });
t("expectations wait for slow UI", r.passed === 1 && nowMs >= 800);

nowMs = 0; page = { url: "/cart", texts: [], errors: ["TypeError: x is undefined"] };
r = await runChecks(normalizeChecks([{ name: "bad", steps: [{ do: "goto", url: "/cart" }, { expect: "text", text: "Never here" }, { expect: "no_console_errors" }] }, { name: "second", steps: [{ expect: "no_console_errors" }] }]), fakeDriver(page), { sleep, now, timeoutMs: 1000 });
t("a failing check says which step and why", r.results[0].failedStep === 'I see "Never here"' && r.results[0].steps[1].status === "failed");
t("steps after a failure are skipped", r.results[0].steps[2].status === "skipped");
t("failure carries evidence (screenshot, console errors, url)", r.results[0].evidence.screenshot === "PNG" && r.results[0].evidence.consoleErrors.length === 1 && r.results[0].evidence.url === "/cart");
t("the next check still runs", r.results.length === 2 && r.results[1].passed === false && /Console error/.test(r.results[1].steps[0].why));

page = { url: "", texts: [], errors: [] };
r = await runChecks(normalizeChecks([{ name: "gone", steps: [{ do: "click", text: "Missing" }, { expect: "text", text: "a" }] }]), fakeDriver(page), { sleep, now });
t("an action that throws fails the step with its message", /No element matches/.test(r.results[0].steps[0].why));

for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
