/**
 * xray/xray.js — X-ray mode: hover anything on a web page to see what it is,
 * click to select it, and read its place in the page hierarchy.
 *
 *   hover        highlight + name chip (component name, test id, or tag#id.class)
 *   click        select (Shift+click adds more); the page does not react
 *   breadcrumb   the selected element's ancestors, each one clickable
 *   ↑ / ↓        parent / first child     Esc  leave X-ray
 *   Add to canvas / Send to agent / Copy selector   (bottom panel)
 *
 * Injected on demand after picker/describe.js (shared element description) and
 * xray/xray-main.js (page-world helper for React/Vue component names).
 * All UI lives in a closed shadow root so the page's CSS can't touch it.
 */
(function () {
  // Injecting again while active turns X-ray off (the toolbar button is a toggle).
  if (self.__dcXray) { self.__dcXray.stop(); return; }

  const D = self.__dcDescribe;
  const MAX_CRUMBS = 7;
  const NAME_DELAY_MS = 60;     // wait for the pointer to rest before asking for a component name
  const SWALLOWED = ["mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu"];

  /** @type {Element|null} */ let hovered = null;
  /** @type {Element[]} */ let picked = [];
  let nameTimer = null;
  const nameCache = new WeakMap();

  // ---- naming ----------------------------------------------------------------

  /** Framework component name for an element (asks the page-world helper), cached. */
  function componentName(el) {
    if (nameCache.has(el)) return nameCache.get(el);
    const root = document.documentElement;
    el.dispatchEvent(new CustomEvent("dc-xray-name"));
    const name = root.getAttribute("data-dc-xray-name") || null;
    root.removeAttribute("data-dc-xray-name");
    nameCache.set(el, name);
    return name;
  }

  /** Best human name: component, then test id / aria-label, then tag#id.class. */
  function displayName(el) {
    const component = componentName(el);
    const tag = D.label(el);
    if (component) return `${component} · ${tag}`;
    const hint = el.getAttribute("data-testid") || el.getAttribute("aria-label");
    return hint ? `${tag} · ${hint}` : tag;
  }

  // ---- UI ----------------------------------------------------------------------

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { font: 12px/1.4 system-ui, sans-serif; }
      .hover { position: fixed; display: none; border: 1.5px dashed #4f6bff; background: rgba(79,107,255,.10); }
      .sel { position: fixed; border: 2px solid #f5a524; background: rgba(245,165,36,.12); }
      .sel b { position: absolute; left: -2px; top: -18px; padding: 0 6px; background: #f5a524; color: #1a1b22; font-size: 11px; border-radius: 3px 3px 0 0; }
      .chip { position: fixed; display: none; padding: 2px 7px; border-radius: 4px; background: #4f6bff; color: #fff; font-weight: 600; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
      .panel { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(880px, 94vw); box-sizing: border-box;
               padding: 10px 12px; border-radius: 12px; background: #1a1b22; color: #e8e9ef; box-shadow: 0 10px 34px rgba(0,0,0,.45); pointer-events: auto; }
      .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; min-height: 22px; }
      .crumb { all: unset; cursor: pointer; padding: 2px 7px; border-radius: 5px; color: #aeb1c0; }
      .crumb:hover { background: #2a2c37; color: #fff; }
      .crumb.on { background: #4f6bff; color: #fff; }
      .sep { color: #5b5e6e; }
      .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .info { flex: 1; min-width: 0; color: #c9cbd8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .info code { color: #8fa2ff; }
      button.act { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 7px; background: #2a2c37; color: #e8e9ef; white-space: nowrap; }
      button.act:hover { background: #363948; }
      button.act.primary { background: #f5a524; color: #1a1b22; font-weight: 600; }
      button.act[disabled] { opacity: .4; cursor: default; }
      .status { color: #8fe3a8; }
    </style>
    <div class="hover"></div><div class="chip"></div><div class="sels"></div>
    <div class="panel">
      <div class="crumbs"></div>
      <div class="row">
        <div class="info">Hover over the page to inspect · click to select · Shift+click to add more</div>
        <button class="act" data-act="canvas" disabled>Add to canvas</button>
        <button class="act primary" data-act="agent" disabled>Send to agent</button>
        <button class="act" data-act="copy" disabled>Copy selector</button>
        <button class="act" data-act="exit">Exit</button>
      </div>
    </div>`;
  const $ = (sel) => root.querySelector(sel);
  const hoverBox = $(".hover"), chip = $(".chip"), selsEl = $(".sels"), crumbsEl = $(".crumbs"), infoEl = $(".info");
  const cursorStyle = document.createElement("style");
  cursorStyle.textContent = "*{cursor:crosshair !important}";

  const place = (box, el) => {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    return r;
  };

  function paintHover() {
    if (!hovered) { hoverBox.style.display = chip.style.display = "none"; return; }
    const r = place(hoverBox, hovered);
    hoverBox.style.display = "block";
    chip.textContent = `${displayName(hovered)}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    Object.assign(chip.style, { display: "block", left: Math.max(0, r.left) + "px", top: (r.top > 26 ? r.top - 24 : r.bottom + 4) + "px" });
  }

  function paintSelection() {
    selsEl.textContent = "";
    picked.forEach((el, i) => {
      const box = document.createElement("div");
      box.className = "sel";
      place(box, el);
      box.innerHTML = `<b>${i + 1}</b>`;
      selsEl.append(box);
    });
  }

  /** The breadcrumb for the focused element: the last selection, else whatever is hovered. */
  function paintPanel() {
    const focus = picked[picked.length - 1] || hovered;
    crumbsEl.textContent = "";
    if (focus) {
      const chain = D.hierarchy(focus);
      const shown = chain.slice(-MAX_CRUMBS);
      if (chain.length > shown.length) crumbsEl.append(text("…", "sep"));
      shown.forEach((node, i) => {
        if (i || chain.length > shown.length) crumbsEl.append(text("›", "sep"));
        const b = document.createElement("button");
        b.className = "crumb" + (node === focus ? " on" : "");
        b.textContent = D.label(node);
        b.title = componentName(node) || "";
        b.onclick = () => select(node, false);
        crumbsEl.append(b);
      });
      const r = focus.getBoundingClientRect();
      infoEl.innerHTML = "";
      infoEl.append(text(displayName(focus) + "  ", ""), codeEl(D.cssPath(focus)), text(`  ${Math.round(r.width)}×${Math.round(r.height)}`, ""));
    }
    for (const b of root.querySelectorAll("[data-act=canvas],[data-act=agent],[data-act=copy]")) b.disabled = !picked.length;
    root.querySelector("[data-act=agent]").textContent = picked.length > 1 ? `Send ${picked.length} to agent` : "Send to agent";
  }

  const text = (t, cls) => Object.assign(document.createElement("span"), { textContent: t, className: cls });
  const codeEl = (t) => Object.assign(document.createElement("code"), { textContent: t });
  const say = (message) => { infoEl.textContent = ""; infoEl.append(text(message, "status")); };
  const repaint = () => { paintHover(); paintSelection(); paintPanel(); };

  // ---- selection ---------------------------------------------------------------

  /** Selects `el` (replacing the selection, or adding when `additive`). */
  function select(el, additive) {
    if (!el || el === document.documentElement) return;
    picked = additive ? (picked.includes(el) ? picked.filter((p) => p !== el) : [...picked, el]) : [el];
    repaint();
  }

  const moveFocus = (to) => { if (to && to !== document.documentElement) select(to, false); };

  // ---- events --------------------------------------------------------------------

  const overPanel = (e) => e.target === host;     // events from our own panel are retargeted to the host
  const swallow = (e) => { if (overPanel(e)) return; e.preventDefault(); e.stopImmediatePropagation(); };

  function onMove(e) {
    if (overPanel(e)) return;
    const el = D.elementAt(e.clientX, e.clientY);
    if (!el || el === host || el === hovered) return;
    hovered = el;
    paintHover();
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => { paintHover(); if (!picked.length) paintPanel(); }, NAME_DELAY_MS);
    if (!picked.length) paintPanel();
  }

  function onClick(e) {
    if (overPanel(e)) return;
    swallow(e);
    select(hovered || D.elementAt(e.clientX, e.clientY), e.shiftKey);
  }

  function onKey(e) {
    const focus = picked[picked.length - 1] || hovered;
    if (e.key === "Escape") { swallow(e); stop(); }
    else if (e.key === "ArrowUp" && focus) { e.preventDefault(); moveFocus(D.parentOf(focus)); }
    else if (e.key === "ArrowDown" && focus?.firstElementChild) { e.preventDefault(); moveFocus(focus.firstElementChild); }
  }

  root.addEventListener("click", (e) => {
    const act = e.target.closest?.("[data-act]")?.dataset.act;
    if (act) runAction(act);
  });

  // ---- actions ---------------------------------------------------------------------

  /** Description of everything selected, with the hierarchy labels the agent can read. */
  const describeSelection = () => picked.map((el) => ({
    ...D.describe(el),
    component: componentName(el),
    hierarchy: D.hierarchy(el).map(D.label),
  }));

  async function runAction(act) {
    if (act === "exit") return stop();
    if (!picked.length) return;
    if (act === "copy") {
      try { await navigator.clipboard.writeText(picked.map(D.cssPath).join("\n")); say("Selector copied."); }
      catch { say("The page blocked copying."); }
      return;
    }
    // Hide our own UI so it isn't in the screenshot, then let the background crop and deliver.
    const elements = describeSelection();
    host.style.visibility = "hidden";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let res;
    try { res = await chrome.runtime.sendMessage({ type: "XRAY_SEND", target: act, elements }); }
    catch { res = { ok: false, error: "The extension isn't reachable (reload the page)." }; }
    host.style.visibility = "";
    say(res?.ok ? res.message : (res?.error || "Couldn't send."));
  }

  // ---- lifecycle ---------------------------------------------------------------------

  function stop() {
    clearTimeout(nameTimer);
    for (const type of SWALLOWED) document.removeEventListener(type, swallow, true);
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("scroll", repaint, true);
    removeEventListener("resize", repaint, true);
    host.remove();
    cursorStyle.remove();
    self.__dcXray = null;
  }

  document.documentElement.append(host, cursorStyle);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  addEventListener("scroll", repaint, true);
  addEventListener("resize", repaint, true);
  for (const type of SWALLOWED) document.addEventListener(type, swallow, true);
  self.__dcXray = { stop };
  paintPanel();
})();
