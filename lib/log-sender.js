/**
 * log-sender.js — batches log rows in memory and POSTs them to the local
 * agent companion server's /logs endpoint. Plain HTTP, zero config needed.
 */

const MAX_BATCH_SIZE = 50;
const DEFAULT_SERVER_URL = "http://127.0.0.1:5959";

class LogSender {
  constructor() {
    this.queue = [];
  }

  /** Add one row to the queue; auto-flushes once the batch is large enough. */
  async enqueue(row) {
    this.queue.push(row);
    if (this.queue.length >= MAX_BATCH_SIZE) {
      await this.flush();
    }
  }

  /** Resolves the effective target server URL */
  async getEffectiveServerUrl() {
    const { serverUrl, connection } = await chrome.storage.local.get(["serverUrl", "connection"]);
    if (serverUrl) return serverUrl.replace(/\/$/, "");
    if (connection?.port) {
      if (connection.where === "remote" && connection.host) {
        return `http://${connection.host}:${connection.port}`;
      }
      return `http://127.0.0.1:${connection.port}`;
    }
    return DEFAULT_SERVER_URL;
  }

  /**
   * Headers for talking to the server. Adds the access code when the agent
   * runs on another computer (the server requires it from remote callers).
   */
  async getRequestHeaders() {
    const { connection } = await chrome.storage.local.get("connection");
    const headers = { "Content-Type": "application/json" };
    if (connection?.where === "remote" && connection.token) headers["X-Sketch-Token"] = connection.token;
    return headers;
  }

  /** Send everything currently queued. Safe to call even if queue is empty. */
  async flush() {
    if (this.queue.length === 0) return { ok: true, count: 0 };

    const serverUrl = await this.getEffectiveServerUrl();
    const batch = this.queue.splice(0, this.queue.length);

    try {
      const res = await fetch(`${serverUrl}/logs`, {
        method: "POST",
        headers: await this.getRequestHeaders(),
        body: JSON.stringify(batch),
      });
      return { ok: res.ok, count: batch.length };
    } catch (err) {
      // Re-queue or log gracefully
      console.warn("[developer-companion] flush failed — companion server offline?", err);
      return { ok: false, error: err.message, count: batch.length };
    }
  }
}

export const logSender = new LogSender();
