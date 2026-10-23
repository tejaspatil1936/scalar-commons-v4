// Copies the chrome — tokens.css, chrome.css, print.css and the two font
// files — into the docs theme and the explorer, so three builds share one
// visual system without a monorepo. `--check` compares instead of copying
// and exits non-zero on any difference; test/chrome.test.mjs runs the same
// comparison, so a copy that drifts from the source fails the landing build.
//
//   node scripts/sync-chrome.mjs          # copy
//   node scripts/sync-chrome.mjs --check  # verify, no writes
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export const CHROME_FILES = ['tokens.css', 'chrome.css', 'print.css'];
export const CHROME_FONTS = [
  ['@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2', 'source-serif-4-latin-opsz-normal.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2'],
];
export const TARGETS = [here('../../docs/.vitepress/theme/chrome'), here('../../explorer/src/chrome')];

/** [source, destination] for every file every target must carry. */
export function syncPairs() {
  const pairs = [];
  for (const target of TARGETS) {
    for (const name of CHROME_FILES) pairs.push([here(`../src/chrome/${name}`), join(target, name)]);
    for (const [source, name] of CHROME_FONTS) pairs.push([here(`../node_modules/${source}`), join(target, 'fonts', name)]);
  }
  return pairs;
}

/** The pairs whose destination is missing or differs from the source. */
export function drift() {
  return syncPairs().filter(([source, dest]) => !existsSync(dest) || !readFileSync(source).equals(readFileSync(dest)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--check')) {
    const bad = drift();
    if (bad.length) {
      console.error(`sync-chrome: ${bad.length} copy(ies) differ from landing/src/chrome:`);
      for (const [, dest] of bad) console.error(`  ${dest}`);
      process.exit(1);
    }
    console.log(`sync-chrome: ${syncPairs().length} copies match the source`);
  } else {
    for (const [source, dest] of syncPairs()) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(source, dest);
    }
    console.log(`sync-chrome: ${syncPairs().length} files copied into ${TARGETS.length} targets`);
  }
}
