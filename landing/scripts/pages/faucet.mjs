// /faucet (SITE-REDESIGN.md §5.3): the page from src/faucet.mjs with the plain
// chrome inlined, and one small script bundled from src/faucet/main.js (the
// chrome's copy buttons, the SS58 decoder, two formatters; no library). Emits
// faucet.html and faucet.js. The `chromeCss` the build loop passes is the
// transitional Ledger chrome and is ignored: this page imports the plain one.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromeCss } from '../../src/chrome/assets.mjs';
import { renderFaucet } from '../../src/faucet.mjs';

/** The chrome minified, its font URLs made absolute so the sheet works inlined at any path. */
export const inlineChrome = async (transform) =>
  (await transform(chromeCss(), { loader: 'css', minify: true })).code.trim().replace(/url\((["']?)fonts\//g, 'url($1/fonts/');

export default async function buildFaucet({ outDir, here, facts, transform, build, common }) {
  const css = await inlineChrome(transform);
  writeFileSync(join(outDir, 'faucet.html'), renderFaucet({ facts, css, builtAt: new Date().toISOString() }));
  const bundle = await build({ ...common, entryPoints: [here('../src/faucet/main.js')], outfile: join(outDir, 'faucet.js') });
  const bytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;
  console.log(`built ${outDir}/faucet.html; faucet.js ${(bytes / 1024).toFixed(1)} kB`);
}
