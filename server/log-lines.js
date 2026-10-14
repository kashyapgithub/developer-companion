/**
 * log-lines.js — turns raw dev-server output (stdout/stderr lines) into log rows.
 *
 * Used by tail.js. It does three things a plain "send every line" can't:
 *   - guesses a level (error / warn / info) from the text,
 *   - folds stack-trace lines into the error that precedes them,
 *   - pulls out HTTP access-log details (method, path, status) and request ids,
 *     so the trace tool can match a server line to a browser request.
 *
 * Pure functions, no I/O, so it is easy to test.
 */

const ERROR_WORDS = /\b(error|exception|fatal|unhandled|traceback|panic|ECONNREFUSED|ENOENT|EADDRINUSE|failed)\b/i;
const WARN_WORDS = /\bwarn(ing)?\b|deprecated/i;
const STACK_LINE = /^\s+at\s|^\s+File ".*", line \d+|^\s+\.\.\. \d+ more|^Traceback \(most recent call last\)|^Caused by:/;
const ACCESS_LOG = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/\S*)\s+(?:HTTP\/[\d.]+"?\s+)?(\d{3})\b/;
const REQUEST_ID = /(?:x-request-id|request[_-]?id|req[_-]?id|reqid|correlation[_-]?id|trace[_-]?id)["'=:\s]+([\w.-]{4,64})|\b(req-[\w-]{2,})\b/i;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Level for one line: HTTP status wins (5xx = error, 4xx = warn), then keywords. */
export function levelOf(line, access) {
  if (access) return access.status >= 500 ? "error" : access.status >= 400 ? "warn" : "info";
  if (ERROR_WORDS.test(line)) return "error";
  if (WARN_WORDS.test(line)) return "warn";
  return "info";
}

/** Builds one row from a line. `stream` is "stdout" or "stderr". */
export function rowFromLine(line, stream, { name = "server", host = "" } = {}) {
  const clean = line.replace(ANSI, "").trimEnd();
  const m = ACCESS_LOG.exec(clean);
  const access = m ? { method: m[1], path: m[2], status: Number(m[3]) } : null;
  const id = REQUEST_ID.exec(clean);
  return {
    created_at: new Date().toISOString(),
    app_name: name, environment: "server", host,
    level: levelOf(clean, access),
    message: clean,
    stack_trace: null,
    request_id: id ? (id[1] || id[2]) : null,
    context: { stream, ...(access ? { http: access } : {}) },
    tags: ["server-log", stream],
  };
}

/**
 * Stateful line collector. push() returns rows that are now complete; flush()
 * returns the last held row. A line is held until the next one arrives so
 * stack-trace lines can still be attached to it.
 */
export function createLineCollector(options = {}) {
  let held = null;
  const clean = (l) => l.replace(ANSI, "");
  return {
    push(line, stream) {
      if (!clean(line).trim()) return [];
      if (held && STACK_LINE.test(clean(line))) {
        held.stack_trace = (held.stack_trace ? held.stack_trace + "\n" : "") + clean(line).trimEnd();
        if (held.level !== "error") held.level = "error"; // a stack trace is always an error
        return [];
      }
      const done = held ? [held] : [];
      held = rowFromLine(line, stream, options);
      return done;
    },
    flush() { const r = held ? [held] : []; held = null; return r; },
  };
}
