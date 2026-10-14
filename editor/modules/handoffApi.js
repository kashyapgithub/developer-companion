/**
 * handoffApi.js — export / import of the session handoff bundle via the bridge.
 *
 * Uses the same saved connection as "Send to project". Errors are thrown as
 * Error objects whose message is fit to show to the user.
 */

import { loadConnection, receiverBase, requestHeaders, describeConnection } from "./connection.js";

/** Resolves { base, conn, where } or throws a readable error when no address is set. */
async function target(getConnection) {
  const conn = await getConnection();
  const base = receiverBase(conn);
  if (!base) throw new Error("No address set — open “Agent connection” and enter the VM or computer address.");
  return { base, conn, where: describeConnection(conn) };
}

/** Fetch with friendly failures for “can't reach” and “wrong code”. */
async function call(getConnection, path, init = {}) {
  const t = await target(getConnection);
  let res;
  try { res = await fetch(t.base + path, { ...init, headers: requestHeaders(t.conn, init.headers || {}) }); }
  catch { throw new Error(`Can't reach ${t.where} — is the bridge running?`); }
  if (res.status === 401) throw new Error("Wrong access code — open “Agent connection” and re-enter it.");
  return res;
}

export function createHandoffApi({ getConnection = loadConnection } = {}) {
  return {
    /** The bundle as a Blob (for saving to disk). */
    async exportBundle({ inspiration = true } = {}) {
      const res = await call(getConnection, `/handoff${inspiration ? "" : "?inspiration=0"}`);
      if (!res.ok) throw new Error(`The bridge answered ${res.status}.`);
      return res.blob();
    },
    /** Sends a parsed bundle; resolves { imported, problems }. */
    async importBundle(bundle) {
      const res = await call(getConnection, "/handoff/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bundle) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `The bridge answered ${res.status}.`);
      return data;
    },
  };
}
