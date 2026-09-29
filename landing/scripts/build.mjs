// Builds the static landing page into dist/ (or $LANDING_OUT_DIR).
//
// Deliberately dependency-free: the gate for this site is `npm ci && npm run
// build`, and the fewer moving parts stand between a fresh clone and a rendered
// page, the fewer ways that gate has to fail for reasons that have nothing to do
// with the page. @polkadot/api is a devDependency used only by the scripts that
// read the chain — never by the build.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { content } from '../src/content.mjs';
import { sourceClaims } from '../src/source-claims.mjs';
import { renderPage } from '../src/render.mjs';
import { renderObservatory } from '../src/observatory.mjs';

const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));

// renderPage throws on an unresolvable placeholder, so a page that would state a
// figure the chain never reported fails the build instead of shipping.
const html = renderPage({ facts, content, sourceClaims });

const outDir = process.env.LANDING_OUT_DIR ?? fileURLToPath(new URL('../dist', import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
copyFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), join(outDir, 'styles.css'));

// /observatory: a static frame whose live figures the reader's browser fetches.
// The one set of figures it is built with is the checked-in upgrade record.
const history = JSON.parse(readFileSync(new URL('../runtime-history.json', import.meta.url), 'utf8'));
writeFileSync(join(outDir, 'observatory.html'), renderObservatory({ history }));
for (const asset of ['observatory.js', 'observatory.css']) {
  copyFileSync(fileURLToPath(new URL(`../src/${asset}`, import.meta.url)), join(outDir, asset));
}

console.log(
  `built ${outDir}/index.html (${(html.length / 1024).toFixed(1)} kB) from ${facts.provenance.specName} spec ` +
    `${facts.provenance.specVersion}, metadata v${facts.provenance.metadataVersion}, block ` +
    `#${facts.provenance.readAtBlock}`,
);
