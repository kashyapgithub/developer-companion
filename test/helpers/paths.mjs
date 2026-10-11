/** Absolute path of the repository root, for tests that load the extension or server. */
import { fileURLToPath } from "node:url";
export const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
