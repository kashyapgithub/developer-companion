/**
 * connect-test.mjs — the one-click agent registration, run against a throwaway HOME.
 * Checks: agents are found and registered, other servers survive, a second run
 * changes nothing, and a config with comments is left untouched.
 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "dc-home-"));
const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: path.dirname(process.execPath) }; // PATH without a real `claude`
const run = () => execFileSync(process.execPath, [path.join(server, "connect.js")], { env, encoding: "utf8" });

fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
fs.writeFileSync(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
const commented = '// my notes\n{"a":1}';
fs.writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), commented);

const results = [];
const check = (name, ok, extra = "") => results.push([ok, name + (extra ? ` — ${extra}` : "")]);

const first = run();
const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8"));
check("registers with Cursor", !!cursor.mcpServers["developer-companion"]);
check("keeps other servers", !!cursor.mcpServers.other);
check("backs up the original once", fs.existsSync(path.join(home, ".cursor", "mcp.json.developer-companion.bak")));
check("leaves commented config alone", fs.readFileSync(path.join(home, ".config", "opencode", "opencode.json"), "utf8") === commented);
check("reports the skipped agent", /opencode\s+config has comments/.test(first));
check("second run changes nothing", /Cursor\s+unchanged/.test(run()));

for (const [ok, name] of results) console.log((ok ? "PASS " : "FAIL ") + name);
process.exit(results.every(([ok]) => ok) ? 0 : 1);
