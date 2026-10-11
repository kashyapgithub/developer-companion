/**
 * run.mjs — runs every test file in its own process and reports PASS/FAIL.
 *
 *   node test/run.mjs            everything
 *   node test/run.mjs node       only the fast tests (no browser needed)
 *   node test/run.mjs browser    only the real-Chromium tests
 *
 * A test file prints "PASS <name>" / "FAIL <name>" lines. The file fails if it
 * exits non-zero, times out, or prints any FAIL line.
 */
import fs from "node:fs"; import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const groups = process.argv[2] ? [process.argv[2]] : ["node", "browser"];
const TIMEOUT_MS = 120_000;
const BROWSER_RETRIES = 1; // headless Chromium occasionally stalls on startup under load

let failedFiles = 0;
for (const group of groups) {
  const dir = path.join(here, group);
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort()) {
    let attempt = 0, run, lines, fails, ok;
    do {
      run = spawnSync(process.execPath, [path.join(dir, file)], { encoding: "utf8", timeout: TIMEOUT_MS, env: process.env });
      lines = (run.stdout || "").split("\n").filter((l) => /^(PASS|FAIL) /.test(l));
      fails = lines.filter((l) => l.startsWith("FAIL "));
      ok = run.status === 0 && fails.length === 0 && lines.length > 0;
    } while (!ok && group === "browser" && attempt++ < BROWSER_RETRIES);
    console.log(`${ok ? "✔" : "✘"} ${group}/${file}  (${lines.length - fails.length}/${lines.length} checks)${ok && attempt ? "  [passed on retry]" : ""}`);
    if (!ok) {
      failedFiles += 1;
      fails.forEach((l) => console.log("    " + l));
      if (run.status !== 0) console.log("    " + ((run.stderr || "").split("\n").filter((l) => !/Warning|trace-warnings/.test(l)).slice(-6).join("\n    ") || `exit ${run.status}${run.error ? ` (${run.error.code})` : ""}`));
    }
  }
}
console.log(failedFiles ? `\n${failedFiles} test file(s) failed` : "\nAll tests passed");
process.exit(failedFiles ? 1 : 0);
