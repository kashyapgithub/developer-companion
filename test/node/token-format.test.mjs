/** token-format.test.mjs — raw page measurements become sensible design tokens. */
import { ROOT } from "../helpers/paths.mjs";
const f = await import(ROOT + "/lib/agent-tools/token-format.js");
const out = []; const t = (n, c, x = "") => out.push([c, n + (x ? " — " + x : "")]);

const raw = {
  colors: { background: { "rgb(255, 255, 255)": 9000, "rgb(232, 89, 12)": 400, "rgba(0, 0, 0, 0)": 99999 }, text: { "rgb(27, 28, 32)": 5000, "rgb(255, 255, 255)": 300 }, border: { "rgb(212, 212, 217)": 30 } },
  fontFamilies: { Inter: 5000, Georgia: 200 }, fontSizes: { "16px": 4000, "32px": 300, "12px": 500 }, fontWeights: { 400: 4000, 700: 400 },
  radii: { "8px": 40, "999px": 5 }, shadows: { "rgba(0, 0, 0, 0.25) 0px 4px 12px 0px": 6 }, spacing: { "16px": 90, "8px": 70, "24px": 30 },
  cssVariables: { "--brand": "#e8590c" }, page: { url: "http://x", title: "T" },
};
const tk = f.buildTokens(raw);
t("background is the most-used surface colour (not transparent)", tk.roles.background === "#ffffff");
t("foreground is the most-used text colour", tk.roles.foreground === "#1b1c20");
t("accent is the saturated brand colour, not a grey", tk.roles.accent === "#e8590c", tk.roles.accent);
t("palette ranked by use, transparent dropped", tk.palette[0].hex === "#ffffff" && !tk.palette.some((p) => p.hex === "#000000"));
t("font sizes sorted small to large", tk.fonts.sizes.map((s) => s.size).join() === "12px,16px,32px");
t("existing CSS variables carried through", tk.existing_css_variables["--brand"] === "#e8590c");
const css = f.toCss(tk); t("CSS output has :root and tokens", /^:root \{/.test(css) && /--color-accent: #e8590c;/.test(css) && /--font-body: Inter;/.test(css) && /--radius-1: 8px;/.test(css));
const tw = f.toTailwind(tk); t("Tailwind output is a valid config snippet", /module\.exports/.test(tw) && JSON.parse(tw.slice(tw.indexOf("extend: ") + 8, tw.lastIndexOf("} }")).trim()).colors.accent === "#e8590c");
t("summary mentions accent and fonts", /accent #e8590c/.test(f.summarize(tk)) && /Inter/.test(f.summarize(tk)));
const empty = f.buildTokens({}); t("empty page measurements don't crash", empty.roles.background === "#ffffff" && f.toCss(empty).includes(":root"));
t("parseColor handles rgba and space syntax", f.parseColor("rgba(1, 2, 3, 0.5)").a === 0.5 && f.parseColor("rgb(1 2 3)").b === 3);
for (const [ok, n] of out) console.log((ok ? "PASS " : "FAIL ") + n); process.exit(out.every((o) => o[0]) ? 0 : 1);
