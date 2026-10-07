// The page and its script, booted together in a DOM.
//
// test/oversight.test.mjs checks the markup and test/oversight/verify.test.mjs
// checks the arithmetic. Neither would catch the bug that matters most here: a
// selector in main.js that no longer matches the markup, which would leave
// every badge reading "Hashing in your browser…" forever while the page looked
// fine. So this one renders the real page, runs the real script against it, and
// asserts what a reader would actually see.
//
// Two scenarios, both without a network:
//
//   offline — every RPC fails. The commitment check must still run (the bytes
//             are already in the page) and the page must SAY it is offline.
//   live    — the node answers with real extrinsics from the fixture. Those
//             rows must report a live re-read, and their provenance must say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { renderOversight } from '../../src/oversight.mjs';

const readJson = (relative) => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const sample = readJson('../../public/oversight-sample.json');
const fixture = readJson('./extrinsics.fixture.json');

/** Boot the page with `fetchImpl` standing in for the network. */
async function boot(fetchImpl, { token }) {
  const html = renderOversight({ sample, css: '' });
  const dom = new JSDOM(html, { url: 'http://localhost/oversight' });
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  // The hosted page fetches its data file beside itself; only the RPC calls go
  // to `fetchImpl`, so each scenario describes the chain and nothing else.
  globalThis.fetch = (url, init) => {
    if (String(url).includes('oversight-sample.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(sample) });
    }
    return fetchImpl(url, init);
  };
  try {
    // A fresh module instance per scenario: main.js boots on import, and a
    // cached module would not boot again.
    await import(`../../src/oversight/main.js?case=${token}`);
    // Let the boot's promise chain drain. The script awaits one block read per
    // row, so this waits for a few turns rather than one.
    for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.fetch = saved.fetch;
  }
  return dom.window.document;
}

const badgeOf = (doc, id) => doc.querySelector(`[data-row="${id}"] [data-check="commitment"] .ov-badge`);
const provOf = (doc, id) => doc.querySelector(`[data-row="${id}"] [data-prov="row"]`);

test('offline: the hash check still runs, and the page says it is offline', async () => {
  const doc = await boot(() => Promise.reject(new Error('no network')), { token: 'offline' });

  assert.match(doc.querySelector('.ov-bar .sb-state').textContent, /offline — showing recorded values/);
  assert.equal(doc.querySelector('.ov-bar').dataset.state, 'offline');

  const readable = sample.rows.filter((r) => r.plaintext !== null);
  for (const row of readable) {
    const badge = badgeOf(doc, row.id);
    assert.equal(badge.dataset.state, 'ok', `row ${row.id} must verify offline`);
    assert.match(badge.textContent, /hashes to recorded commitment ✓/, 'and must say it used the RECORDED commitment');
  }
  for (const row of sample.rows.filter((r) => r.plaintext === null)) {
    assert.equal(badgeOf(doc, row.id).dataset.state, 'na', `row ${row.id} has nothing to hash`);
  }
  // No row may be left claiming a check is still in progress.
  assert.equal(doc.querySelectorAll('[data-state="pending"]').length, 0);
  assert.match(provOf(doc, sample.rows[0].id).textContent, /offline — showing recorded values/);
});

test('live: a row whose block the node serves is re-read and reported as live', async () => {
  const byBlock = new Map();
  for (const c of fixture.cases) {
    const row = sample.rows.find((r) => r.id === c.id);
    byBlock.set(row.block, { row, extrinsicHex: c.extrinsicHex });
  }
  const hashFor = (block) => `0xblock${block}`;

  const fetchImpl = (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    const reply = (result) => Promise.resolve({ ok: true, json: () => Promise.resolve({ result }) });
    if (method === 'chain_getHeader') return reply({ number: '0xabcde' });
    if (method === 'chain_getBlockHash') {
      if (params[0] === '0x0') return reply(sample.provenance.genesisHash);
      const block = Number.parseInt(params[0], 16);
      return byBlock.has(block)
        ? reply(hashFor(block))
        : Promise.resolve({ ok: true, json: () => Promise.resolve({ error: { message: 'unknown block' } }) });
    }
    if (method === 'chain_getBlock') {
      const block = [...byBlock.keys()].find((b) => hashFor(b) === params[0]);
      const entry = byBlock.get(block);
      // The extrinsic must sit at the index the record names, so the page is
      // exercised picking it out of a real block's worth of them.
      const extrinsics = [];
      extrinsics[entry.row.extrinsicIndex] = entry.extrinsicHex;
      for (let i = 0; i < extrinsics.length; i += 1) if (!extrinsics[i]) extrinsics[i] = '0x00';
      return reply({ block: { extrinsics } });
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  };

  const doc = await boot(fetchImpl, { token: 'live' });

  assert.match(doc.querySelector('.ov-bar .sb-state').textContent, /live at block #703710/);
  assert.equal(doc.querySelector('.ov-bar').dataset.state, 'live');

  for (const { row } of byBlock.values()) {
    const prov = provOf(doc, row.id).textContent;
    assert.match(prov, /re-read live from/, `row ${row.id} provenance must name the live read`);
    assert.match(prov, /extrinsic hash and fields agree with the record/, `row ${row.id} must agree with the record`);
    if (row.plaintext !== null) {
      const badge = badgeOf(doc, row.id);
      assert.equal(badge.dataset.state, 'ok');
      assert.match(badge.textContent, /hashes to on-chain commitment ✓/, 'checked against the LIVE commitment');
    }
    assert.equal(
      doc.querySelector(`[data-row="${row.id}"] [data-field="payloadHash"]`).dataset.live,
      'agrees',
      `row ${row.id}: the live payload hash must be marked as agreeing`,
    );
  }

  // A block the node would not serve must fall back and say why, not go blank.
  const unserved = sample.rows.find((r) => !byBlock.has(r.block));
  assert.match(provOf(doc, unserved.id).textContent, /offline — showing recorded values|unknown block/);
});

test('a node on a different chain is refused rather than decoded', async () => {
  const fetchImpl = (_url, init) => {
    const { method } = JSON.parse(init.body);
    const reply = (result) => Promise.resolve({ ok: true, json: () => Promise.resolve({ result }) });
    if (method === 'chain_getHeader') return reply({ number: '0x1' });
    if (method === 'chain_getBlockHash') return reply(`0x${'11'.repeat(32)}`);
    return Promise.reject(new Error('should never be asked for a block'));
  };
  const doc = await boot(fetchImpl, { token: 'otherchain' });
  assert.match(doc.querySelector('.ov-bar .sb-state').textContent, /different chain/);
  assert.match(provOf(doc, sample.rows[0].id).textContent, /is not this sample's chain/);
  // The in-page hash check still ran, against the recorded commitment.
  const readable = sample.rows.find((r) => r.plaintext !== null);
  assert.equal(badgeOf(doc, readable.id).dataset.state, 'ok');
});
