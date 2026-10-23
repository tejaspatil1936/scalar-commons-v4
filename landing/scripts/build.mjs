// Builds the static site into dist/ (or $LANDING_OUT_DIR).
//
// The landing page build is deliberately dependency-free: the gate for this
// site is `npm ci && npm run build`, and the fewer moving parts stand between
// a fresh clone and a rendered page, the fewer ways that gate has to fail for
// reasons that have nothing to do with the page. @polkadot/api is a
// devDependency used only by the scripts that read the chain.
//
// Pages with a script (/network, /faucet, /oversight) are built by their own
// modules in scripts/pages/, each bundling its one script with esbuild. The
// home page ships one plain script, home.js (src/home/refresh.js minified,
// never bundled), that refreshes its four live figures.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { content } from '../src/content.mjs';
import { renderPage } from '../src/render.mjs';
import { chromeCss, CHROME_FONTS as LEGACY_FONTS } from '../src/chrome-legacy/assets.mjs';
import { CHROME_FONTS, chromeCss as plainChromeCss } from '../src/chrome/assets.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const readJson = (relative) => JSON.parse(readFileSync(here(relative), 'utf8'));

const facts = readJson('../chain-facts.json');

// renderPage throws on an unresolvable placeholder, so a page that would state a
// figure the chain never reported fails the build instead of shipping.
const builtAt = new Date().toISOString();
const html = renderPage({ facts, content, builtAt });

const outDir = process.env.LANDING_OUT_DIR ?? here('../dist');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
// styles.css is the plain chrome (tokens, fonts, chrome) and the home page's
// own rules, minified — the one stylesheet the home page links.
const homeCss = `${plainChromeCss()}\n${readFileSync(here('../src/home.css'), 'utf8')}`;
writeFileSync(join(outDir, 'styles.css'), (await transform(homeCss, { loader: 'css', minify: true })).code.trim());
// home.js: the one plain script (no bundle, no import), minified.
const homeJs = (await transform(readFileSync(here('../src/home/refresh.js'), 'utf8'), { loader: 'js', minify: true, target: 'es2022' })).code.trim();
writeFileSync(join(outDir, 'home.js'), homeJs);

mkdirSync(join(outDir, 'fonts'), { recursive: true });
// The chrome's two faces (Inter, JetBrains Mono) for every rebuilt page;
// LEGACY_FONTS are the transitional Ledger faces the pages not yet rebuilt still load.
for (const [source, name] of [...CHROME_FONTS, ...LEGACY_FONTS]) {
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
// Pages built by their own modules: every scripts/pages/*.mjs exports a default
// async function ({ outDir, here, readJson, facts, chromeCss, transform, build })
// and emits its files into outDir. A page owns its module; nothing else in this
// script changes when a page is added.
const chrome = await transform(chromeCss(), { loader: 'css', minify: true });
const pagesDir = here('./pages/');
for (const name of readdirSync(pagesDir).filter((n) => n.endsWith('.mjs')).sort()) {
  const page = await import(new URL(name, `file://${pagesDir}`).href);
  await page.default({ outDir, here, readJson, facts, chromeCss: chrome.code.trim(), transform, build, common });
}

console.log(
  `built ${outDir}/index.html (${(html.length / 1024).toFixed(1)} kB, home.js ${(homeJs.length / 1024).toFixed(1)} kB) from ${facts.provenance.specName} spec ` +
    `${facts.provenance.specVersion}, metadata v${facts.provenance.metadataVersion}, block ` +
    `#${facts.provenance.readAtBlock}`,
);
