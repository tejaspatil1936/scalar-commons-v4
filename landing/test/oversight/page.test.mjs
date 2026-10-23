// The page and its script, booted together in a DOM.
//
// test/oversight.test.mjs checks the markup and test/oversight/verify.test.mjs
// checks the arithmetic. Neither would catch a selector in main.js that no
// longer matches the markup, which would leave every hash check reading
// "Pending" forever while the page looked fine. So this one renders the real
// page, runs the real script against it, and asserts what a reader would see —
// and that the script asks the network for nothing at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { renderOversight } from '../../src/oversight.mjs';

const readJson = (relative) => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const sample = readJson('../../public/oversight-sample.json');
const facts = readJson('../../chain-facts.json');

/** Boot the page rendered from `data`; every fetch is recorded and refused. */
async function boot({ token, data = sample, hash = '' }) {
  const html = renderOversight({ sample: data, facts, css: '' });
  const dom = new JSDOM(html, { url: `http://localhost/oversight${hash}` });
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const requests = [];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.fetch = (url) => {
    requests.push(String(url));
    return Promise.reject(new Error('no network in this test'));
  };
  try {
    await import(`../../src/oversight/main.js?case=${token}`);
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.fetch = saved.fetch;
  }
  return { doc: dom.window.document, requests };
}

const cellOf = (doc, id) => doc.querySelector(`[data-row="${id}"] [data-check="commitment"]`);

test('the hash check runs in the browser and the script makes no request at all', async () => {
  const { doc, requests } = await boot({ token: 'ok' });
  assert.deepEqual(requests, [], 'no RPC, no localhost, no indexer, no second copy of the data');
  const withText = sample.rows.filter((r) => r.plaintext);
  for (const r of withText) {
    const cell = cellOf(doc, r.id);
    assert.equal(cell.dataset.state, 'ok', `row ${r.id}`);
    assert.equal(cell.querySelector('.sc-badge').textContent, 'Succeeded');
    assert.match(cell.textContent, /hashes to the recorded commitment/);
  }
  for (const r of sample.rows.filter((x) => !x.plaintext)) assert.match(cellOf(doc, r.id).textContent, /No plaintext to hash/);
  const recheck = doc.querySelector('[data-recheck]').textContent;
  assert.equal(recheck, `${withText.length} of ${withText.length} plaintexts hash to the recorded commitment`);
});

test('a plaintext that does not match its commitment is marked Failed with both hashes', async () => {
  const target = sample.rows.find((r) => r.plaintext);
  const tampered = { ...sample, rows: sample.rows.map((r) => (r.id === target.id ? { ...r, plaintext: `${r.plaintext} ` } : r)) };
  const { doc } = await boot({ token: 'bad', data: tampered });
  const cell = cellOf(doc, target.id);
  assert.equal(cell.dataset.state, 'bad');
  assert.equal(cell.querySelector('.sc-badge').textContent, 'Failed');
  assert.ok(cell.textContent.includes(target.payloadHashOnChain), 'the recorded hash is shown in the open');
});

test('a link to a message in a collapsed group opens that group', async () => {
  const collapsed = [...new JSDOM(renderOversight({ sample, facts, css: '' })).window.document.querySelectorAll('details.ov-group:not([open]) [data-row]')][0];
  const { doc } = await boot({ token: 'hash', hash: `#${collapsed.id}` });
  assert.equal(doc.getElementById(collapsed.id).closest('details').open, true);
});
