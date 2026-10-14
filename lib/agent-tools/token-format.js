/**
 * token-format.js — turns raw style measurements from a page into design tokens.
 *
 * Pure functions (no browser APIs), so they run in the service worker, in the
 * editor, and in Node tests. Input comes from extractTokensInPage()
 * (design-tokens.js): counts of colours, fonts, sizes, radii, shadows, spacing.
 *
 * Output: a short summary, CSS custom properties, and a Tailwind `theme.extend`
 * snippet an agent can paste straight into a project.
 */

// ---- colour helpers -----------------------------------------------------------------

/** "rgb(12, 34, 56)" / "rgba(…)" -> { r, g, b, a } or null. */
export function parseColor(text) {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(text || "");
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
}

const hex2 = (n) => n.toString(16).padStart(2, "0");
export const toHex = ({ r, g, b }) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** Saturation (0-1) and lightness (0-1) of an RGB colour. */
export function satLight({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => v / 255), max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  const d = max - min;
  return { sat: d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), light: l };
}

/** Roughly "a real colour, not a grey": enough saturation and not near white/black. */
const isChromatic = (c) => { const { sat, light } = satLight(c); return sat > 0.35 && light > 0.12 && light < 0.92; };

// ---- ranking -------------------------------------------------------------------------

/** Object of {value: count} -> [[value, count]] sorted by count, top N. */
const top = (counts, n) => Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

/** Merges rgb strings into hex-keyed counts (transparent colours dropped). */
function hexCounts(counts) {
  const out = {};
  for (const [text, n] of Object.entries(counts || {})) {
    const c = parseColor(text);
    if (!c || c.a < 0.05) continue;
    const hex = toHex(c);
    out[hex] = (out[hex] || 0) + n;
  }
  return out;
}

/**
 * Builds the tokens from raw counts.
 * @param {{colors:{background:object,text:object,border:object}, fontFamilies:object, fontSizes:object, fontWeights:object,
 *          radii:object, shadows:object, spacing:object, cssVariables?:object, page?:object}} raw
 */
export function buildTokens(raw) {
  const bg = hexCounts(raw.colors?.background), text = hexCounts(raw.colors?.text), border = hexCounts(raw.colors?.border);
  const all = {};
  for (const set of [bg, text, border]) for (const [h, n] of Object.entries(set)) all[h] = (all[h] || 0) + n;

  const [background] = top(bg, 1)[0] || ["#ffffff"];
  const [foreground] = top(text, 1)[0] || ["#000000"];
  // Accent: the most-used chromatic colour anywhere (buttons, links, highlights).
  const accent = top(all, 40).map(([h]) => h).find((h) => isChromatic(parseColor(`rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`)));
  const palette = top(all, 12).map(([hex, uses]) => ({ hex, uses }));

  const px = (v) => parseFloat(v);
  const sizes = top(raw.fontSizes, 8).map(([v, uses]) => ({ size: v, uses })).sort((a, b) => px(a.size) - px(b.size));
  const families = top(raw.fontFamilies, 3).map(([family, uses]) => ({ family, uses }));
  const weights = top(raw.fontWeights, 4).map(([w]) => w).sort((a, b) => a - b);
  const radii = top(raw.radii, 5).map(([v, uses]) => ({ radius: v, uses })).sort((a, b) => px(a.radius) - px(b.radius));
  const shadows = top(raw.shadows, 3).map(([shadow, uses]) => ({ shadow, uses }));
  // Spacing: the common values, as a scale.
  const spacing = top(raw.spacing, 10).map(([v]) => v).sort((a, b) => px(a) - px(b));

  return { page: raw.page || null, roles: { background, foreground, accent: accent || null }, palette, fonts: { families, sizes, weights }, radii, shadows, spacing, existing_css_variables: raw.cssVariables || {} };
}

// ---- output formats -----------------------------------------------------------------

/** :root { … } block. */
export function toCss(t) {
  const L = [":root {", `  --color-background: ${t.roles.background};`, `  --color-foreground: ${t.roles.foreground};`];
  if (t.roles.accent) L.push(`  --color-accent: ${t.roles.accent};`);
  t.palette.forEach((p, i) => L.push(`  --color-${i + 1}: ${p.hex};`));
  if (t.fonts.families[0]) L.push(`  --font-body: ${t.fonts.families[0].family};`);
  if (t.fonts.families[1]) L.push(`  --font-heading: ${t.fonts.families[1].family};`);
  t.fonts.sizes.forEach((s, i) => L.push(`  --text-${i + 1}: ${s.size};`));
  t.radii.forEach((r, i) => L.push(`  --radius-${i + 1}: ${r.radius};`));
  t.shadows.forEach((s, i) => L.push(`  --shadow-${i + 1}: ${s.shadow};`));
  t.spacing.forEach((s, i) => L.push(`  --space-${i + 1}: ${s};`));
  L.push("}");
  return L.join("\n");
}

/** Tailwind `theme.extend` snippet. */
export function toTailwind(t) {
  const colors = { background: t.roles.background, foreground: t.roles.foreground, ...(t.roles.accent ? { accent: t.roles.accent } : {}) };
  t.palette.forEach((p, i) => { colors[`c${i + 1}`] = p.hex; });
  const obj = {
    colors,
    fontFamily: Object.fromEntries(t.fonts.families.map((f, i) => [i === 0 ? "body" : i === 1 ? "heading" : `alt${i}`, [f.family]])),
    fontSize: Object.fromEntries(t.fonts.sizes.map((s, i) => [`t${i + 1}`, s.size])),
    borderRadius: Object.fromEntries(t.radii.map((r, i) => [`r${i + 1}`, r.radius])),
    boxShadow: Object.fromEntries(t.shadows.map((s, i) => [`s${i + 1}`, s.shadow])),
    spacing: Object.fromEntries(t.spacing.map((s, i) => [`sp${i + 1}`, s])),
  };
  return `// tailwind.config.js\nmodule.exports = { theme: { extend: ${JSON.stringify(obj, null, 2)} } }`;
}

/** One-paragraph human summary. */
export function summarize(t) {
  const fam = t.fonts.families.map((f) => f.family).join(", ") || "n/a";
  return `Background ${t.roles.background}, text ${t.roles.foreground}${t.roles.accent ? `, accent ${t.roles.accent}` : ""}. ` +
    `Fonts: ${fam}. Sizes: ${t.fonts.sizes.map((s) => s.size).join(", ") || "n/a"}. Radii: ${t.radii.map((r) => r.radius).join(", ") || "n/a"}.`;
}
