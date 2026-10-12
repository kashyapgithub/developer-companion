/**
 * picker/describe.js — shared by the element picker and X-ray mode.
 *
 * Turns a DOM element into plain data an agent can use (selector, HTML with
 * private values removed, computed styles, position, ancestry), and offers a
 * few DOM helpers that understand Shadow DOM. Classic script: it exposes
 * `self.__dcDescribe` so it can be injected ahead of picker.js / xray.js.
 */
(function () {
  if (self.__dcDescribe) return;

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

  // ---- DOM helpers that cross Shadow DOM boundaries --------------------------

  /** Parent element, stepping out of a shadow root to its host. Null at the top. */
  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode?.();
    return root && root.host ? root.host : null;
  }

  /** The element under a point, looking inside open shadow roots too. */
  function elementAt(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  /** Ancestors from the page root down to `el` (inclusive), as short labels. */
  function hierarchy(el) {
    const chain = [];
    for (let n = el; n; n = parentOf(n)) chain.unshift(n);
    return chain.filter((n) => n !== document.documentElement || chain.length === 1);
  }

  self.__dcDescribe = { describe, label, cssPath, parentOf, elementAt, hierarchy };
})();
