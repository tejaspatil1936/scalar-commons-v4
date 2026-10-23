// /oversight — the agent-messaging oversight sample (brief §5.7), built by the
// pages loop. Unlike the other live pages this one ships a RECORD — the
// read-only decrypt tool's output, checked in as public/oversight-sample.json —
// rendered into the page and re-read live in the reader's browser. The sample
// is copied out as well, both because the page fetches it and because the raw
// file is the thing a sceptic should be able to read for themselves.
import { copyFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderOversight } from '../../src/oversight.mjs';
import { oversightCss } from '../../src/oversight-assets.mjs';

const local = (relative) => new URL(relative, import.meta.url);

/**
 * The page's one dependency, blakejs (pinned on the oversight branch), may not
 * be installed in this checkout. The bundle then resolves it to a shim over the
 * observatory's own blake2b — same bytes, no package — so the page still ships;
 * with blakejs installed the alias is not applied at all.
 */
function blakejsAlias() {
  try {
    createRequire(import.meta.url).resolve('blakejs');
    return {};
  } catch {
    return { alias: { blakejs: local('./oversight.blakejs-shim.js').pathname } };
  }
}

export default async function buildOversight({ outDir, here, readJson, transform, build, common }) {
  const sample = readJson('../public/oversight-sample.json');
  const css = (await transform(oversightCss(), { loader: 'css', minify: true })).code.trim();
  writeFileSync(join(outDir, 'oversight.css'), css);
  copyFileSync(here('../public/oversight-sample.json'), join(outDir, 'oversight-sample.json'));
  // One script: blake2b-256 for the in-browser commitment check and plain
  // JSON-RPC over fetch — no chart library, no d3, no polkadot-js.
  const bundle = await build({
    ...common,
    ...blakejsAlias(),
    entryPoints: [here('../src/oversight/main.js')],
    outfile: join(outDir, 'oversight.js'),
  });
  writeFileSync(join(outDir, 'oversight.html'), renderOversight({ sample, css }));
  const bytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;
  console.log(
    `built ${outDir}/oversight.html; oversight.js ${(bytes / 1024).toFixed(1)} kB from ${sample.rows.length} recorded rows at block #${sample.provenance.generatedAtBlock}`,
  );
}
