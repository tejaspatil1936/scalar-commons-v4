// refresh.js in a DOM (SITE-REDESIGN.md §7): the four figures replaced in
// place from the indexer, "Updated n s ago" with the UTC instant in its title,
// and on a failed read the last figures kept, the row marked Stale and a
// callout with the plain reason; polling only while the tab is visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { content } from '../src/content.mjs';
import { sourceClaims } from '../src/source-claims.mjs';
import { renderPage } from '../src/render.mjs';
import { REFRESH_SCRIPT } from '../src/home/assets.mjs';

const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));
const html = renderPage({ facts, content, sourceClaims, builtAt: '2026-10-23T20:00:00.000Z' });

// The indexer, scripted: each route answers with a body, an HTTP status, or a network failure.
const answers = {
  '/status': { body: { chain: { bestBlock: 1_170_001, finalizedBlock: 1_169_998 } } },
  '/eras/current': { body: { era: 174, durationBlocks: 3600, blocksElapsed: 912 } },
  '/agents?limit=1': { body: { total: 207, truncated: false, items: [] } },
};
const calls = [];
const fakeFetch = async (url) => {
  calls.push(url);
  const path = url.replace('https://api.scalarnet.io/v1', '');
  const a = answers[path];
  if (!a) throw new TypeError('Failed to fetch');
  if (a.fail) throw new TypeError('Failed to fetch');
  return { ok: (a.status ?? 200) < 400, status: a.status ?? 200, json: async () => a.body };
};

const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://scalarnet.io/' });
const { window } = dom;
globalThis.document = window.document;
globalThis.fetch = fakeFetch;
const $ = (sel) => window.document.querySelector(sel);
const value = (key) => $(`[data-stat="${key}"] [data-value]`).textContent;
const settle = () => new Promise((r) => setTimeout(r, 30));
const setVisibility = (state) => {
  Object.defineProperty(window.document, 'visibilityState', { value: state, configurable: true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
};

test('a successful read replaces the four figures in place and says when', async () => {
  const before = { height: value('height'), era: value('era') };
  await import(REFRESH_SCRIPT);
  await settle();
  assert.deepEqual(calls.slice(0, 3), ['https://api.scalarnet.io/v1/status', 'https://api.scalarnet.io/v1/eras/current', 'https://api.scalarnet.io/v1/agents?limit=1']);
  assert.equal(value('height'), '1,170,001');
  assert.equal(value('finalized'), '1,169,998');
  assert.equal(value('agents'), '207');
  assert.equal(value('era'), '912');
  assert.equal($('[data-stat="era"] [data-caption]').textContent, 'of 3,600 blocks in era 174');
  assert.notEqual(value('height'), before.height);
  const updated = $('[data-live-updated]');
  assert.match(updated.textContent, /^Updated \d+ s ago$/);
  assert.match(updated.title, /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/, 'the absolute UTC time rides in the title');
  assert.ok($('[data-live-stale]').hidden && $('[data-live-warning]').hidden);
});

test('a failed read keeps the last figures, marks the row Stale and names the reason; a truncated agent scan is not a count', async () => {
  answers['/eras/current'] = { status: 502, body: {} };
  answers['/agents?limit=1'] = { body: { total: 3, truncated: true, items: [] } };
  answers['/status'] = { body: { chain: { bestBlock: 1_170_004, finalizedBlock: 1_170_001 } } };
  setVisibility('hidden');
  setVisibility('visible'); // reads again at once
  await settle();
  assert.equal(value('height'), '1,170,004', 'what did arrive is shown');
  assert.equal(value('era'), '912', 'the failed figure keeps its last value, never a zero');
  assert.equal(value('agents'), '207', 'a truncated scan is a lower bound, so the count stays');
  assert.equal($('[data-live-stale]').hidden, false);
  assert.equal($('[data-live-warning]').hidden, false);
  const reason = $('[data-live-reason]').textContent;
  assert.match(reason, /^The indexer answered HTTP 502 for https:\/\/api\.scalarnet\.io\/v1\/eras\/current\. Values are from \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC\.$/);
  assert.ok(!/undefined|NaN|stack|at /.test(reason));

  answers['/status'] = { fail: true };
  setVisibility('hidden');
  setVisibility('visible');
  await settle();
  assert.equal(value('height'), '1,170,004');
  assert.match($('[data-live-reason]').textContent, /^Can't reach the indexer \(https:\/\/api\.scalarnet\.io\/v1\/status\): Failed to fetch\./);
});

test('polling stops while the tab is hidden and resumes when it is visible; a good read clears the warning', async () => {
  setVisibility('hidden');
  const n = calls.length;
  await settle();
  assert.equal(calls.length, n, 'no reads while hidden');
  answers['/status'] = { body: { chain: { bestBlock: 1_170_010, finalizedBlock: 1_170_007 } } };
  answers['/eras/current'] = { body: { era: 174, durationBlocks: 3600, blocksElapsed: 930 } };
  answers['/agents?limit=1'] = { body: { total: 208, truncated: false, items: [] } };
  setVisibility('visible');
  await settle();
  assert.equal(calls.length, n + 3, 'one read of three routes on becoming visible');
  assert.equal(value('height'), '1,170,010');
  assert.equal(value('agents'), '208');
  assert.ok($('[data-live-stale]').hidden && $('[data-live-warning]').hidden, 'a good read clears Stale and the warning');
  setVisibility('hidden'); // stop the timers so the test process can exit
});
