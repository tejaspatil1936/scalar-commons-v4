// The chrome as the build consumes it: the three sheets read from src/chrome
// and the two font files to copy, so a page module inlines one string and
// the build copies one list. The minified string is the same bytes on every
// page, which is what lets the tests compare pages to the source.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHROME_FONTS } from '../../scripts/sync-chrome.mjs';

const read = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

/** tokens + chrome + print, in that order, unminified. */
export const chromeCss = () => `${read('tokens.css')}\n${read('chrome.css')}\n${read('print.css')}`;
export { CHROME_FONTS };
