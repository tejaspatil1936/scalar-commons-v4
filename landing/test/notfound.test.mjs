// /404 (SITE-REDESIGN.md §5.4): "Page not found", one sentence that names the
// path asked for (filled by a two-line inline script, "this address" without
// it), three links, and nothing else. nginx serves the page at any unknown
// path, so nothing in it may be addressed relatively.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DESCRIPTION, LINKS, SENTENCE, TITLE, renderNotFound } from '../src/notfound.mjs';
import { DISCLAIMER } from '../src/chrome/templates.mjs';

const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));
const html = renderNotFound({ facts, css: '/* css */', builtAt: '2026-10-23T11:32:11.000Z' });
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

test('the frame through the chrome: title, description, canonical, no nav item current, one h1, the footer line', () => {
  assert.equal(TITLE, 'Page not found');
  assert.match(html, /<title>Page not found — Scalar Commons<\/title>/);
  assert.ok(html.includes(`<meta name="description" content="${DESCRIPTION}">`));
  assert.match(html, /<link rel="canonical" href="https:\/\/scalarnet\.io\/404">/);
  const nav = html.match(/<nav class="sc-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.ok(!nav.includes('aria-current'), 'no nav item is current on the 404 page');
  assert.equal((main.match(/<h1/g) ?? []).length, 1);
  assert.match(main, /<h1 class="sc-h1">Page not found<\/h1>/);
  assert.ok(html.includes(`${DISCLAIMER} Runtime ${facts.provenance.specName} ${facts.provenance.specVersion}. Page built 23 Oct 2026, 11:32 UTC`));
});

test('one sentence with the path, "this address" as the static fallback, filled by a two-line inline script and no script file', () => {
  assert.ok(main.includes(`<p class="sc-lead">${SENTENCE.before} <span data-path>${SENTENCE.fallback}</span>.</p>`));
  assert.equal(`${SENTENCE.before} ${SENTENCE.fallback}${SENTENCE.after}`, 'There’s nothing at this address.');
  const script = main.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'the inline script');
  assert.equal(script.trim().split('\n').length, 2, 'two lines');
  assert.match(script, /location\.pathname/);
  assert.ok(!/<script type="module"|src="404\.js"/.test(html), 'no script file: the page is served at any path');
  assert.equal((html.match(/<script/g) ?? []).length, 1);
});

test('the inline script writes the path asked for, and leaves the fallback at /404 itself', () => {
  const at = (url) => {
    const dom = new JSDOM(html, { url, runScripts: 'dangerously' });
    return dom.window.document.querySelector('.sc-lead').textContent;
  };
  assert.equal(at('https://scalarnet.io/nope'), 'There’s nothing at /nope.');
  assert.equal(at('https://scalarnet.io/docs/guide/missing'), 'There’s nothing at /docs/guide/missing.');
  assert.equal(at('https://scalarnet.io/404'), 'There’s nothing at this address.');
  assert.equal(at('http://127.0.0.1:8000/404.html'), 'There’s nothing at this address.');
});

test('three links — Home, Docs, Search the docs — and nothing else', () => {
  assert.deepEqual(LINKS, [
    { text: 'Home', href: '/' },
    { text: 'Docs', href: '/docs/' },
    { text: 'Search the docs', href: '/docs/' },
  ]);
  const list = main.match(/<ul class="sc-stack" aria-label="Where to go">([\s\S]*?)<\/ul>/)?.[1];
  assert.ok(list, 'the list of links');
  assert.deepEqual([...list.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]), LINKS.map((l) => [l.text, l.href]));
  const body = main.replace(/<script>[\s\S]*?<\/script>/, '');
  assert.equal((body.match(/<a /g) ?? []).length, 3, 'no other link in main');
  for (const gone of ['<form', '<input', '<table', 'sc-stats', 'sc-callout', '<h2', '<img', '<section', 'nw-', '404</', 'Closest page', 'Readings']) assert.ok(!body.includes(gone), gone);
  assert.equal((body.match(/<p[ >]/g) ?? []).length, 1, 'one sentence');
  for (const href of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(/^(?:https?:\/\/|\/|#)/.test(href[1]), `relative URL on a page served at any path: ${href[1]}`);
});
