/** motion-api.js — sends the 3D scene to the bridge (POST /motion). Uses the saved connection. */

import { logSender } from "../../lib/log-sender.js";

/** @param {object} doc from buildMotionDoc  @param {string} pngBase64 */
export async function sendMotion(doc, pngBase64) {
  const base = await logSender.getEffectiveServerUrl();
  const headers = await logSender.getRequestHeaders();
  let res;
  try { res = await fetch(`${base}/motion`, { method: "POST", headers, body: JSON.stringify({ doc, pngBase64 }) }); }
  catch { throw new Error("Can't reach the agent server. Is it running? (npm start inside server/)"); }
  if (res.status === 401) throw new Error("Wrong or missing access code.");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}
