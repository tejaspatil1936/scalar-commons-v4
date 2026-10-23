// /404 (SITE-REDESIGN.md §5.4): "Page not found" as the h1, one sentence that
// names the path (and still reads with scripts off), two links (Home, Docs)
// and the docs search field — a GET form that goes somewhere: with scripts on
// it lists the matching docs pages from an index of the docs' own sources,
// with scripts off it opens the docs home. Nothing else. nginx serves the page
// for every unknown path, so every URL in it is absolute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderNotFound, PATH_FALLBACK } from '../src/notfound.mjs';
import { docsIndex, entryFor, plain } from '../src/notfound/docs-index.mjs';
import { searchDocs } from '../src/notfound/search.js';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = fileURLToPath(new URL('../../', import.meta.url));
const docsDir = join(repoDir, 'docs');
const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));
const docs = docsIndex(docsDir);
const html = renderNotFound({ facts, css: '/* css */', builtAt: '2026-10-23T20:00:00.000Z', docs });
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the page: "Page not found" as the one h1, the sentence, Home and Docs, the docs search; title, noindex, landmarks', () => {
  assert.match(html, /<title>Page not found — Scalar Commons<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(main, /<h1 class="sc-h1">Page not found<\/h1>/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<header class="sc-header">/);
  assert.match(html, /<footer class="sc-footer">/);
  assert.ok(!/aria-current="page"/.test(html), 'no nav item is current on a missing page');
  const links = [...main.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(links, [['Home', '/'], ['Docs', '/docs/']]);
  assert.match(main, /<form class="sc-search-row" role="search" action="\/docs\/" method="get">[\s\S]*name="q"[\s\S]*placeholder="Search the docs"/);
  assert.match(html, /<script type="module" src="\/404\.js"><\/script>/, 'absolute: the page is served at any depth');
});

test('with scripts off the sentence reads correctly; no digit and nothing else on the page', () => {
  const sentence = main.match(/<p class="sc-lead">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(sentence, `There’s nothing at ${PATH_FALLBACK}.`);
  const prose = text(main.replace(/<script[\s\S]*?<\/script>/g, ' '));
  assert.ok(!/\d/.test(prose), `a digit: ${prose.match(/.{0,30}\d.{0,30}/)?.[0]}`);
  for (const gone of ['nw-', 'Closest page', 'You asked for', '⌘K', 'Scripts are off', 'sc-stat', 'sc-table', 'sc-callout']) assert.ok(!main.includes(gone), gone);
});

test('the docs index is read from the docs’ own sources: every guide and reference page, at the URL the docs serve it', () => {
  const sources = ['guide', 'reference'].flatMap((s) => (existsSync(join(docsDir, s)) ? readdirSync(join(docsDir, s)).filter((n) => n.endsWith('.md')).map((n) => `/docs/${s}/${n.replace(/\.md$/, '')}`) : []));
  assert.ok(sources.length >= 5);
  assert.deepEqual(docs.map((d) => d.path).slice(1).sort(), sources.sort());
  assert.equal(docs[0].path, '/docs/');
  for (const d of docs) {
    assert.ok(d.title && !/[`*[\]]/.test(d.title), `a plain title for ${d.path}: ${d.title}`);
    assert.ok(Array.isArray(d.headings));
  }
  const embedded = JSON.parse(main.match(/<script type="application\/json" id="nf-docs">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, docs);
  assert.equal(plain('Run a [validator](./x) on `Scalar` **now**'), 'Run a validator on Scalar now');
  const e = entryFor('---\ndescription: "Short."\n---\n\n# Title here\n\n```\n## not a heading\n```\n\n## First\n\n## Second {#second}\n', '/docs/guide/x');
  assert.deepEqual(e, { title: 'Title here', path: '/docs/guide/x', description: 'Short.', headings: ['First', 'Second'] });
});

test('the search: every word must match; a word in the title counts most; nothing matches nothing', () => {
  const titles = (q) => searchDocs(docs, q).map((p) => p.path);
  assert.equal(titles('validator')[0], '/docs/guide/run-a-validator');
  assert.ok(titles('run agent').includes('/docs/guide/run-an-agent'));
  assert.deepEqual(titles('qqqzzzxxy'), []);
  assert.deepEqual(titles('   '), []);
  assert.ok(searchDocs(docs, 'the').length <= 8, 'at most eight results');
});

// ── the script, in jsdom ────────────────────────────────────────────────────
let run = 0;
async function boot(url) {
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, ''), { url });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, FormData: dom.window.FormData });
  run += 1;
  await import(`../src/notfound/main.js?run=${run}`);
  return dom.window.document;
}

test('script: the sentence names the path asked for; at /404 itself it keeps "this address"', async () => {
  let doc = await boot('https://scalarnet.io/some/missing%20page?x=1');
  assert.equal(doc.querySelector('.sc-lead').textContent, 'There’s nothing at /some/missing page.');
  doc = await boot('https://scalarnet.io/404');
  assert.equal(doc.querySelector('.sc-lead').textContent, `There’s nothing at ${PATH_FALLBACK}.`);
});

test('script: the search field lists the matching docs pages in place, or says none match and links the docs', async () => {
  const doc = await boot('https://scalarnet.io/nope');
  const form = doc.querySelector('[data-docs-search] form');
  const results = doc.querySelector('[data-results]');
  form.querySelector('input[name="q"]').value = 'validator';
  const event = new globalThis.window.Event('submit', { cancelable: true });
  form.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, 'answered in place');
  assert.equal(results.hidden, false);
  const hrefs = [...results.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('/docs/guide/run-a-validator'));
  for (const href of hrefs) assert.ok(docs.some((d) => d.path === href), `${href} is a docs page`);
  assert.match(results.textContent, /docs pages? match/);
  form.querySelector('input[name="q"]').value = 'qqqzzzxxy';
  form.dispatchEvent(new globalThis.window.Event('submit', { cancelable: true }));
  assert.match(results.textContent, /No docs page matches “qqqzzzxxy”\. Browse the docs\./);
  assert.equal(results.querySelector('a').getAttribute('href'), '/docs/');
  form.querySelector('input[name="q"]').value = '';
  const empty = new globalThis.window.Event('submit', { cancelable: true });
  form.dispatchEvent(empty);
  assert.equal(empty.defaultPrevented, false, 'nothing typed: the form opens the docs home');
});

test('the files use the plain chrome only, and the 404 stylesheet holds to its scales', () => {
  for (const file of ['src/notfound.mjs', 'src/notfound/main.js', 'src/notfound/search.js', 'src/notfound/docs-index.mjs', 'scripts/pages/notfound.mjs']) {
    const source = readFileSync(join(landingDir, file), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/chrome-legacy|observatory\/|pulse/.test(source), file);
  }
  const css = readFileSync(join(landingDir, 'src/notfound/notfound.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|font-size|letter-spacing|text-transform|box-shadow|animation|gradient/i.test(css));
  for (const [, prop, value] of css.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
    if (/^(?:margin|padding|gap)/.test(prop)) assert.match(value.trim(), /^var\(--s-[1-9]\)$/, `${prop}: ${value}`);
    if (prop === 'font') assert.match(value.trim(), /^var\(--(?:body|small|caption)\)$/);
    if (prop === 'color') assert.match(value.trim(), /^var\(--(?:text|text-2|accent)\)$/);
  }
});

test('npm run build emits 404.html with absolute font and script URLs, and 404.js', () => {
  const out = mkdtempSync(join(tmpdir(), 'landing-404-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: landingDir, env: { ...process.env, LANDING_OUT_DIR: out }, stdio: 'pipe' });
  assert.ok(readdirSync(out).includes('404.js'));
  const page = readFileSync(join(out, '404.html'), 'utf8');
  assert.match(page, /--accent:\s*#1457d6/, 'the plain chrome is inlined');
  assert.ok(!/url\("?fonts\//.test(page), 'no font URL relative to the page');
  assert.match(page, /url\("?\/fonts\/inter-latin-wght-normal\.woff2/);
  assert.ok(!/(?:href|src)="(?!\/|https:|#)/.test(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')), 'every URL absolute');
});

test('nginx: the site vhost serves /404.html for unknown paths', () => {
  const conf = readFileSync(join(repoDir, 'deploy/public/nginx/scalar-commons.conf.template'), 'utf8');
  const site = conf.slice(conf.indexOf('server_name <DOMAIN>;'), conf.indexOf('#  (g) faucet'));
  assert.match(site, /^\s{4}error_page 404 \/404\.html;$/m, 'at server level of the scalarnet.io vhost');
  assert.match(site, /try_files \$uri \$uri\/ \$uri\.html =404;/, 'the landing location still ends in =404, which error_page turns into the page');
  assert.equal((conf.match(/error_page 404/g) ?? []).length, 1, 'only there');
});
