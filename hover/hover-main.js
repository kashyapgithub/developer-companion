/**
 * hover-main.js  (content script 5/5)
 * --------------------------------------------------------------------------
 * Wires state + drag + DOM together and reacts to background messages.
 *
 * Lifecycle
 *   inject  -> build UI, restore saved state, show bubble or window
 *   user    -> drag / resize / minimize / restore, saved on every change
 *   storage -> another tab moved or minimized the window: follow it
 *   HOVER_REMOVE message -> tear everything down (hover mode switched off)
 * -------------------------------------------------------------------------- */
(function () {
  // Guard: the script can be injected twice (registered + manual); run once.
  if (self.__dcHoverLoaded) return;
  if (location.protocol === "chrome-extension:") return;
  self.__dcHoverLoaded = true;

  const ns = self.__dcHover;
  const { STATE_KEY, EDITOR_URL, BUBBLE } = ns.config;
  const { clampRect, normalize, loadState, saveState } = ns.state;
  const { makeDraggable, makeResizable } = ns.drag;

  const ui = ns.dom.buildUi();
  let state = null;
  let frame = null;
  let busy = false; // true during drag/resize, ignores echo from storage

  // ---- Rendering --------------------------------------------------------

  /** Applies `state` to the DOM: which element shows, where, and how big. */
  function render() {
    const { minimized, panel, bubble } = state;
    ui.panel.classList.toggle("hidden", minimized);
    ui.bubble.classList.toggle("hidden", !minimized);

    Object.assign(ui.panel.style, {
      left: panel.x + "px", top: panel.y + "px", width: panel.w + "px", height: panel.h + "px",
    });
    Object.assign(ui.bubble.style, { left: bubble.x + "px", top: bubble.y + "px" });

    if (!minimized) ensureFrame();
  }

  /** Lazily creates the editor iframe the first time the window opens. */
  function ensureFrame() {
    if (frame) return;
    frame = ns.dom.buildEditorFrame(EDITOR_URL);
    ui.slot.appendChild(frame);
  }

  function update(patch) {
    state = { ...state, ...patch };
    render();
    saveState(state);
  }

  const setDragging = (on) => { ui.rootEl.classList.toggle("dragging", on); busy = on; };

  // ---- Interactions -----------------------------------------------------

  /** Window: drag by header. */
  function wirePanelDrag() {
    makeDraggable(ui.header, {
      getRect: () => state.panel,
      onStart: () => setDragging(true),
      onMove: (x, y) => {
        state = { ...state, panel: clampRect({ ...state.panel, x, y }, innerWidth, innerHeight) };
        render();
      },
      onEnd: () => { setDragging(false); saveState(state); },
    });
  }

  /** Window: resize by bottom-right grip. */
  function wireResize() {
    makeResizable(ui.grip, {
      getRect: () => state.panel,
      onStart: () => setDragging(true),
      onResize: (w, h) => {
        state = { ...state, panel: clampRect({ ...state.panel, w, h }, innerWidth, innerHeight) };
        render();
      },
      onEnd: () => { setDragging(false); saveState(state); },
    });
  }

  /** Bubble: drag to move, plain click to restore the window. */
  function wireBubble() {
    makeDraggable(ui.bubble, {
      getRect: () => state.bubble,
      onStart: () => setDragging(true),
      onMove: (x, y) => {
        state = { ...state, bubble: clampRect({ x, y }, innerWidth, innerHeight) };
        render();
      },
      onEnd: (moved) => {
        setDragging(false);
        if (moved) saveState(state);
        else update({ minimized: false });
      },
    });
  }

  /** Header buttons: minimize, open in full tab, hide on this page. */
  function wireButtons() {
    ui.header.addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (act === "minimize") update({ minimized: true });
      if (act === "fulltab") chrome.runtime.sendMessage({ type: "OPEN_CANVAS" });
      if (act === "close") teardown(false);
    });
  }

  /** Keeps the window on screen when the browser window is resized. */
  function wireViewport() {
    addEventListener("resize", () => {
      state = {
        ...state,
        panel: clampRect(state.panel, innerWidth, innerHeight),
        bubble: clampRect(state.bubble, innerWidth, innerHeight),
      };
      render();
    });
  }

  // ---- Cross-tab sync + lifecycle ---------------------------------------

  /** When another tab moves/minimizes the window, follow it. */
  function onStorageChange(changes, area) {
    if (area !== "local" || !changes[STATE_KEY] || busy) return;
    state = normalize(changes[STATE_KEY].newValue, innerWidth, innerHeight);
    render();
  }

  function onMessage(message) {
    if (message?.type === "HOVER_REMOVE") teardown(true);
  }

  /** Removes the UI. `forget` also clears the double-injection guard (mode turned off). */
  function teardown(forget) {
    chrome.storage.onChanged.removeListener(onStorageChange);
    chrome.runtime.onMessage.removeListener(onMessage);
    ui.host.remove();
    if (forget) self.__dcHoverLoaded = false;
  }

  // ---- Boot -------------------------------------------------------------

  async function boot() {
    state = await loadState();
    document.documentElement.appendChild(ui.host);
    wirePanelDrag();
    wireResize();
    wireBubble();
    wireButtons();
    wireViewport();
    chrome.storage.onChanged.addListener(onStorageChange);
    chrome.runtime.onMessage.addListener(onMessage);
    render();
  }

  boot();
})();
