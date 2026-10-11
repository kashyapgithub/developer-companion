/**
 * sketch-overlay/overlay.js — the sketch, laid over your running app.
 *
 * Injected on demand (chrome.scripting) into one web page. It shows the
 * sketch as a semi-transparent image on top of the page so you can compare
 * design and reality. The image ignores the mouse, so the app stays usable;
 * a small control bar offers opacity, an "Align" mode to drag the sketch
 * into place, and Close.
 *
 * Everything lives in a closed Shadow DOM so page CSS can't touch it.
 * Exposes window.__dcSketchOverlay = { show(config), hide() }.
 */
(() => {
  if (window.__dcSketchOverlay) return;

  const Z = 2147483646;
  let host = null;

  /** Builds the overlay for `cfg` = { dataUrl, opacity, pixelRatio }. */
  function show(cfg) {
    hide();
    host = document.createElement("div");
    host.style.cssText = `all:initial;position:fixed;inset:0;z-index:${Z};pointer-events:none;`;
    const root = host.attachShadow({ mode: "closed" });

    const img = document.createElement("img");
    img.src = cfg.dataUrl;
    img.alt = "";
    img.draggable = false;
    img.style.cssText = `position:absolute;left:0;top:0;opacity:${cfg.opacity};pointer-events:none;user-select:none;`;
    // The export is rendered at pixelRatio×; show it at 1 sketch-unit = 1 CSS pixel.
    img.onload = () => { img.style.width = `${img.naturalWidth / (cfg.pixelRatio || 1)}px`; };

    root.append(img, buildBar(img, cfg.opacity));
    document.documentElement.appendChild(host);
  }

  function hide() {
    host?.remove();
    host = null;
  }

  /** The control bar: opacity slider, align toggle, close. */
  function buildBar(img, opacity) {
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;right:16px;bottom:16px;display:flex;gap:10px;align-items:center;" +
      "padding:8px 12px;border-radius:10px;background:#1d1f24;color:#e8eaf0;font:12px system-ui,sans-serif;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:auto;";

    const label = document.createElement("span");
    label.textContent = "Sketch";

    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "5"; slider.max = "100"; slider.value = String(Math.round(opacity * 100));
    slider.style.width = "110px";
    slider.oninput = () => { img.style.opacity = String(slider.value / 100); };

    const align = button("Align");
    align.onclick = () => setAligning(img, align);

    const close = button("✕");
    close.title = "Remove the overlay";
    close.onclick = hide;

    bar.append(label, slider, align, close);
    return bar;
  }

  function button(text) {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText = "all:unset;cursor:pointer;padding:3px 9px;border-radius:6px;background:#33363d;";
    return b;
  }

  /** Align mode: the sketch captures the mouse so you can drag it over the page. */
  function setAligning(img, btn) {
    const on = img.style.pointerEvents !== "auto";
    img.style.pointerEvents = on ? "auto" : "none";
    img.style.cursor = on ? "move" : "";
    btn.style.background = on ? "#4f6bff" : "#33363d";
    if (!on) return;
    let drag = null;
    img.onpointerdown = (e) => {
      drag = { x: e.clientX - img.offsetLeft, y: e.clientY - img.offsetTop };
      img.setPointerCapture(e.pointerId);
    };
    img.onpointermove = (e) => {
      if (!drag) return;
      img.style.left = `${e.clientX - drag.x}px`;
      img.style.top = `${e.clientY - drag.y}px`;
    };
    img.onpointerup = () => { drag = null; };
  }

  window.__dcSketchOverlay = { show, hide };
})();
