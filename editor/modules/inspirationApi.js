/**
 * inspirationApi.js — talks to the local bridge's /inspiration routes.
 *
 * Uses the same saved connection as "Send to project" (this computer, or a VM
 * with an access code), so the library lives wherever the agent lives.
 * Every call returns the parsed JSON, or throws an Error with a message that is
 * fit to show the user as-is.
 */

import { loadConnection, receiverBase, requestHeaders, describeConnection } from "./connection.js";

/** Builds the API. `connection` can be injected for tests; by default it is read fresh from storage. */
export function createInspirationApi({ getConnection = loadConnection } = {}) {
  /** Resolves { base, headers, where } for the current connection or throws a readable error. */
  async function target() {
    const conn = await getConnection();
    const base = receiverBase(conn);
    if (!base) throw new Error("No address set — open “Agent connection” and enter the VM or computer address.");
    return { base, conn, headers: (extra) => requestHeaders(conn, extra), where: describeConnection(conn) };
  }

  /** One request: network failure, 401 and server errors all become friendly messages. */
  async function request(method, path, body) {
    const t = await target();
    let res;
    try {
      res = await fetch(t.base + path, {
        method,
        headers: t.headers(body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(`Can't reach ${t.where} — is the bridge running?`);
    }
    if (res.status === 401) throw new Error("Wrong access code — open “Agent connection” and re-enter it.");
    return res;
  }

  const json = async (method, path, body) => {
    const res = await request(method, path, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `The bridge answered ${res.status}.`);
    return data;
  };

  return {
    list: () => json("GET", "/inspiration"),
    createFolder: (name) => json("POST", "/inspiration/folders", { name }),
    renameFolder: (id, name) => json("PATCH", `/inspiration/folders/${id}`, { name }),
    deleteFolder: (id) => json("DELETE", `/inspiration/folders/${id}`),
    addItem: (item) => json("POST", "/inspiration/items", item),
    updateItem: (id, patch) => json("PATCH", `/inspiration/items/${id}`, patch),
    deleteItem: (id) => json("DELETE", `/inspiration/items/${id}`),
    /** The image as a blob (an <img> tag can't send the access-code header, so we fetch it ourselves). */
    async imageBlob(id) {
      const res = await request("GET", `/inspiration/image/${id}`);
      if (!res.ok) throw new Error("Couldn't load the image.");
      return res.blob();
    },
  };
}

/** Blob → data URL (what the canvas stores for images). */
export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
