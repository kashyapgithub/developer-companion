/**
 * picker/picker.js — "point at an element" (injected into the page on demand).
 *
 * Hover highlights the element under the cursor, click picks it, Esc cancels.
 * ↑ / ↓ move to the parent / first child so you can refine without a precise
 * click. The result (selector, HTML, computed styles, position) is sent to the
 * background worker, which adds a screenshot crop and hands it to the editor.
 *
 * Everything the page could see is removed on exit; the UI lives in a shadow
 * root so the page's CSS can't interfere.
 */
(function () {
  if (self.__dcPickerActive) return;
  self.__dcPickerActive = true;

  // ---- what we collect -------------------------------------------------------

  /** Computed style properties an agent needs to rebuild the element. */
  const STYLE_PROPS = [
    "display", "position", "width", "height", "margin", "padding",
    "color", "background-color", "background-image", "opacity",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
    "border", "border-radius", "box-shadow",
    "flex-direction", "justify-content", "align-items", "gap", "grid-template-columns",
  ];
  const MAX_HTML = 3500;
  const MAX_TEXT = 300;

  /** Short unique-ish CSS selector: id, test id, or a tag/class path with nth-of-type. */
  function cssPath(el) {
    const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
    if (el.id && unique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
    for (const attr of ["data-testid", "data-test", "data-cy"]) {
      const v = el.getAttribute(attr);
      if (v && unique(`[${attr}="${CSS.escape(v)}"]`)) return `[${attr}="${CSS.escape(v)}"]`;
    }
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const classes = [...node.classList].filter((c) => c.length < 30 && !/\d{4,}/.test(c)).slice(0, 2);
      if (classes.length) part += classes.map((c) => `.${CSS.escape(c)}`).join("");
      const siblings = node.parentElement ? [...node.parentElement.children].filter((s) => s.tagName === node.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
      if (unique(parts.join(" > "))) break;
    }
    return parts.join(" > ");
  }

  /** Short label like  button#save.primary  for the highlight chip. */
  function label(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  }

  /** outerHTML without anything private: input values and password fields are blanked. */
  function safeHtml(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll("input, textarea").forEach((n) => {
      n.removeAttribute("value");
      if (n.tagName === "TEXTAREA") n.textContent = "";
    });
    if (clone.matches?.("input, textarea")) clone.removeAttribute("value");
    const html = clone.outerHTML;
    return html.length > MAX_HTML ? html.slice(0, MAX_HTML) + "…(truncated)" : html;
  }

  function describe(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const styles = {};
    for (const prop of STYLE_PROPS) styles[prop] = cs.getPropertyValue(prop);
    const ancestry = [];
    for (let p = el.parentElement; p && ancestry.length < 4 && p !== document.documentElement; p = p.parentElement) ancestry.push(label(p));
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      ariaLabel: el.getAttribute("aria-label") || null,
      text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, MAX_TEXT),
      html: safeHtml(el),
      styles,
      ancestry,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      viewport: { w: innerWidth, h: innerHeight },
      url: location.href,
      title: document.title,
    };
  }

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
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== current) highlight(el);
  };
  /** Stops the page reacting to the pick (links, buttons, drags). */
  const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const onClick = (e) => {
    swallow(e);
    const el = current || document.elementFromPoint(e.clientX, e.clientY);
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
