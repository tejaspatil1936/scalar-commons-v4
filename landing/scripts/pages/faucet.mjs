// /faucet (brief §5.6): the static frame from src/faucet.mjs with the chrome
// and the page's own stylesheet inlined, and one small script bundled from
// src/faucet/main.js (the chrome's behaviour, an SS58 decoder, two formatters;
// no library). Emits faucet.html, faucet.css and faucet.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderFaucet } from '../../src/faucet.mjs';

export default async function buildFaucet({ outDir, here, facts, chromeCss, transform, build, common }) {
  const own = (await transform(readFileSync(here('../src/faucet.css'), 'utf8'), { loader: 'css', minify: true })).code.trim();
  const css = `${chromeCss}\n${own}`;
  writeFileSync(join(outDir, 'faucet.css'), css);
  writeFileSync(join(outDir, 'faucet.html'), renderFaucet({ facts, css }));
  const bundle = await build({ ...common, entryPoints: [here('../src/faucet/main.js')], outfile: join(outDir, 'faucet.js') });
  const bytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;
  console.log(`built ${outDir}/faucet.html; faucet.js ${(bytes / 1024).toFixed(1)} kB`);
}
