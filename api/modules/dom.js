/**
 * dom.js — tiny helpers so the API window's modules stay short and readable.
 */

/** el("button", { class: "x", onclick: fn, title: "t" }, "label", childEl) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = !!v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

/** Removes all children and appends the given ones. */
export function fill(node, ...children) { node.textContent = ""; node.append(...children.flat().filter(Boolean)); return node; }

/** Debounce: calls fn once things have been quiet for `ms`. */
export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/** "1.2 KB", "340 B". */
export function humanBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

/** Pretty-prints JSON text; returns the original text when it isn't JSON. */
export function prettyJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}
