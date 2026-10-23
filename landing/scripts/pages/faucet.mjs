// /faucet (SITE-REDESIGN.md §5.3): the page from src/faucet.mjs with the plain
// chrome and the page's own rules inlined, and one small script bundled from
// src/faucet/main.js (copy buttons, the SS58 check, the two faucet calls; no
// library). Emits faucet.html and faucet.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderFaucet } from '../../src/faucet.mjs';
import { chromeCss } from '../../src/chrome/assets.mjs';

/**
 * The plain chrome plus a page's own sheet, minified, with the font URLs made
 * absolute: the sheet is inlined in the page, so a relative `fonts/…` would
 * resolve against the page's URL rather than the site root.
 */
export async function pageCss(transform, own) {
  const css = (await transform(`${chromeCss()}\n${own}`, { loader: 'css', minify: true })).code.trim();
  return css.replace(/url\((["']?)fonts\//g, 'url($1/fonts/');
}

export default async function buildFaucet({ outDir, here, facts, transform, build, common }) {
  const css = await pageCss(transform, readFileSync(here('../src/faucet.css'), 'utf8'));
  writeFileSync(join(outDir, 'faucet.html'), renderFaucet({ facts, css, builtAt: new Date().toISOString() }));
  const bundle = await build({ ...common, entryPoints: [here('../src/faucet/main.js')], outfile: join(outDir, 'faucet.js') });
  const bytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;
  console.log(`built ${outDir}/faucet.html; faucet.js ${(bytes / 1024).toFixed(1)} kB`);
}
