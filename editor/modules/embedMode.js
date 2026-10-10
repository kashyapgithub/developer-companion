/**
 * embedMode.js — is the editor running inside the floating hover window?
 * The hover window loads editor.html?embedded=1 in an iframe. Embedded mode
 * only tweaks presentation (see `.embedded` rules in editor.css).
 */
export const isEmbedded = () => new URLSearchParams(location.search).has("embedded");

/** Tags <html> so CSS can adapt the layout to the smaller floating window. */
export function applyEmbeddedClass() {
  if (isEmbedded()) document.documentElement.classList.add("embedded");
}
