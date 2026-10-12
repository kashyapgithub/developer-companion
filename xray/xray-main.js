/**
 * xray/xray-main.js — runs in the PAGE's own JavaScript world (not the
 * extension's isolated one), because React/Vue keep their component info on
 * DOM nodes in a way the isolated world can't see.
 *
 * Protocol: xray.js dispatches a "dc-xray-name" event on an element; we work
 * out the nearest framework component name and write it to
 * <html data-dc-xray-name="...">, which xray.js reads straight back (the
 * dispatch is synchronous) and clears. Nothing else on the page is touched.
 */
(() => {
  if (window.__dcXrayMain) return;
  window.__dcXrayMain = true;

  /** React: walk the fiber chain up to the first named function/class component. */
  function reactName(el) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    for (let fiber = key && el[key]; fiber; fiber = fiber.return) {
      const type = fiber.type;
      if (typeof type === "function" || (type && typeof type === "object")) {
        const name = type.displayName || type.name || type.render?.displayName || type.render?.name;
        if (name) return name;
      }
    }
    return null;
  }

  /** Vue 3 (component instance on the node) and Vue 2 (__vue__). */
  function vueName(el) {
    const v3 = el.__vueParentComponent?.type;
    if (v3) return v3.name || v3.__name || (v3.__file ? v3.__file.split("/").pop().replace(/\.vue$/, "") : null);
    return el.__vue__?.$options?.name || null;
  }

  document.addEventListener("dc-xray-name", (event) => {
    let name = null;
    try { name = reactName(event.target) || vueName(event.target); } catch { /* page internals changed */ }
    document.documentElement.setAttribute("data-dc-xray-name", name || "");
  }, true);
})();
