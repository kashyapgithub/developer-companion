/**
 * elementPicker.js — the editor side of "Pick an element on the page".
 *
 * Asks the background to start the picker on the page you were just on. When
 * you click an element there, the result comes back here and is placed on the
 * canvas as a cropped screenshot. The element's selector, HTML, computed
 * styles and position ride along in the shape's `meta`, so they reach your
 * agent inside latest.json.
 */

const PAGE_ORIGINS = ["http://*/*", "https://*/*"];

/** Layer name like  "button — Save changes". */
export function elementLayerName(el) {
  const text = (el.text || "").slice(0, 28);
  return text ? `${el.tag} — ${text}` : el.tag;
}

/** What goes into the shape's meta (kept compact: the agent reads this). */
export function elementMeta(el) {
  return {
    kind: "element",
    selector: el.selector,
    tag: el.tag,
    role: el.role,
    text: el.text,
    html: el.html,
    styles: el.styles,
    ancestry: el.ancestry,
    component: el.component || null,   // React/Vue component name (X-ray mode)
    hierarchy: el.hierarchy || null,   // page root → element, as labels (X-ray mode)
    rect: el.rect,
    url: el.url,
    title: el.title,
  };
}

/**
 * @param {{imageImport:{addDataUrl:Function}, say:(text:string)=>void}} deps
 * @returns {{start:()=>Promise<string>}} start() resolves to "started" or an error message
 */
export function createElementPicker({ imageImport, say }) {
  let pendingId = null;

  chrome.runtime.onMessage.addListener(async (message) => {
    if (message?.type !== "ELEMENT_RESULT" || message.requestId !== pendingId) return;
    pendingId = null;
    if (message.cancelled) return say("Pick cancelled.");
    if (!message.ok || !message.cropDataUrl) return say("Couldn't capture that element.");
    const added = await imageImport.addDataUrl(message.cropDataUrl, {
      name: elementLayerName(message.element),
      meta: elementMeta(message.element),
    });
    say(added ? `Added ${message.element.tag} with its HTML and styles.` : "Couldn't add it to the canvas.");
  });

  /** Must be called from a click (it may need to ask for page access). */
  async function start() {
    if (!(await chrome.permissions.contains({ origins: PAGE_ORIGINS }))) {
      if (!(await chrome.permissions.request({ origins: PAGE_ORIGINS }))) return "Picking needs permission to see web pages.";
    }
    pendingId = `pick-${Date.now().toString(36)}`;
    const res = await chrome.runtime.sendMessage({ type: "PICK_ELEMENT", requestId: pendingId });
    if (!res?.ok) { pendingId = null; return res?.error || "Couldn't start picking."; }
    return "started";
  }

  return { start };
}
