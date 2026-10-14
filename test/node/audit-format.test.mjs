/** audit-format.test.mjs — ranking, counting and rating of audit findings. */
import { rate, rankIssues, countByRule, buildAudit } from "../../lib/agent-tools/audit-format.js";
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);
t("good LCP", rate("lcpMs", 1200) === "good");
t("needs-work LCP", rate("lcpMs", 3000) === "needs work");
t("poor CLS", rate("cls", 0.5) === "poor");
t("unmeasured is null", rate("lcpMs", null) === null);
const issues = [{ rule: "a", severity: "minor" }, ...Array.from({ length: 8 }, () => ({ rule: "b", severity: "serious" }))];
t("serious first", rankIssues(issues)[0].severity === "serious");
t("per-rule cap of 5", rankIssues(issues).filter((i) => i.rule === "b").length === 5);
t("counts keep the true total", countByRule(issues).b === 8);
t("report shape", buildAudit({ page: {}, issues, metrics: { lcpMs: 100 } }).performance.verdicts.lcp === "good");
for (const [c, n] of out) console.log((c ? "PASS " : "FAIL ") + n);
process.exit(out.every(([c]) => c) ? 0 : 1);
