// /404: the page's words are the brief's, every Reading has a source, and the
// closest-page match is an edit distance that gives up rather than guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderNotFound, ROUTES, SENTENCE } from '../src/notfound.mjs';
import { closestRoute, editDistance } from '../src/notfound/routes.js';

const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));

test('edit distance, and the closest route gives up when nothing is near', () => {
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(closestRoute('/observatry', ROUTES), '/observatory');
  assert.equal(closestRoute('/puls/', ROUTES), '/pulse');
  assert.equal(closestRoute('/docs', ROUTES), '/docs/');
  assert.equal(closestRoute('/nothing-like-any-page-here', ROUTES), null);
});

test('the page: the sentence, three Readings with sources, one script, the footer, the scripts-off band', () => {
  const html = renderNotFound({ facts, css: '' });
  assert.ok(html.includes(SENTENCE));
  assert.equal((html.match(/class="nw-reading/g) ?? []).length, 3);
  assert.deepEqual([...html.matchAll(/data-reading="([^"]+)"/g)].map((m) => m[1]), ['askedFor', 'closest', 'or']);
  assert.match(html, /location\.pathname/);
  assert.match(html, /<script type="module" src="404\.js"><\/script>/);
  assert.match(html, /Scripts are off\. Every figure on this page is from the build/);
  assert.match(html, /Testnet — the token has no value and the chain may be reset\./);
  assert.ok(!/\d{4,}/.test(html.replace(/\d{4}-\d{2}-\d{2}[^<]*/g, '').replace(/block [\d,]+/g, '').replace(/data-block="[^"]*"/g, '').replace(/0x[0-9a-f…]+/g, '')), 'no figure beyond the footer’s record');
});
