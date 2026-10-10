/**
 * hoverToggle.js — the "Hover over tabs" toolbar button.
 *
 * Click flow (all inside one user gesture, which Chrome requires for the
 * permission prompt):
 *   1. ask for access to http(s) pages (first time only)
 *   2. tell the service worker to switch hover mode on or off
 *   3. reflect the result on the button
 */

const ALL_PAGES = ["http://*/*", "https://*/*"];

/** @param {{buttonEl:HTMLElement, onToast?:(msg:string, type?:string)=>void}} deps */
export function wireHoverToggle({ buttonEl, onToast = () => {} }) {
  if (!buttonEl) return;
  let enabled = false;

  const paint = () => {
    buttonEl.classList.toggle("active", enabled);
    buttonEl.setAttribute("aria-pressed", String(enabled));
    buttonEl.title = enabled
      ? "Hover mode is ON — the editor floats over every tab. Click to turn off."
      : "Float the editor over any tab (draggable, minimizable)";
    buttonEl.querySelector(".hover-label").textContent = enabled ? "Hover: on" : "Hover over tabs";
  };

  const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

  /** Asks for page access if we don't have it yet. Must run from the click. */
  async function ensureAccess() {
    if (await chrome.permissions.contains({ origins: ALL_PAGES })) return true;
    return chrome.permissions.request({ origins: ALL_PAGES });
  }

  buttonEl.addEventListener("click", async () => {
    const next = !enabled;
    if (next && !(await ensureAccess())) {
      onToast("Hover mode needs permission to show over web pages.", "error");
      return;
    }
    const result = await send({ type: "HOVER_SET", enabled: next });
    if (!result?.ok) {
      onToast(result?.error || "Couldn't change hover mode.", "error");
      return;
    }
    enabled = result.enabled;
    paint();
    onToast(enabled ? "Hover mode on — look for the bubble on any tab." : "Hover mode off.", "info");
  });

  // Initial state from the service worker.
  send({ type: "HOVER_STATUS" }).then((res) => { enabled = !!res?.enabled; paint(); });
  paint();
}
