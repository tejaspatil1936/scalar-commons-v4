// Assets shared by the site build and the instrument dev harness: the
// self-hosted fonts the chrome declares, and the stylesheet assembled from
// the design system plus each instrument's own rules. Kept in its own module
// so the harness can use the same list without running the site build.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FONTS = [
  // The Ledger (src/chrome): Source Serif 4 (variable, opsz + wght) and IBM Plex Mono 400 and 500, latin subset — the only two faces.
  ['@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2', 'source-serif-4-latin-opsz-normal.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2'],
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
