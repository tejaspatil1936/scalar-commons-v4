// /network (SITE-REDESIGN.md §5.2): the frame from src/network.mjs with the
// chrome and the page's own rules inlined, and one script bundled by esbuild
// from src/network/main.js (the chrome's templates and copy behaviour, the
// observatory's data readers and SCALE/SS58 decoders; no library). Also
// publishes the three records the page names: runtime-history.json, and
// status.json and posture.json, which only its sources table links.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderNetwork } from '../../src/network.mjs';
import { chromeCss as plainChrome } from '../../src/chrome/assets.mjs';

export default async function buildNetwork({ outDir, here, readJson, facts, transform, build, common }) {
  // The plain chrome (src/chrome), then the page's own rules, minified and inlined.
  const css = (await transform(`${plainChrome()}\n${readFileSync(here('../src/network.css'), 'utf8')}`, { loader: 'css', minify: true })).code.trim();
  const history = readJson('../runtime-history.json');
  const status = readJson('../public/status.json');
  const posture = readJson('../public/posture.json');
  writeFileSync(join(outDir, 'network.html'), renderNetwork({ facts, history, status, posture, css, builtAt: new Date().toISOString() }));
  for (const [from, to] of [['../runtime-history.json', 'runtime-history.json'], ['../public/status.json', 'status.json'], ['../public/posture.json', 'posture.json']]) {
    copyFileSync(here(from), join(outDir, to));
  }
  const bundle = await build({ ...common, entryPoints: [here('../src/network/main.js')], outfile: join(outDir, 'network.js') });
  const bytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;
  console.log(`built ${outDir}/network.html; network.js ${(bytes / 1024).toFixed(1)} kB`);
}
