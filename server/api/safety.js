/**
 * safety.js — the probes and stress tests send REAL requests. A POST/PUT/PATCH/DELETE can create, change or
 * delete real data (and a vulnerable endpoint will do it for the probes too), so the agent must have the
 * user's go-ahead before running them on anything that isn't read-only.
 */

const READ_ONLY = new Set(["GET", "HEAD", "OPTIONS"]);

/** True when sending this request may change data on the server. */
export const changesData = (request) => !READ_ONLY.has(String(request?.method || "GET").toUpperCase());

/** The refusal text for an agent that didn't pass allow_changes. */
export const needsPermission = (what) =>
  `${what} can create, change or delete real data, because the test sends real requests (and tests like "no credentials" or "extra fields" are exactly what a vulnerable endpoint would obey). ` +
  "Ask the user whether it's OK to run it against this server (a local dev database is fine), then call again with allow_changes: true. Read-only (GET) requests don't need this.";
