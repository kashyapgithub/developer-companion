#!/usr/bin/env node
/**
 * query_logs.js — Command-line log inspector for Developer Companion
 *
 * Usage:
 *   node query_logs.js recent [--app <label>] [--level <level>] [--minutes <n>] [--limit <n>]
 *   node query_logs.js groups
 *   node query_logs.js trace <request_id>
 *   node query_logs.js status
 */

import { queryRecentLogs, queryLogGroups, queryLogTrace, getSummaryStats } from "./storage.js";

const args = process.argv.slice(2);
const command = args[0] || "recent";

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

if (command === "status") {
  console.log("\n=== Developer Companion Status ===");
  console.log(JSON.stringify(getSummaryStats(), null, 2));
  process.exit(0);
}

if (command === "groups") {
  const groups = queryLogGroups({ limit: Number(getArg("--limit")) || 20 });
  console.log(`\n=== Grouped Error Logs (${groups.length} groups) ===\n`);
  for (const g of groups) {
    console.log(`[${g.app_name}] ${g.level.toUpperCase()} (seen ${g.total_count}x, last: ${g.last_seen})`);
    console.log(`  ${g.message}`);
    console.log(`  Fingerprint: ${g.fingerprint}\n`);
  }
  process.exit(0);
}

if (command === "trace") {
  const reqId = args[1];
  if (!reqId) {
    console.error("Error: missing request_id. Usage: node query_logs.js trace <request_id>");
    process.exit(1);
  }
  const rows = queryLogTrace(reqId);
  console.log(`\n=== Request Trace: ${reqId} (${rows.length} logs) ===\n`);
  for (const r of rows) {
    printRow(r);
  }
  process.exit(0);
}

// Default: recent
const app = getArg("--app");
const level = getArg("--level");
const minutes = Number(getArg("--minutes")) || 60;
const limit = Number(getArg("--limit")) || 50;

const rows = queryRecentLogs({ app, level, minutes, limit });
console.log(`\n=== Recent Browser Logs (${rows.length} rows in past ${minutes}m) ===\n`);
for (const r of rows) {
  printRow(r);
}

function printRow(r) {
  const lvl = (r.level || "info").toUpperCase();
  console.log("=".repeat(72));
  console.log(`[${r.created_at}]  ${r.app_name}  —  ${lvl}`);
  console.log("-".repeat(72));
  console.log(`message      : ${r.message}`);
  if (r.error_type) console.log(`error_type   : ${r.error_type}`);
  if (r.fingerprint) console.log(`fingerprint  : ${r.fingerprint}`);
  if (r.request_id) console.log(`request_id   : ${r.request_id}`);
  if (r.context && Object.keys(r.context).length > 0) {
    console.log(`context      : ${JSON.stringify(r.context)}`);
  }
  if (r.stack_trace) {
    console.log(`stack_trace  :`);
    for (const l of r.stack_trace.split("\n")) {
      console.log(`  ${l}`);
    }
  }
  console.log("=".repeat(72) + "\n");
}
