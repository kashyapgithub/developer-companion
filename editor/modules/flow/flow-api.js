/**
 * flow-api.js — sends the flowchart to the bridge (POST /flow).
 * Uses the same saved connection as "Send to project"; errors are fit to show the user.
 */

import { loadConnection, receiverBase, requestHeaders, describeConnection } from "../connection.js";

/** @param {{graph: object, mermaid: string, explanation: string, pngBase64: string}} payload */
export async function sendFlow(payload, getConnection = loadConnection) {
  const conn = await getConnection();
  const base = receiverBase(conn);
  if (!base) throw new Error("No address set — open “Agent connection” and enter the VM or computer address.");
  let res;
  try {
    res = await fetch(`${base}/flow`, { method: "POST", headers: requestHeaders(conn, { "Content-Type": "application/json" }), body: JSON.stringify(payload) });
  } catch { throw new Error(`Can't reach ${describeConnection(conn)} — is the bridge running?`); }
  if (res.status === 401) throw new Error("Wrong access code — open “Agent connection” and re-enter it.");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `The bridge answered ${res.status}.`);
  return data;
}
