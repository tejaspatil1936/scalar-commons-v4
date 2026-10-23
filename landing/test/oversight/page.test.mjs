// The page and its script, booted together in a DOM.
//
// test/oversight.test.mjs checks the markup and test/oversight/verify.test.mjs
// checks the arithmetic. Neither would catch the bug that matters most here: a
// selector in main.js that no longer matches the markup, which would leave
// every check reading "Not yet hashed in this browser" forever while the page
// looked fine. So this one renders the real page, runs the real script against
// it, and asserts what a reader would actually see.
//
// Five scenarios, none with a network:
//
//   private  — the record names a loopback node (the checked-in sample). The
//              hash check runs, the figure fills, and NOTHING is fetched from
//              that node: no request, no status line, no console error.
//   offline  — a public node that does not answer. The hash check still runs
//              and the page SAYS it is offline.
//   live     — a public node answers with real extrinsics from the fixture.
//              Those rows report a live re-read and agree with the record.
//   disagree — the node serves the wrong extrinsic; the row is flagged.
//   other    — the node is a different chain; refused rather than decoded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { CHECK, DISAGREE_WORD, STATUS, renderOversight } from '../../src/oversight.mjs';

const readJson = (relative) => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const sample = readJson('../../public/oversight-sample.json');
const facts = readJson('../../chain-facts.json');
const fixture = readJson('./extrinsics.fixture.json');

const PUBLIC = 'https://node.test';
/** The sample with a public node in its record. */
const publicSample = { ...sample, provenance: { ...sample.provenance, endpoint: 'wss://node.test', httpEndpoint: PUBLIC } };

/** Boot the page with `fetchImpl` standing in for the network. */
async function boot(fetchImpl, { token, record = sample, hash = '' }) {
  const html = renderOversight({ sample: record, facts, builtAt: facts.provenance.fetchedAt, css: '' });
  const dom = new JSDOM(html, { url: `http://localhost/oversight${hash}` });
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, location: globalThis.location };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  const calls = [];
  // The hosted page fetches its data file beside itself; only the RPC calls go
  // to `fetchImpl`, so each scenario describes the chain and nothing else.
  globalThis.fetch = (url, init) => {
    if (String(url).includes('oversight-sample.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(record) });
    }
    calls.push(String(url));
    return fetchImpl(url, init);
  };
  const errors = [];
  const { error } = console;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    // A fresh module instance per scenario: main.js boots on import, and a
    // cached module would not boot again.
    await import(`../../src/oversight/main.js?case=${token}`);
    // Let the boot's promise chain drain. The script awaits one block read per
    // row, so this waits for a few turns rather than one.
    for (let i = 0; i < 60; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  } finally {
    console.error = error;
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.fetch = saved.fetch;
    globalThis.location = saved.location;
  }
  return { doc: dom.window.document, calls, errors, window: dom.window };
}

const checkOf = (doc, id) => doc.querySelector(`[data-check="commitment"][data-for="${id}"]`);
const provOf = (doc, id) => doc.querySelector(`[data-prov="row"][data-for="${id}"]`);
const recheckOf = (doc) => doc.querySelector('[data-stat="rechecked"] [data-value]').textContent;
const readable = sample.rows.filter((r) => r.plaintext !== null);

test('private endpoint: the hash check runs on the recorded commitment, the figure fills, and the node is never contacted', async () => {
  const { doc, calls, errors } = await boot(() => Promise.reject(new Error('must not be called')), { token: 'private' });
  assert.deepEqual(calls, [], 'no request leaves the page for the private node');
  assert.deepEqual(errors, [], 'nothing is logged as an error');
  assert.equal(doc.querySelector('[data-ov-status]'), null, 'no status line exists to say "connecting"');
  for (const row of readable) {
    const check = checkOf(doc, row.id);
    assert.equal(check.dataset.state, 'ok', `row ${row.id} must verify from the bytes in the page`);
    assert.equal(check.textContent, CHECK.recorded, 'and must say it used the recorded commitment');
  }
  for (const row of sample.rows.filter((r) => r.plaintext === null)) {
    assert.equal(checkOf(doc, row.id).dataset.state, 'na', `row ${row.id} has nothing to hash`);
    assert.equal(checkOf(doc, row.id).textContent, CHECK.none);
  }
  assert.equal(doc.querySelectorAll('[data-state="pending"]').length, 0, 'no row is left claiming a check is still in progress');
  assert.equal(recheckOf(doc), `${readable.length} of ${sample.rows.length}`);
  assert.match(doc.querySelector('[data-stat="rechecked"] [data-caption]').textContent, /recorded commitment/);
  assert.match(doc.querySelector('[data-announce]').textContent, /not public/);
  assert.equal(doc.querySelectorAll('[data-disagrees]').length, 0);
});

test('offline: a public node that does not answer — the hash check still runs, and the page says it is offline', async () => {
  const { doc, calls } = await boot(() => Promise.reject(new Error('no network')), { token: 'offline', record: publicSample });
  assert.ok(calls.length > 0 && calls.every((u) => u === PUBLIC), 'the public node was asked, and nothing else');
  const status = doc.querySelector('[data-ov-status]');
  assert.equal(status.dataset.state, 'offline');
  assert.equal(status.querySelector('[data-status-text]').textContent, STATUS.offline);
  assert.ok(status.querySelector('.sc-callout').classList.contains('sc-callout-warning'), 'offline is a warning callout');
  for (const row of readable) {
    const check = checkOf(doc, row.id);
    assert.equal(check.dataset.state, 'ok', `row ${row.id} must verify offline`);
    assert.equal(check.textContent, CHECK.recorded);
  }
  assert.match(provOf(doc, sample.rows[0].id).textContent, /Recorded by the read-only tool\. https:\/\/node\.test: unreachable\./);
  assert.equal(recheckOf(doc), `${readable.length} of ${sample.rows.length}`);
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
      return byBlock.has(block) ? reply(hashFor(block)) : Promise.resolve({ ok: true, json: () => Promise.resolve({ error: { message: 'unknown block' } }) });
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

  const { doc } = await boot(fetchImpl, { token: 'live', record: publicSample });

  const status = doc.querySelector('[data-ov-status]');
  assert.equal(status.dataset.state, 'live');
  assert.equal(status.querySelector('[data-status-text]').textContent, STATUS.live(703710));
  assert.ok(status.querySelector('.sc-callout').classList.contains('sc-callout-info'));

  for (const { row } of byBlock.values()) {
    const prov = provOf(doc, row.id).textContent;
    assert.match(prov, /^Re-read from https:\/\/node\.test at /, `row ${row.id} provenance must name the live read`);
    assert.match(prov, /extrinsic hash and fields agree with the record\.$/, `row ${row.id} must agree with the record`);
    if (row.plaintext !== null) {
      const check = checkOf(doc, row.id);
      assert.equal(check.dataset.state, 'ok');
      assert.equal(check.textContent, CHECK.live, 'checked against the LIVE commitment');
    }
    assert.equal(doc.querySelector(`[data-field="payloadHash"][data-for="${row.id}"]`).dataset.live, 'agrees', `row ${row.id}: the live payload hash must be marked as agreeing`);
    assert.equal(doc.querySelector(`[data-field="kind"][data-for="${row.id}"]`).dataset.live, undefined, 'the kind agrees, so it is left as it is');
  }

  // A block the node would not serve must fall back and say why, not go blank.
  const unserved = sample.rows.find((r) => !byBlock.has(r.block));
  assert.match(provOf(doc, unserved.id).textContent, /Recorded by the read-only tool\. .*unknown block/);
  assert.match(doc.querySelector('[data-stat="rechecked"] [data-caption]').textContent, /on-chain commitment at block 703,710/);
  assert.equal(doc.querySelectorAll('[data-disagrees]').length, 0);
});

test('a chain that disagrees with the record is marked in the open: the word is shown and the row is flagged', async () => {
  // The node serves a REAL extrinsic, but at the index of a DIFFERENT row. The
  // page must notice rather than present it as that row's live value.
  const victim = sample.rows.find((r) => r.id === fixture.cases[0].id);
  const other = fixture.cases[1] ?? fixture.cases[0];
  const hash = '0xdecoy';
  const fetchImpl = (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    const reply = (result) => Promise.resolve({ ok: true, json: () => Promise.resolve({ result }) });
    if (method === 'chain_getHeader') return reply({ number: '0x10' });
    if (method === 'chain_getBlockHash') {
      if (params[0] === '0x0') return reply(sample.provenance.genesisHash);
      return Number.parseInt(params[0], 16) === victim.block ? reply(hash) : Promise.resolve({ ok: true, json: () => Promise.resolve({ error: { message: 'unknown block' } }) });
    }
    if (method === 'chain_getBlock') {
      const extrinsics = [];
      for (let i = 0; i <= victim.extrinsicIndex; i += 1) extrinsics[i] = other.extrinsicHex;
      return reply({ block: { extrinsics } });
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  };

  const { doc } = await boot(fetchImpl, { token: 'disagrees', record: publicSample });
  const prov = provOf(doc, victim.id).textContent;
  // Either the payload is not in those bytes, or the extrinsic hash is wrong —
  // whichever it notices first, it must say something and must not claim agreement.
  assert.ok(!/agree with the record/.test(prov), `must not claim agreement: ${prov}`);
  assert.match(prov, /does not match the record|could not decode the call/);
  if (/does not match/.test(prov)) {
    const word = doc.querySelector(`[data-disagree][data-for="${victim.id}"]`);
    assert.equal(word.hasAttribute('hidden'), false, 'the word is shown');
    assert.equal(word.textContent, DISAGREE_WORD);
    assert.ok(word.closest('tr').hasAttribute('data-disagrees'), 'the row is flagged for the stylesheet');
  }
});

test('a node on a different chain is refused rather than decoded', async () => {
  const fetchImpl = (_url, init) => {
    const { method } = JSON.parse(init.body);
    const reply = (result) => Promise.resolve({ ok: true, json: () => Promise.resolve({ result }) });
    if (method === 'chain_getHeader') return reply({ number: '0x1' });
    if (method === 'chain_getBlockHash') return reply(`0x${'11'.repeat(32)}`);
    return Promise.reject(new Error('should never be asked for a block'));
  };
  const { doc } = await boot(fetchImpl, { token: 'otherchain', record: publicSample });
  const status = doc.querySelector('[data-ov-status]');
  assert.equal(status.dataset.state, 'error');
  assert.equal(status.querySelector('[data-status-text]').textContent, STATUS.otherChain);
  assert.match(provOf(doc, sample.rows[0].id).textContent, /is not this sample's chain/);
  // The in-page hash check still ran, against the recorded commitment.
  assert.equal(checkOf(doc, readable[0].id).dataset.state, 'ok');
});

test('a link into a shut group opens it: on load from the hash, and again on hashchange', async () => {
  const { doc, window } = await boot(() => Promise.reject(new Error('must not be called')), { token: 'reveal', hash: '#g-sealed' });
  assert.equal(doc.getElementById('g-sealed').open, true, 'the group named in the URL is open on load');
  assert.equal(doc.getElementById('g-plain').open, false, 'the others stay shut');
  // A link from the index to a message inside a shut group.
  const target = sample.rows.find((r) => r.bodyType === 'Plain');
  globalThis.window = window;
  globalThis.document = doc;
  globalThis.location = window.location;
  try {
    window.location.hash = `#msg-${target.id}`;
    window.dispatchEvent(new window.Event('hashchange'));
    // jsdom queues its own hashchange for the fragment navigation; let it run while the globals still exist.
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.location;
  }
  assert.equal(doc.getElementById('g-plain').open, true, 'the group holding the message opens');
});
