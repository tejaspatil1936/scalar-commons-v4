// The chrome as the build consumes it: the three sheets (tokens, fonts,
// chrome) read from src/chrome, in order, and the font files to copy.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHROME_FONTS, CHROME_FILES } from '../../scripts/sync-chrome.mjs';

const read = (name) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

/** tokens + fonts + chrome, in that order, unminified. */
export const chromeCss = () => CHROME_FILES.map(read).join('\n');
export { CHROME_FONTS };
