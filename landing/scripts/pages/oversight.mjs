// /oversight — the agent-messaging oversight record, built by the pages loop.
// Unlike the live pages this one ships a RECORD — the read-only decrypt tool's
// output, checked in as public/oversight-sample.json — rendered into the page
// and hashed again in the reader's browser. The sample is copied out as well,
// both because the page fetches it and because the raw file is the thing a
// sceptic should be able to read for themselves.
//
// The page is drawn on the shared chrome (src/chrome): its stylesheet is the
// chrome's three sheets and then src/oversight.css, minified and inlined. The
// legacy `chromeCss` the build loop still passes is ignored here.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderOversight } from '../../src/oversight.mjs';
import { chromeCss } from '../../src/chrome/assets.mjs';

export default async function buildOversight({ outDir, here, readJson, facts, transform, build, common }) {
  const sample = readJson('../public/oversight-sample.json');
  const own = readFileSync(here('../src/oversight.css'), 'utf8');
  const css = (await transform(`${chromeCss()}\n${own}`, { loader: 'css', minify: true })).code.trim();
  writeFileSync(join(outDir, 'oversight.css'), css);
  copyFileSync(here('../public/oversight-sample.json'), join(outDir, 'oversight-sample.json'));
  // One script: blake2b-256 (blakejs) for the in-browser commitment check and
  // plain JSON-RPC over fetch for a public node — no chart library, no d3, no
  // polkadot-js.
  const bundle = await build({
    ...common,
    entryPoints: [here('../src/oversight/main.js')],
    outfile: join(outDir, 'oversight.js'),
  });
  writeFileSync(join(outDir, 'oversight.html'), renderOversight({ sample, css, facts, builtAt: new Date().toISOString() }));
  const bytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;
  console.log(
    `built ${outDir}/oversight.html; oversight.js ${(bytes / 1024).toFixed(1)} kB from ${sample.rows.length} recorded rows at block #${sample.provenance.generatedAtBlock}`,
  );
}
