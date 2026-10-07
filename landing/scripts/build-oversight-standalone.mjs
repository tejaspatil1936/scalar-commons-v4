// Emits the standalone copy of /oversight: one HTML file that works with no
// network, no sibling files and no web server — open it from a USB stick and it
// renders, hashes and tells the truth about what it could not reach.
//
// "Self-contained" is taken literally, because this file is evidence and
// evidence that silently loses its typography (or its data) is worth less:
//
//   - the stylesheet is inlined, with the three woff2 fonts turned into data
//     URIs, so it looks like the hosted page rather than falling back to Times;
//   - the font preload links are dropped, since there is nothing beside the
//     file to preload;
//   - the sample rides in a <script type="application/json"> block, so the page
//     needs no fetch to render its rows;
//   - the page's own script is inlined, so the in-browser hash check still runs.
//
// The live re-read is left exactly as it is on the hosted page. With no network
// it fails, and the page then says "offline — showing recorded values" on every
// row, which is the honest outcome and the one the brief asked for.
//
// Usage: node scripts/build-oversight-standalone.mjs [--out PATH]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';

import { renderOversight } from '../src/oversight.mjs';
import { FONTS, oversightCss } from '../src/observatory-assets.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);

const out = arg('--out', here('../dist/oversight-standalone.html'));
const sample = JSON.parse(readFileSync(here('../public/oversight-sample.json'), 'utf8'));

/** Each font as a data URI, keyed by the filename the stylesheet asks for. */
const fontData = new Map(
  FONTS.map(([source, name]) => [
    name,
    `data:font/woff2;base64,${readFileSync(here(`../node_modules/${source}`)).toString('base64')}`,
  ]),
);

let css = oversightCss();
for (const [name, uri] of fontData) {
  const before = css;
  css = css.replaceAll(`fonts/${name}`, uri);
  if (css === before) throw new Error(`the stylesheet never asks for fonts/${name} — the inlining is silently doing nothing`);
}
const minifiedCss = (await transform(css, { loader: 'css', minify: true })).code.trim();

// One bundle, same entry point and same settings as the site build, but kept in
// memory instead of written beside the page.
const bundle = await build({
  entryPoints: [here('../src/oversight/main.js')],
  bundle: true,
  minify: true,
  write: false,
  format: 'esm',
  target: ['es2022', 'chrome100', 'safari16', 'firefox100'],
  legalComments: 'none',
  logLevel: 'silent',
});
const script = bundle.outputFiles[0].text;

let html = renderOversight({ sample, css: minifiedCss, inlineData: true, standalone: true, inlineScript: script });

// Nothing sits beside this file, so a preload would only ever 404.
const preloads = html.match(/<link rel="preload"[^>]*>\n?/g) ?? [];
if (preloads.length === 0) throw new Error('expected font preload links to strip; the page frame must have changed');
for (const link of preloads) html = html.replace(link, '');

// The wordmark and the site nav are relative, which is right for a page served
// from the site and dead for a file opened from a stick. Point them at the
// public site instead of deleting them: a reader holding the evidence file
// should still be able to get to the live pages.
const SITE = 'https://scalarnet.io';
html = html.replace(
  /href="(?!data:|https?:|#)([^"]*)"/g,
  (_match, path) => `href="${SITE}/${path === './' ? '' : path}"`,
);

if (/(?:src|href)="(?!data:|https?:|#)[^"]+"/.test(html)) {
  // A relative URL left in the markup means something would fail to load.
  throw new Error(`the standalone page still references a sibling file: ${RegExp.lastMatch}`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(
  `wrote ${out} (${(html.length / 1024).toFixed(0)} kB): ${sample.rows.length} rows at block ` +
    `#${sample.provenance.generatedAtBlock}, ${fontData.size} fonts and a ${(script.length / 1024).toFixed(1)} kB script inlined`,
);
