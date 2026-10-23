// Builds the static site into dist/ (or $LANDING_OUT_DIR).
//
// The landing page build is deliberately dependency-free: the gate for this
// site is `npm ci && npm run build`, and the fewer moving parts stand between
// a fresh clone and a rendered page, the fewer ways that gate has to fail for
// reasons that have nothing to do with the page. @polkadot/api is a
// devDependency used only by the scripts that read the chain.
//
// /network is the exception, and the one place a bundler is used: esbuild
// bundles the page's own script (the chrome's copy behaviour, the data
// readers, the SCALE and SS58 decoders — no library) into one file. The home
// page ships one plain script, src/home/refresh.js, copied as written.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { content } from '../src/content.mjs';
import { sourceClaims } from '../src/source-claims.mjs';
import { renderPage } from '../src/render.mjs';
import { renderNetwork, renderRedirect } from '../src/network.mjs';
import { chromeCss as plainChromeCss, CHROME_FONTS } from '../src/chrome/assets.mjs';
import { REFRESH_SCRIPT } from '../src/home/assets.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const readJson = (relative) => JSON.parse(readFileSync(here(relative), 'utf8'));

const facts = readJson('../chain-facts.json');

// renderPage throws on an unresolvable placeholder, so a page that would state a
// figure the chain never reported fails the build instead of shipping.
const builtAt = new Date().toISOString();
const html = renderPage({ facts, content, sourceClaims, builtAt });

const outDir = process.env.LANDING_OUT_DIR ?? here('../dist');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
// styles.css is the plain chrome (tokens, fonts, chrome), minified — the one
// stylesheet the home page links; its own small sheet is inlined in the page,
// and its one script is copied as it is (no bundling).
writeFileSync(join(outDir, 'styles.css'), (await transform(plainChromeCss(), { loader: 'css', minify: true })).code.trim());
copyFileSync(REFRESH_SCRIPT, join(outDir, 'refresh.js'));

// /network: a static frame whose live figures the reader's browser fetches
// (SITE-REDESIGN.md §5.2). The runtime history it is built with is a
// checked-in record; it and the two operator records are copied out, since
// the page's sources table links them for download. The plain chrome is
// inlined with the page's one rule (src/network.css). /observatory and /pulse
// are redirect stubs to it.
const history = readJson('../runtime-history.json');
const posture = readJson('../public/posture.json');
const status = readJson('../public/status.json');
const networkCss = (await transform(`${plainChromeCss()}\n${readFileSync(here('../src/network.css'), 'utf8')}`, { loader: 'css', minify: true })).code.trim();
writeFileSync(join(outDir, 'network.html'), renderNetwork({ facts, history, status, posture, builtAt, css: networkCss }));
writeFileSync(join(outDir, 'observatory.html'), renderRedirect({ to: '/network', title: 'Network' }));
writeFileSync(join(outDir, 'pulse.html'), renderRedirect({ to: '/network#activity', title: 'Activity' }));
copyFileSync(here('../runtime-history.json'), join(outDir, 'runtime-history.json'));
copyFileSync(here('../public/posture.json'), join(outDir, 'posture.json'));
copyFileSync(here('../public/status.json'), join(outDir, 'status.json'));

mkdirSync(join(outDir, 'fonts'), { recursive: true });
// The chrome's two faces (Inter, JetBrains Mono), served beside the stylesheet.
for (const [source, name] of CHROME_FONTS) {
  copyFileSync(here(`../node_modules/${source}`), join(outDir, 'fonts', name));
}
// The favicon and the social preview image every page's head names.
for (const name of ['favicon.svg', 'og.png']) copyFileSync(here(`../public/${name}`), join(outDir, name));

const common = {
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2022', 'chrome100', 'safari16', 'firefox100'],
  legalComments: 'none',
  metafile: true,
  logLevel: 'silent',
};
// One script for the network page, network.js: no chunks, no library.
const bundle = await build({
  ...common,
  entryPoints: [here('../src/network/main.js')],
  outfile: join(outDir, 'network.js'),
});
const bundleBytes = Object.values(bundle.metafile.outputs)[0]?.bytes ?? 0;

// Pages built by their own modules: every scripts/pages/*.mjs exports a default
// async function ({ outDir, here, readJson, facts, chromeCss, transform, build })
// and emits its files into outDir. A page owns its module; nothing else in this
// script changes when a page is added.
const chrome = await transform(plainChromeCss(), { loader: 'css', minify: true });
const pagesDir = here('./pages/');
for (const name of readdirSync(pagesDir).filter((n) => n.endsWith('.mjs')).sort()) {
  const page = await import(new URL(name, `file://${pagesDir}`).href);
  await page.default({ outDir, here, readJson, facts, chromeCss: chrome.code.trim(), transform, build, common });
}

console.log(
  `built ${outDir}/index.html (${(html.length / 1024).toFixed(1)} kB) from ${facts.provenance.specName} spec ` +
    `${facts.provenance.specVersion}, metadata v${facts.provenance.metadataVersion}, block ` +
    `#${facts.provenance.readAtBlock}; network.js ${(bundleBytes / 1024).toFixed(1)} kB`,
);
