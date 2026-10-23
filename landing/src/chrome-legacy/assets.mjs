// TRANSITIONAL (SITE-REDESIGN.md, phase 1): the round-3 Ledger chrome, kept
// verbatim so the pages not yet rebuilt keep building until their own phase
// replaces them; the oversight phase deletes this directory. Not synced,
// not used by any rebuilt page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

/** tokens + chrome + print, in that order, unminified. */
export const chromeCss = () => `${read('tokens.css')}\n${read('chrome.css')}\n${read('print.css')}`;
/** The Ledger's faces, for the pages that still use it. */
export const CHROME_FONTS = [
  ['@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2', 'source-serif-4-latin-opsz-normal.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2'],
];
