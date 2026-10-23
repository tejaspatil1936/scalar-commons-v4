// /404 (SITE-REDESIGN.md §5.4): the page and its one script. The docs search
// index is read from the docs' sources at build time (src/notfound/docs-index.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderNotFound } from '../../src/notfound.mjs';
import { docsIndex } from '../../src/notfound/docs-index.mjs';
import { chromeCss } from '../../src/chrome/assets.mjs';

export default async function buildNotFound({ outDir, here, facts, transform, build, common }) {
  // Inlined, so the font URLs are made absolute: nginx serves this page at any unknown path.
  const css = (await transform(`${chromeCss()}\n${readFileSync(here('../src/notfound/notfound.css'), 'utf8')}`, { loader: 'css', minify: true })).code
    .trim()
    .replace(/url\((["']?)fonts\//g, 'url($1/fonts/');
  const docs = docsIndex(here('../../docs'));
  writeFileSync(join(outDir, '404.html'), renderNotFound({ facts, css, builtAt: new Date().toISOString(), docs }));
  const bundle = await build({ ...common, entryPoints: [here('../src/notfound/main.js')], outfile: join(outDir, '404.js') });
  const bytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;
  console.log(`built ${outDir}/404.html (${docs.length} docs pages in its search); 404.js ${(bytes / 1024).toFixed(1)} kB`);
}
