/**
 * hover-config.js  (content script 1/5)
 * --------------------------------------------------------------------------
 * Shared constants + the namespace every hover-*.js file hangs its pieces on.
 * Content scripts are classic scripts (no ES modules), so the files are
 * loaded in order by the manifest/injector and talk through `self.__dcHover`.
 * -------------------------------------------------------------------------- */
(function () {
  const ns = (self.__dcHover = self.__dcHover || {});

  ns.config = {
    /** chrome.storage.local key holding position / size / minimized flag. */
    STATE_KEY: "dcHoverState",
    /** The editor page shown inside the floating window. `embedded=1` lets it tune its UI. */
    EDITOR_URL: chrome.runtime.getURL("editor/editor.html?embedded=1"),
    ICON_URL: chrome.runtime.getURL("icons/icon48.png"),
    /** Smallest size the window can be resized to. */
    MIN_W: 380,
    MIN_H: 280,
    /** Diameter of the minimized bubble. */
    BUBBLE: 52,
    /** Keep at least this many px of a dragged element on screen. */
    EDGE: 12,
  };
})();
