/**
 * picker/picker.js — "point at an element" (injected into the page on demand).
 *
 * Hover highlights the element under the cursor, click picks it, Esc cancels.
 * ↑ / ↓ move to the parent / first child so you can refine without a precise
 * click. The result (selector, HTML, computed styles, position) is sent to the
 * background worker, which adds a screenshot crop and hands it to the editor.
 *
 * Shared element description lives in picker/describe.js (injected first).
 * Everything the page could see is removed on exit; the UI lives in a shadow
 * root so the page's CSS can't interfere.
 */
(function () {
  if (self.__dcPickerActive) return;
  self.__dcPickerActive = true;

  const { describe, label } = self.__dcDescribe;

  // ---- overlay UI ------------------------------------------------------------

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .box { position: fixed; border: 2px solid #4f6bff; background: rgba(79,107,255,.14); border-radius: 2px; display: none; box-shadow: 0 0 0 1px rgba(255,255,255,.6); }
      .chip { position: fixed; display: none; padding: 2px 7px; border-radius: 4px; background: #4f6bff; color: #fff; font: 600 11px/16px system-ui, sans-serif; white-space: nowrap; }
      .tip { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); padding: 8px 14px; border-radius: 18px; background: #1a1b22; color: #e8e9ef; font: 500 12.5px/1 system-ui, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,.4); }
    </style>
    <div class="box"></div><div class="chip"></div>
    <div class="tip">Click an element to send it · ↑ parent · ↓ child · Esc to cancel</div>`;
  const box = root.querySelector(".box"), chip = root.querySelector(".chip");
  const cursorStyle = document.createElement("style");
  cursorStyle.textContent = "*{cursor:crosshair !important}";

  let current = null;

  function highlight(el) {
    current = el;
    if (!el) { box.style.display = chip.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    chip.textContent = `${label(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    Object.assign(chip.style, { display: "block", left: Math.max(0, r.left) + "px", top: (r.top > 24 ? r.top - 22 : r.bottom + 4) + "px" });
  }

  // ---- interaction -----------------------------------------------------------

  const onMove = (e) => {
    const el = self.__dcDescribe.elementAt(e.clientX, e.clientY);
    if (el && el !== current) highlight(el);
  };
  /** Stops the page reacting to the pick (links, buttons, drags). */
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const onClick = (e) => {
    swallow(e);
    const el = current || self.__dcDescribe.elementAt(e.clientX, e.clientY);
    if (!el) return;
    const payload = describe(el);
    cleanup();
    chrome.runtime.sendMessage({ type: "ELEMENT_PICKED", payload });
  };
  const onKey = (e) => {
    if (e.key === "Escape") { swallow(e); cleanup(); chrome.runtime.sendMessage({ type: "ELEMENT_PICK_CANCEL" }); }
    else if (e.key === "ArrowUp" && current?.parentElement && current.parentElement !== document.documentElement) { swallow(e); highlight(current.parentElement); }
    else if (e.key === "ArrowDown" && current?.firstElementChild) { swallow(e); highlight(current.firstElementChild); }
  };
  const onScroll = () => highlight(current);

  function cleanup() {
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu"]) document.removeEventListener(type, swallow, true);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("scroll", onScroll, true);
    host.remove();
    cursorStyle.remove();
    self.__dcPickerActive = false;
  }

  document.documentElement.append(host, cursorStyle);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  addEventListener("scroll", onScroll, true);
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu"]) document.addEventListener(type, swallow, true);
})();
