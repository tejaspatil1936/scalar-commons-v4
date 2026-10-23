// Assets shared by the site build and the instrument dev harness: the
// self-hosted fonts the chrome declares, and the stylesheet assembled from
// the design system plus each instrument's own rules. Kept in its own module
// so the harness can use the same list without running the site build.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FONTS = [
  // Nightwatch (src/chrome): Instrument Sans and Martian Mono, variable weight, latin subset — the site's only two faces.
  ['@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2', 'instrument-sans-latin-wght-normal.woff2'],
  ['@fontsource-variable/martian-mono/files/martian-mono-latin-wght-normal.woff2', 'martian-mono-latin-wght-normal.woff2'],
];

/**
 * observatory.css as shipped: the design system (src/observatory.css) followed
 * by every src/observatory/instruments/*.css in name order. An instrument's
 * rules live beside its script and may only use the tokens the design system
 * defines; they never redefine `:root`.
 */
export function observatoryCss() {
  const base = readFileSync(fileURLToPath(new URL('./observatory.css', import.meta.url)), 'utf8');
  const dir = new URL('./observatory/instruments/', import.meta.url);
  const parts = readdirSync(fileURLToPath(dir))
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((name) => `\n/* ── instruments/${name} ── */\n${readFileSync(fileURLToPath(new URL(name, dir)), 'utf8')}`);
  return base + parts.join('');
}
