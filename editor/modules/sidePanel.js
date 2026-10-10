/**
 * sidePanel.js — tab switching for the right-hand panel, and the small
 * popovers in the top bar (agent settings).
 *
 * Kept separate from toolbar.js, which owns what the controls DO; this file
 * only owns where they are shown.
 */

/** Design / Layers tabs. `data-tab` on #side records which one is active. */
export function wireSideTabs(sideEl) {
  const tabs = [...sideEl.querySelectorAll(".side-tabs [role=tab]")];
  const panes = { design: sideEl.querySelector("#pane-design"), layers: sideEl.querySelector("#layers") };

  function show(name) {
    sideEl.dataset.tab = name;
    for (const tab of tabs) tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== name;
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.tab)));
  // Dev mode removes the Design tab; make sure something is still showing.
  new MutationObserver(() => { if (document.body.dataset.mode === "dev") show("layers"); })
    .observe(document.body, { attributes: true, attributeFilter: ["data-mode"] });

  return { show };
}

/**
 * Click-to-toggle popover with outside-click and Escape to close.
 * @param {{buttonEl:HTMLElement, popoverEl:HTMLElement}} els
 */
export function wirePopover({ buttonEl, popoverEl }) {
  if (!buttonEl || !popoverEl) return;

  const setOpen = (open) => {
    popoverEl.classList.toggle("hidden", !open);
    buttonEl.setAttribute("aria-expanded", String(open));
  };

  buttonEl.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(popoverEl.classList.contains("hidden"));
  });
  document.addEventListener("click", (e) => {
    if (!popoverEl.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
}
