/**
 * hover-manager.js — turns "hover over tabs" mode on and off (service worker side).
 *
 * ON  = register the hover content scripts for every http(s) page (so new and
 *       reloaded tabs get them) + inject them into tabs that are already open.
 * OFF = unregister, then ask every tab to remove its floating window.
 *
 * The on/off flag is mirrored in chrome.storage.local so the toolbar button
 * can show the right state and the registration can be repaired after an
 * extension update.
 * -------------------------------------------------------------------------- */

const SCRIPT_ID = "dc-hover";
const FLAG_KEY = "dcHoverEnabled";
const PAGE_MATCHES = ["http://*/*", "https://*/*"];

/** Load order matters: config -> state -> drag -> dom -> main. */
const HOVER_FILES = [
  "hover/hover-config.js",
  "hover/hover-state.js",
  "hover/hover-drag.js",
  "hover/hover-dom.js",
  "hover/hover-main.js",
];

/** Is the hover content script currently registered with Chrome? */
async function isRegistered() {
  const found = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  return found.length > 0;
}

async function registerScripts() {
  if (await isRegistered()) return;
  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID,
    matches: PAGE_MATCHES,
    js: HOVER_FILES,
    runAt: "document_idle",
    persistAcrossSessions: true,
  }]);
}

/** Injects into already-open tabs; pages Chrome forbids (web store, etc.) are skipped. */
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: PAGE_MATCHES });
  await Promise.all(tabs.map((tab) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: HOVER_FILES }).catch(() => {})
  ));
}

async function removeFromOpenTabs() {
  const tabs = await chrome.tabs.query({ url: PAGE_MATCHES });
  await Promise.all(tabs.map((tab) =>
    chrome.tabs.sendMessage(tab.id, { type: "HOVER_REMOVE" }).catch(() => {})
  ));
}

export async function isHoverEnabled() {
  const { [FLAG_KEY]: flag } = await chrome.storage.local.get(FLAG_KEY);
  return !!flag && (await isRegistered());
}

/**
 * Turns hover mode on/off.
 * Needs host access to http(s) pages; the editor requests it from the button
 * click (a user gesture), so by the time we get here it should be granted.
 * @returns {Promise<{ok:boolean, enabled:boolean, error?:string}>}
 */
export async function setHoverEnabled(enabled) {
  try {
    if (enabled) {
      const granted = await chrome.permissions.contains({ origins: PAGE_MATCHES });
      if (!granted) return { ok: false, enabled: false, error: "Site access was not granted" };
      await registerScripts();
      await injectIntoOpenTabs();
    } else {
      if (await isRegistered()) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      await removeFromOpenTabs();
    }
    await chrome.storage.local.set({ [FLAG_KEY]: enabled });
    return { ok: true, enabled };
  } catch (err) {
    return { ok: false, enabled: false, error: String(err?.message || err) };
  }
}

/** Startup repair: flag says "on" but registration was lost (e.g. extension update). */
export async function repairHoverRegistration() {
  const { [FLAG_KEY]: flag } = await chrome.storage.local.get(FLAG_KEY);
  if (flag && !(await isRegistered())) {
    const granted = await chrome.permissions.contains({ origins: PAGE_MATCHES });
    if (granted) await registerScripts();
    else await chrome.storage.local.set({ [FLAG_KEY]: false });
  }
}
