/**
 * tail.js — run your dev server through Developer Companion so its output
 * (errors, stack traces, request logs) lands next to the browser's, and the
 * agent can follow one click from the page all the way to the backend.
 *
 *   node server/tail.js --name api -- npm run dev
 *   npm run tail -- --name api -- npm run dev      (from the server/ folder)
 *
 * Output still appears in your terminal exactly as before. Options:
 *   --name <label>   how the app is labelled in the logs (default: the command)
 *   --url <address>  the bridge (default http://127.0.0.1:5959)
 *   --code <code>    access code, only for a bridge on another machine
 */

import { spawn } from "node:child_process";
import os from "node:os";
import readline from "node:readline";
import { createLineCollector } from "./log-lines.js";

const SEND_EVERY_MS = 300;     // batch rows so a chatty server doesn't flood the bridge
const HOLD_IDLE_MS = 150;      // after this quiet gap, the held line is final (no stack lines coming)

/** Splits argv into our options and the command to run (everything after `--`). */
export function parseArgs(argv) {
  const cut = argv.indexOf("--");
  const own = cut === -1 ? argv : argv.slice(0, cut);
  const command = cut === -1 ? [] : argv.slice(cut + 1);
  const opts = { name: "", url: "http://127.0.0.1:5959", code: "" };
  for (let i = 0; i < own.length; i += 2) {
    const key = own[i]?.replace(/^--/, "");
    if (key in opts && own[i + 1]) opts[key] = own[i + 1];
  }
  return { opts, command };
}

async function main() {
  const { opts, command } = parseArgs(process.argv.slice(2));
  if (!command.length) {
    console.error("Usage: node server/tail.js [--name api] -- <command to run>\n  e.g. node server/tail.js --name api -- npm run dev");
    process.exit(2);
  }
  const name = opts.name || command.join(" ").slice(0, 40);
  const collector = createLineCollector({ name, host: os.hostname() });
  let outbox = [];

  /** Sends the queued rows; failure is silent (the bridge being down must never break your dev server). */
  async function send() {
    if (!outbox.length) return;
    const batch = outbox; outbox = [];
    try {
      await fetch(`${opts.url}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(opts.code ? { "X-Sketch-Token": opts.code } : {}) },
        body: JSON.stringify(batch),
      });
    } catch { /* bridge not running: drop these rows */ }
  }
  const timer = setInterval(send, SEND_EVERY_MS);
  let idle = null;
  const take = (line, stream) => {
    outbox.push(...collector.push(line, stream));
    clearTimeout(idle);
    idle = setTimeout(() => outbox.push(...collector.flush()), HOLD_IDLE_MS);
  };

  const child = spawn(command[0], command.slice(1), { stdio: ["inherit", "pipe", "pipe"], shell: process.platform === "win32" });
  for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    const kind = sink === process.stdout ? "stdout" : "stderr";
    stream.pipe(sink);                                           // your terminal looks the same as ever
    readline.createInterface({ input: stream }).on("line", (l) => take(l, kind));
  }
  child.on("exit", async (code) => {
    clearTimeout(idle); clearInterval(timer);
    outbox.push(...collector.flush());
    await send();
    process.exit(code ?? 0);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
