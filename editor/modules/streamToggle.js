/**
 * streamToggle.js — the "Stream console" button in the top bar.
 *
 * On  = every console line from your allowed tabs reaches the agent within a moment
 *       (the agent follows along with watch_console).
 * Off = back to normal (errors only, in slower batches).
 *
 * The background worker owns the switch; the saved flag (chrome.storage.local
 * "dcStreamConsole") is mirrored here, so the editor tab and the floating window
 * always show the same state.
 */

const STREAM_KEY = "dcStreamConsole";

const TITLES = {
  off: "Stream console to agent: send every console line to your agent as it happens",
  on: "Streaming console to your agent — click to stop",
};

/** Pure: how the button should look for a state. */
export function describeState(on) {
  return { pressed: on, title: on ? TITLES.on : TITLES.off, label: on ? "Streaming" : "Stream" };
}

/** @param {{buttonEl: HTMLElement, say?: (text: string) => void}} opts */
export function wireStreamToggle({ buttonEl, say = () => {} }) {
  if (!buttonEl) return;
  const labelEl = buttonEl.querySelector(".stream-label");

  function render(on) {
    const d = describeState(on);
    buttonEl.setAttribute("aria-pressed", String(d.pressed));
    buttonEl.classList.toggle("active", d.pressed);
    buttonEl.title = d.title;
    if (labelEl) labelEl.textContent = d.label;
  }

  buttonEl.addEventListener("click", async () => {
    const turnOn = buttonEl.getAttribute("aria-pressed") !== "true";
    const res = await chrome.runtime.sendMessage({ type: "STREAM_SET", enabled: turnOn }).catch(() => null);
    if (!res?.ok) { say("Couldn't change streaming — reload the extension and try again."); return; }
    render(res.enabled);
    say(res.enabled ? "Streaming the console to your agent." : "Streaming stopped.");
  });

  // Initial state, then follow changes made elsewhere (floating window, another editor tab).
  chrome.storage.local.get(STREAM_KEY).then((v) => render(!!v[STREAM_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STREAM_KEY]) render(!!changes[STREAM_KEY].newValue);
  });
}
