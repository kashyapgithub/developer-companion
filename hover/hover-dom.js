/**
 * hover-dom.js  (content script 4/5)
 * --------------------------------------------------------------------------
 * Builds the floating UI inside a closed-style Shadow DOM so the host page's
 * CSS can't break it (and ours can't leak into the page).
 *
 * Structure:
 *   host (<div>, fixed, zero size)
 *     #root
 *       .panel   header (drag area + buttons) · iframe slot · resize grip
 *       .bubble  minimized launcher (draggable, click to restore)
 * The iframe is created lazily by hover-main.js on first open, so a tab that
 * stays minimized never loads the editor.
 * -------------------------------------------------------------------------- */
(function () {
  const ns = self.__dcHover;
  const { ICON_URL } = ns.config;

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel, .bubble { position: fixed; z-index: 2147483647; font: 13px/1.4 system-ui, sans-serif; }
    .panel {
      display: flex; flex-direction: column; overflow: hidden;
      background: #fff; border: 1px solid #c9ced8; border-radius: 12px;
      box-shadow: 0 18px 50px rgba(15, 20, 40, .35), 0 2px 8px rgba(15, 20, 40, .2);
    }
    .header {
      display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 8px 0 12px;
      background: #1f2430; color: #f2f4f8; cursor: grab; user-select: none; flex: none;
    }
    .header:active { cursor: grabbing; }
    .header img { width: 18px; height: 18px; border-radius: 4px; }
    .title { flex: 1; font-weight: 600; letter-spacing: .2px; }
    .btn {
      width: 26px; height: 26px; border: 0; border-radius: 6px; cursor: pointer;
      background: transparent; color: inherit; font-size: 15px; line-height: 1;
    }
    .btn:hover { background: rgba(255, 255, 255, .16); }
    .slot { position: relative; flex: 1; min-height: 0; background: #f4f5f8; }
    .slot iframe { width: 100%; height: 100%; border: 0; display: block; background: #fff; }
    .grip {
      position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, #8a93a6 50%, #8a93a6 58%, transparent 58%, transparent 72%, #8a93a6 72%, #8a93a6 80%, transparent 80%);
    }
    .bubble {
      width: 52px; height: 52px; border-radius: 50%; border: 2px solid #fff; cursor: grab;
      background: #1f2430 center / 28px no-repeat; box-shadow: 0 6px 20px rgba(15, 20, 40, .4);
      touch-action: none;
    }
    .bubble:hover { transform: scale(1.06); }
    /* While dragging/resizing, the iframe must not swallow pointer events. */
    .dragging iframe { pointer-events: none; }
    .hidden { display: none !important; }
  `;

  /** @returns {{host:HTMLElement, root:ShadowRoot, panel, header, slot, grip, bubble, buttons}} */
  function buildUi() {
    const host = document.createElement("div");
    host.id = "dc-hover-host";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${STYLES}</style>
      <div id="root">
        <div class="panel hidden">
          <div class="header">
            <img src="${ICON_URL}" alt="" />
            <span class="title">Developer Companion</span>
            <button class="btn" data-act="fulltab" title="Open in a full tab">↗</button>
            <button class="btn" data-act="minimize" title="Minimize">—</button>
            <button class="btn" data-act="close" title="Hide on this page (until reload)">✕</button>
          </div>
          <div class="slot"></div>
          <div class="grip" title="Resize"></div>
        </div>
        <div class="bubble hidden" title="Open Developer Companion" style="background-image:url('${ICON_URL}')"></div>
      </div>`;
    const $ = (sel) => root.querySelector(sel);
    return {
      host, root,
      rootEl: $("#root"),
      panel: $(".panel"), header: $(".header"), slot: $(".slot"), grip: $(".grip"),
      bubble: $(".bubble"),
    };
  }

  /** Creates the editor iframe. Permissions let paste / screen-capture work inside it. */
  function buildEditorFrame(url) {
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.allow = "clipboard-read; clipboard-write; display-capture";
    frame.title = "Developer Companion editor";
    return frame;
  }

  ns.dom = { buildUi, buildEditorFrame };
})();
