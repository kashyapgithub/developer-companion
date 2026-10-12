/**
 * review-upload.js — sends a finished video review to the local server:
 * first the video file (raw, streamed to disk), then the moments and notes.
 */

import { logSender } from "../lib/log-sender.js";

/**
 * @param {{id:string, blob:Blob, durationSeconds:number, moments:object[], source?:string, recordingId?:string|null}} review
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function uploadReview({ id, blob, durationSeconds, moments, source, recordingId }) {
  const serverUrl = await logSender.getEffectiveServerUrl();
  const headers = await logSender.getRequestHeaders();
  try {
    if (blob.size) {
      const up = await fetch(`${serverUrl}/video/upload?id=${encodeURIComponent(id)}`, { method: "POST", headers: { ...headers, "Content-Type": "video/webm" }, body: blob });
      if (!up.ok) return { ok: false, error: up.status === 401 ? "Wrong or missing access code." : `The agent server refused the video (${up.status}).` };
    }
    const res = await fetch(`${serverUrl}/video/review`, { method: "POST", headers, body: JSON.stringify({ id, durationSeconds, moments, source, recordingId }) });
    return res.ok ? { ok: true } : { ok: false, error: `The agent server said ${res.status}.` };
  } catch {
    return { ok: false, error: "Can't reach the agent server. Is it running?" };
  }
}
