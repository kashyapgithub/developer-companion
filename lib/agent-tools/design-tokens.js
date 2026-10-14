/**
 * design-tokens.js — measures the look of a live page.
 *
 * extractTokensInPage() runs INSIDE the page (it must stay self-contained: no
 * imports, no outside variables). It samples visible elements and counts the
 * colours, fonts, sizes, radii, shadows and spacing in use, plus any CSS
 * variables the site already defines. token-format.js turns the counts into tokens.
 *
 * Two entry points use it: the agent's get_design_tokens tool (allowed sites)
 * and the "Design tokens of this page" item in the Add screenshot menu.
 */

import { buildTokens, toCss, toTailwind, summarize } from "./token-format.js";
import { pickAllowedTab } from "../page-actions.js";
import { attachDebugger } from "../debugger-capture.js";
import { noTab } from "./index-helpers.js";

/** Runs in the page. Returns plain counts (JSON-safe). */
export function extractTokensInPage() {
  const MAX_ELEMENTS = 2500;
  const bump = (map, key, n = 1) => { if (key) map[key] = (map[key] || 0) + n; };
  const raw = { colors: { background: {}, text: {}, border: {} }, fontFamilies: {}, fontSizes: {}, fontWeights: {}, radii: {}, shadows: {}, spacing: {}, cssVariables: {}, page: { url: location.href, title: document.title } };
  const els = [...document.querySelectorAll("body, body *")].slice(0, MAX_ELEMENTS);

  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    const area = Math.min(r.width * r.height, 1e6);

    bump(raw.colors.background, cs.backgroundColor, Math.ceil(area / 1000));           // bigger surfaces count more
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    if (ownText) {
      bump(raw.colors.text, cs.color, ownText.length);
      bump(raw.fontFamilies, cs.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, ""), ownText.length);
      bump(raw.fontSizes, cs.fontSize, ownText.length);
      bump(raw.fontWeights, cs.fontWeight, ownText.length);
    }
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") bump(raw.colors.border, cs.borderTopColor, 2);
    if (cs.borderTopLeftRadius !== "0px") bump(raw.radii, cs.borderTopLeftRadius);
    if (cs.boxShadow !== "none") bump(raw.shadows, cs.boxShadow);
    for (const side of ["paddingTop", "paddingLeft", "marginTop", "marginLeft", "rowGap", "columnGap"]) {
      const v = cs[side];
      if (v && v !== "0px" && v !== "normal" && !v.startsWith("-")) bump(raw.spacing, v);
    }
  }

  // CSS variables the site already defines on :root / html.
  try {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }           // cross-origin sheets can't be read
      for (const rule of rules || []) {
        if (rule.selectorText !== ":root" && rule.selectorText !== "html") continue;
        for (const name of rule.style) if (name.startsWith("--") && Object.keys(raw.cssVariables).length < 60) raw.cssVariables[name] = rule.style.getPropertyValue(name).trim();
      }
    }
  } catch { /* best effort */ }
  return raw;
}

/** Raw counts -> { tokens, css, tailwind, summary }. */
export function tokensFromRaw(raw) {
  const tokens = buildTokens(raw);
  return { page: tokens.page, summary: summarize(tokens), tokens, css: toCss(tokens), tailwind: toTailwind(tokens) };
}

/** Agent command: tokens of the open tab on an allowed site. */
export async function designTokensCommand(payload = {}) {
  const tab = await pickAllowedTab(payload.url_contains);
  if (!tab) return noTab(payload.url_contains);
  await attachDebugger(tab.id);
  const res = await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.evaluate", {
    expression: `(${extractTokensInPage.toString()})()`, returnByValue: true,
  });
  if (res.exceptionDetails || !res.result?.value) return { status: "failed", result: { error: "Couldn't read the page's styles." } };
  return { status: "done", result: tokensFromRaw(res.result.value) };
}
