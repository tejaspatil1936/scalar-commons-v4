// WCAG 2.x relative luminance and contrast ratio for #rrggbb colours, shared
// by the observatory's colour test and the Nightwatch token test so the two
// never compute AA differently.

/** Relative luminance of a `#rrggbb` colour, per WCAG 2.x. */
export const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Contrast ratio of two `#rrggbb` colours, 1 to 21. */
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The custom properties declared in the first `:root { … }` block of a stylesheet, name → value. */
export const rootTokens = (css) =>
  Object.fromEntries(
    [...(css.replace(/\/\*[\s\S]*?\*\//g, '').match(/:root\s*\{([^}]*)\}/)?.[1] ?? '').matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((d) => [
      d[1],
      d[2].trim(),
    ]),
  );
