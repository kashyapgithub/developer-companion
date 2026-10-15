/**
 * tabs.js — switches panes inside a tab group.
 *
 *   <div data-tabs="req">
 *     <button data-tab="params">…</button>   <section data-pane="params">…</section>
 */

/** Wires every [data-tabs] group under `root`. Returns `select(group, name)` for code-driven switches. */
export function initTabs(root = document) {
  const groups = root.querySelectorAll("[data-tabs]");
  function select(group, name) {
    group.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    group.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== name; });
  }
  groups.forEach((group) => {
    group.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => select(group, b.dataset.tab)));
    const first = group.querySelector("[data-tab]");
    if (first) select(group, first.dataset.tab);
  });
  return { select: (groupName, name) => select(root.querySelector(`[data-tabs="${groupName}"]`), name) };
}
