/**
 * screenshotMenu.js
 * --------------------------------------------------------------------------
 * The "Add screenshot" button at the top of the toolbar:
 *
 *   Paste from clipboard   reads the clipboard now (same as Ctrl/Cmd+V)
 *   Upload image…          file picker
 *   Capture this tab       screenshots the web page you were just on (no picker)
 *   Pick an element…       point at part of a page: screenshot + HTML + styles
 *   Capture screen/window… browser's screen-share picker, grabs one frame
 *   Design tokens…         copies the page's colours, fonts, radii, spacing as CSS + Tailwind
 *
 * Shortcut Ctrl/Cmd+Shift+K: paste from the clipboard if it holds an image,
 * otherwise open the file picker — the one-keystroke path.
 * -------------------------------------------------------------------------- */

const MESSAGES = {
  none: "No image on the clipboard — copy a screenshot first.",
  denied: "Chrome blocked clipboard access — press Ctrl/Cmd+V instead.",
  cancelled: "Capture cancelled.",
  unsupported: "Screen capture isn't available here.",
};

const PAGE_ORIGINS = ["http://*/*", "https://*/*"];

/** Asks the background to screenshot the current web page; resolves to "added" or an error message. */
async function captureCurrentTab(imageImport) {
  // Page access is granted once (same permission as Hover over tabs). Must be asked from the click.
  if (!(await chrome.permissions.contains({ origins: PAGE_ORIGINS }))) {
    if (!(await chrome.permissions.request({ origins: PAGE_ORIGINS }))) return "Capturing a tab needs permission to see web pages.";
  }
  const res = await chrome.runtime.sendMessage({ type: "CAPTURE_TAB" });
  if (!res?.ok) return res?.error || "Couldn't capture the tab.";
  let host = "";
  try { host = new URL(res.url).host; } catch { /* keep empty */ }
  const added = await imageImport.addDataUrl(res.dataUrl, { name: host ? `Tab: ${host}` : "Tab capture", meta: { kind: "tab-capture", url: res.url, title: res.title } });
  return added ? "added" : "Couldn't add the capture to the canvas.";
}

/** Copies the open page's design tokens (CSS variables + Tailwind) to the clipboard; resolves to a status message. */
async function copyDesignTokens() {
  if (!(await chrome.permissions.contains({ origins: PAGE_ORIGINS }))) {
    if (!(await chrome.permissions.request({ origins: PAGE_ORIGINS }))) return "Reading a page's styles needs permission to see web pages.";
  }
  const res = await chrome.runtime.sendMessage({ type: "DESIGN_TOKENS" });
  if (!res?.ok) return res?.error || "Couldn't read the page's styles.";
  try { await navigator.clipboard.writeText(`${res.css}\n\n${res.tailwind}`); }
  catch { return "Read the styles, but Chrome blocked the clipboard — click the page and try again."; }
  return `Design tokens copied (${res.summary})`;
}

export function wireScreenshotMenu({ buttonEl, menuEl, statusEl, imageImport, elementPicker }) {
  let statusTimer = null;
  const say = (text) => {
    statusEl.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 9000);   // long enough to read an error
  };
  const open = () => menuEl.classList.remove("hidden");
  const close = () => menuEl.classList.add("hidden");

  /** Runs one of the three actions and reports the outcome in the little status text. */
  async function run(action) {
    close();
    if (action === "upload") { imageImport.pick(); return; }
    if (action === "tokens") { say(await copyDesignTokens()); return; }
    if (action === "element") { const r = await elementPicker.start(); say(r === "started" ? "Click an element on the page — Esc cancels." : r); return; }
    const result = action === "paste" ? await imageImport.pasteFromClipboard()
      : action === "tab" ? await captureCurrentTab(imageImport)
      : await imageImport.captureScreen();
    if (result !== "added") say(MESSAGES[result] || result || "");
  }

  buttonEl.addEventListener("click", (e) => { e.stopPropagation(); menuEl.classList.contains("hidden") ? open() : close(); });
  menuEl.addEventListener("click", (e) => {
    const item = e.target.closest("[data-shot]");
    if (item) run(item.dataset.shot);
  });
  document.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      imageImport.pasteFromClipboard().then((r) => { if (r !== "added") imageImport.pick(); });
    }
  });

  return { run };
}
