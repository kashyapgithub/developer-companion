/** Shared by the agent-tool handlers (kept apart from index.js so handlers can import it without a cycle). */

/** Standard "no usable tab" failure. */
export const noTab = (urlContains) => ({
  status: "failed",
  result: { error: `No open tab on an allowed site${urlContains ? ` matching "${urlContains}"` : ""}. The user can add sites in the extension's settings (localhost is allowed by default).` },
});
