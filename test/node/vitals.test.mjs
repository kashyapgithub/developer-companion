/** vitals.test.mjs — rating, advice and baseline comparison (pure). */
import { rate, buildVitals, compareVitals } from "../../lib/agent-tools/vitals-format.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
const raw = (o = {}) => ({ page: { url: "http://x" }, navigation: { ttfbMs: 100, fcpMs: 900 }, lcp: { ms: 1800, selector: "img.hero", tag: "img", url: "/hero.png" }, cls: { value: 0.02, shifts: [] }, inp: { ms: 120, name: "click", selector: "button#buy", inputDelayMs: 10, processingMs: 90, presentationMs: 20, interactions: 3 }, longTasks: { count: 1, totalBlockingMs: 40, worst: [] }, ...o });

t("ratings follow web.dev thresholds", rate("lcpMs", 2500) === "good" && rate("lcpMs", 2501) === "needs work" && rate("lcpMs", 4001) === "poor" && rate("cls", 0.3) === "poor" && rate("inpMs", 200) === "good");
t("unmeasured metrics stay null", rate("inpMs", null) === null);
let r = buildVitals(raw());
t("a healthy page has nothing to fix", r.metrics.lcpMs.rating === "good" && r.fix_first.length === 0);
r = buildVitals(raw({ lcp: { ms: 5200, selector: "img.hero", tag: "img", url: "/hero.png" }, cls: { value: 0.31, shifts: [{ value: 0.3, selectors: ["div#banner"] }] }, inp: { ms: 620, name: "click", selector: "button#buy", inputDelayMs: 5, processingMs: 560, presentationMs: 55, interactions: 2 }, longTasks: { count: 6, totalBlockingMs: 900, worst: [] } }));
t("a poor page lists what to fix first", r.fix_first.length === 4 && /img\.hero/.test(r.fix_first[0]) && /div#banner/.test(r.fix_first[1]));
t("slow handler vs busy thread is told apart", /event handler itself is slow/.test(r.fix_first[2]) && /main thread was busy/.test(buildVitals(raw({ inp: { ms: 400, name: "click", selector: "a", inputDelayMs: 350, processingMs: 20, presentationMs: 30, interactions: 1 } })).fix_first[0]));
t("missing INP is explained, not guessed", /INP needs an interaction/.test(buildVitals(raw({ inp: null })).notes.join()));

const base = buildVitals(raw());
let c = compareVitals(buildVitals(raw({ lcp: { ms: 3100, selector: "img", tag: "img", url: "" } })), base);
t("a slower LCP is a regression and shows the rating change", c.verdict === "regressed" && c.changes[0].metric === "LCP" && c.changes[0].rating === "(good → needs work)", c.summary);
c = compareVitals(buildVitals(raw({ lcp: { ms: 1850, selector: "img", tag: "img", url: "" } })), base);
t("tiny changes are noise", c.verdict === "same");
c = compareVitals(buildVitals(raw({ lcp: { ms: 1200, selector: "img", tag: "img", url: "" } })), base);
t("a real improvement is reported", c.verdict === "improved" && /LCP 1800 → 1200/.test(c.summary));
c = compareVitals(buildVitals(raw({ cls: { value: 0.2, shifts: [] } })), base);
t("CLS regressions count too", c.verdict === "regressed" && c.changes[0].metric === "CLS");
c = compareVitals(buildVitals(raw({ inp: null })), base);
t("metrics missing on one side are skipped", !c.changes.some((x) => x.metric === "INP"));
for (const [ok, n] of out) console.log((ok ? "PASS " : "FAIL ") + n);
