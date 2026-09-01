/**
 * WCAG 2.1 relative luminance and contrast ratio, plus a reader for the theme
 * tokens in `src/app/globals.css`.
 *
 * This exists so the palette's accessibility is an *asserted invariant*
 * (`contrast.test.ts`) rather than something somebody measured once. The app
 * itself never imports it: the tokens are CSS custom properties and the
 * browser resolves them. It is test-facing on purpose.
 */

/** `#abc` or `#aabbcc` to 0..1 sRGB channels. */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The `--name: #value;` pairs out of a stylesheet's `:root` block. Deliberately
 * a small regex over the source rather than a CSS parser: the block is a flat
 * list of hex literals, and a dependency to read it would be the heavier thing.
 */
export function readTokens(css: string): Record<string, string> {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) throw new Error("no :root block");
  const tokens: Record<string, string> = {};
  for (const [, name, value] of root[1].matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) tokens[name] = value;
  return tokens;
}
