/**
 * handoffUi.js — the "Export handoff" / "Import handoff" buttons in Agent settings.
 *
 * Export downloads one .json file of everything the agent sees. Import reads such a
 * file and restores it on the connected bridge (this computer, or the VM).
 */

import { createHandoffApi } from "./handoffApi.js";

/** "3 video moments, 2 images" from an import result. */
export function summarizeImport({ imported = {}, problems = [] }) {
  const labels = { sketch: "sketch", xray_elements: "X-ray elements", video_moments: "video moments", inspiration_images: "inspiration images" };
  const parts = Object.entries(imported).map(([k, v]) => (v === true ? labels[k] : `${v} ${labels[k]}`));
  const text = parts.length ? `Imported: ${parts.join(", ")}.` : "Nothing to import in that file.";
  return problems.length ? `${text} Problems: ${problems.join("; ")}` : text;
}

/** Saves a blob as a download. */
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * @param {{exportBtn: HTMLElement, importBtn: HTMLElement, fileInput: HTMLInputElement, say: (text: string) => void, api?: object}} els
 */
export function wireHandoff({ exportBtn, importBtn, fileInput, say, api = createHandoffApi() }) {
  exportBtn.addEventListener("click", async () => {
    say("Packing the session…");
    try { download(await api.exportBundle(), "developer-companion-handoff.json"); say("Handoff file saved to your downloads."); }
    catch (err) { say(err.message); }
  });
  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    say("Importing…");
    try { say(summarizeImport(await api.importBundle(JSON.parse(await file.text())))); }
    catch (err) { say(err instanceof SyntaxError ? "That file isn't valid JSON." : err.message); }
  });
}
