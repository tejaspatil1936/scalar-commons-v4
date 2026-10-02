// Builds the static site into dist/ (or $LANDING_OUT_DIR).
//
// The landing page build is deliberately dependency-free: the gate for this
// site is `npm ci && npm run build`, and the fewer moving parts stand between
// a fresh clone and a rendered page, the fewer ways that gate has to fail for
// reasons that have nothing to do with the page. @polkadot/api is a
// devDependency used only by the scripts that read the chain.
//
// /observatory is the exception, and the one place a bundler is used: its
// instruments are drawn with d3-force, d3-scale and d3-shape, and esbuild
// bundles just those modules with the page's own script into one file. The
// sky (`?sky=1`, three.js and GSAP) is built apart: `sky.js` imports
// `./sky-field.js` dynamically, that path is left external in the page's
// bundle, and a second build emits `sky-field.js` beside it, so the page
// fetches the scene only after it has booted and the WebGL and motion checks
// pass. The scroll reveal (`reveal.js`, GSAP ScrollTrigger) is built the same
// way and fetched only when motion is not reduced. The landing page itself
// still ships no script at all.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { content } from '../src/content.mjs';
import { sourceClaims } from '../src/source-claims.mjs';
import { renderPage } from '../src/render.mjs';
import { renderObservatory, faviconSvg } from '../src/observatory.mjs';
import { FONTS, observatoryCss } from '../src/observatory-assets.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const readJson = (relative) => JSON.parse(readFileSync(here(relative), 'utf8'));

const facts = readJson('../chain-facts.json');

// renderPage throws on an unresolvable placeholder, so a page that would state a
// figure the chain never reported fails the build instead of shipping.
const html = renderPage({ facts, content, sourceClaims });

const outDir = process.env.LANDING_OUT_DIR ?? here('../dist');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
copyFileSync(here('../src/styles.css'), join(outDir, 'styles.css'));

// /observatory: a static frame whose live figures the reader's browser fetches.
// The two sets of figures it is built with are checked-in records, and both
// are also copied out so the page can link to the raw file it was built from.
const history = readJson('../runtime-history.json');
const posture = readJson('../public/posture.json');
// The stylesheet ships minified, inlined in the page for first paint and as a
// file for reading; the source in src/ stays the readable copy.
const css = (await transform(observatoryCss(), { loader: 'css', minify: true })).code.trim();
writeFileSync(join(outDir, 'observatory.html'), renderObservatory({ history, posture, css }));
writeFileSync(join(outDir, 'observatory.css'), css);
copyFileSync(here('../runtime-history.json'), join(outDir, 'runtime-history.json'));
copyFileSync(here('../public/posture.json'), join(outDir, 'posture.json'));
writeFileSync(join(outDir, 'favicon.svg'), faviconSvg());

mkdirSync(join(outDir, 'fonts'), { recursive: true });
for (const [source, name] of FONTS) {
  copyFileSync(here(`../node_modules/${source}`), join(outDir, 'fonts', name));
}

const common = {
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022', 'chrome100', 'safari16', 'firefox100'],
  legalComments: 'none',
  metafile: true,
  logLevel: 'silent',
};
const bundle = await build({
  ...common,
  entryPoints: [here('../src/observatory/main.js')],
  outfile: join(outDir, 'observatory.js'),
  // The sky's scene and the scroll reveal are fetched by these paths at run time, from the builds below.
  external: ['./sky-field.js', './reveal.js'],
});
const sky = await build({ ...common, entryPoints: [here('../src/observatory/sky-field.js')], outfile: join(outDir, 'sky-field.js') });
const reveal = await build({ ...common, entryPoints: [here('../src/observatory/reveal.js')], outfile: join(outDir, 'reveal.js') });
const bundleBytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;
const skyBytes = Object.values(sky.metafile.outputs)[0]?.bytes ?? 0;
const revealBytes = Object.values(reveal.metafile.outputs)[0]?.bytes ?? 0;

console.log(
  `built ${outDir}/index.html (${(html.length / 1024).toFixed(1)} kB) from ${facts.provenance.specName} spec ` +
    `${facts.provenance.specVersion}, metadata v${facts.provenance.metadataVersion}, block ` +
    `#${facts.provenance.readAtBlock}; observatory.js ${(bundleBytes / 1024).toFixed(1)} kB; sky chunk ${(skyBytes / 1024).toFixed(1)} kB; reveal chunk ${(revealBytes / 1024).toFixed(1)} kB`,
);
