/**
 * xray.js — the "X-ray" toolbar button, and the editor side of "Add to canvas".
 *
 * The button switches X-ray mode on the web page you were just on (hover to
 * see what each element is, click to select, read its hierarchy). The page's
 * "Add to canvas" button comes back here as XRAY_TO_CANVAS, and each selected
 * element lands on the canvas as a cropped image carrying its selector,
 * component name, hierarchy, HTML and styles.
 */

import { elementLayerName, elementMeta } from "./elementPicker.js";

const PAGE_ORIGINS = ["http://*/*", "https://*/*"];

/** @param {{buttonEl:HTMLElement, imageImport:{addDataUrl:Function}, say:(msg:string)=>void}} deps */
export function wireXray({ buttonEl, imageImport, say }) {
  if (!buttonEl) return;

  buttonEl.addEventListener("click", async () => {
    // Page access is requested once; it has to happen inside this click.
    if (!(await chrome.permissions.contains({ origins: PAGE_ORIGINS })) && !(await chrome.permissions.request({ origins: PAGE_ORIGINS }))) {
      say("X-ray needs permission to see web pages.");
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: "XRAY_TOGGLE" });
    if (!res?.ok) { say(res?.error || "Couldn't start X-ray."); return; }
    buttonEl.classList.toggle("active", res.active);
    buttonEl.setAttribute("aria-pressed", String(res.active));
    say(res.active ? "X-ray is on — hover the page, click to select. Esc leaves." : "X-ray is off.");
  });

  // Elements sent from the page. The background picks exactly one editor to receive them.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "XRAY_TO_CANVAS") return;
    (async () => {
      for (const { element, cropDataUrl } of message.items) {
        if (cropDataUrl) await imageImport.addDataUrl(cropDataUrl, { name: elementLayerName(element), meta: elementMeta(element) });
      }
      sendResponse({ ok: true });
    })();
    return true; // answer asynchronously
  });
}
