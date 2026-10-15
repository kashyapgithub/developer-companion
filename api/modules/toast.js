/** toast.js — a one-line message at the bottom of the window (errors in red, info in grey). */

let timer;

/** Shows `message` for a few seconds. */
export function toast(node, message, { error = false } = {}) {
  node.textContent = message;
  node.className = `toast show${error ? " error" : ""}`;
  clearTimeout(timer);
  timer = setTimeout(() => { node.className = "toast"; }, error ? 6000 : 3500);
}
