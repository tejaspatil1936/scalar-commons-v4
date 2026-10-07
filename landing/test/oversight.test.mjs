// The /oversight page frame.
//
// What is held here is what the page must not quietly lose: the three
// sentences, the devnet label out in the open rather than behind a disclosure,
// every row of the sample rendered (including the ones that could not be
// read), the thread grouped, the honest explorer caveat, and — the important
// one — no secret and no filesystem path anywhere in the markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { EXPLANATION, FIGURES, TITLE, renderOversight } from '../src/oversight.mjs';
import { OVERSIGHT_NAV } from '../src/observatory.mjs';

const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/oversight-sample.json', import.meta.url)), 'utf8'),
);
const html = renderOversight({ sample, css: '/* css */' });

test('the page says what it is, and names the chain it read', () => {
  assert.match(html, /<title>Agent messaging — oversight sample — Scalar Commons<\/title>/);
  assert.ok(html.includes(TITLE));
  assert.ok(html.includes(sample.provenance.chainName), 'the chain’s own name must appear');
  assert.ok(html.includes(sample.provenance.genesisHash), 'and its genesis hash');
  assert.ok(html.includes(sample.provenance.endpoint), 'and where it was read from');
});

test('the three sentences are all present, in order, above everything else', () => {
  assert.equal(EXPLANATION.length, 3, 'the brief asked for three sentences');
  let at = -1;
  for (const sentence of EXPLANATION) {
    const found = html.indexOf(sentence);
    assert.ok(found > 0, `missing: ${sentence.slice(0, 40)}…`);
    assert.ok(found > at, 'the sentences must stay in order');
    at = found;
  }
  assert.ok(at < html.indexOf('ov-rows'), 'they come before the rows');
});

test('the devnet caveat is in the open, not behind the disclosure', () => {
  const label = html.indexOf('ov-label');
  const disclosure = html.indexOf('<details');
  assert.ok(label > 0, 'the label must be rendered');
  assert.ok(label < disclosure, 'and it must come before the first disclosure');
  assert.ok(html.includes(sample.provenance.networkNote), 'in the record’s own words');
});

test('every row of the sample is rendered, with its block, kind and commitment', () => {
  const rendered = [...html.matchAll(/data-row="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(rendered.length, sample.rows.length, 'no row may be dropped');
  assert.deepEqual(new Set(rendered), new Set(sample.rows.map((r) => r.id)));
  for (const row of sample.rows) {
    assert.ok(html.includes(`data-block="${row.block}"`), `row ${row.id}: block`);
    if (row.payloadHashOnChain) assert.ok(html.includes(row.payloadHashOnChain), `row ${row.id}: commitment`);
  }
});

test('rows the operator could not open are rendered, greyed, and give their reason', () => {
  const shut = sample.rows.filter((r) => r.plaintext === null);
  assert.ok(shut.length > 0, 'the sample must contain some');
  assert.equal((html.match(/ov-row is-quiet/g) ?? []).length, shut.length, 'each one is dimmed');
  for (const row of shut) {
    assert.ok(html.includes(row.reason), `row ${row.id}: its reason must be on the page`);
    assert.ok(!html.includes('"plaintext":'), 'and no raw JSON row is dumped into the markup');
  }
  assert.ok(html.includes('Sealed — no key held'), 'the no-key label the brief asked for, verbatim');
});

test('a decrypted plaintext is shown as text, and claims only an in-browser check it will actually run', () => {
  const open = sample.rows.find((r) => r.decrypted);
  assert.ok(open, 'the sample must contain a decrypted row');
  assert.ok(html.includes('Hashing in your browser…'), 'the commitment badge starts as pending, not as a claim');
  assert.ok(html.includes('Signature verified (operator)'), 'the signature is attributed to the operator’s tool');
  assert.ok(
    !html.includes('Plaintext hashes to on-chain commitment ✓'),
    'the page must NOT ship a pre-baked tick for a check the browser has not done yet',
  );
});

test('the thread is grouped, in order, and the other rows are not repeated', () => {
  const ids = sample.summary.thread.rowIds;
  const threadBlock = html.slice(html.indexOf('ov-rows-thread'), html.indexOf('02 · The sample'));
  for (const id of ids) assert.ok(threadBlock.includes(`data-row="${id}"`), `${id} belongs in the thread block`);
  const kinds = ids.map((id) => sample.rows.find((r) => r.id === id).kind);
  assert.deepEqual(kinds, ['Offer', 'Accept', 'DeliveryNotice'], 'the three steps, in order');
  for (const id of ids) {
    assert.equal((html.match(new RegExp(`data-row="${id}"`, 'g')) ?? []).length, 1, `${id} is rendered once`);
  }
});

test('the explorer link is honest about which chain the explorer indexes', () => {
  assert.equal(sample.provenance.explorer.indexesThisChain, false, 'this sample is a devnet');
  assert.ok(html.includes('Not in explorer.scalarnet.io'), 'so no row may link into it');
  assert.ok(!html.includes('explorer.scalarnet.io/activity?agent='), 'and no such href may be emitted');
  const publicSample = {
    ...sample,
    provenance: { ...sample.provenance, explorer: { ...sample.provenance.explorer, indexesThisChain: true } },
  };
  const publicHtml = renderOversight({ sample: publicSample, css: '' });
  assert.ok(publicHtml.includes('explorer.scalarnet.io/activity?agent='), 'on the public chain the link appears');
});

test('the summary figures come from the record, and the self-check is one of them', () => {
  assert.deepEqual(FIGURES.map(([key]) => key), ['selfCheck', 'decryptedCount', 'noKeyHeldCount', 'signaturesVerified']);
  assert.ok(html.includes(sample.summary.selfCheck), 'the self-check result is stated on the page');
  assert.ok(html.includes(`${sample.summary.decryptedCount} of ${sample.summary.rows}`));
  assert.ok(html.includes(`${sample.summary.noKeyHeldCount} of ${sample.summary.rows}`));
});

test('the Sources switch, presenter mode and the nav entry are all wired', () => {
  assert.ok(html.includes('class="btn sb-sources"'), 'Sources');
  assert.ok(html.includes('aria-keyshortcuts="P"'), 'presenter mode on the P key');
  assert.ok((html.match(/data-present-screen/g) ?? []).length >= 2, 'at least two presenter screens');
  assert.equal(OVERSIGHT_NAV.label, 'Oversight');
  assert.match(html, /<a href="oversight" aria-current="page">Oversight<\/a>/);
});

test('"How to read this" is a disclosure and covers all four questions the brief named', () => {
  assert.ok(html.includes('<summary>How to read this</summary>'));
  for (const phrase of ['What is public to everyone', 'What was encrypted', 'What was decrypted', 'What your browser just checked']) {
    assert.ok(html.includes(phrase), `missing: ${phrase}`);
  }
});

test('no secret and no private path reaches the markup', () => {
  for (const forbidden of ['.mnemonic', 'master.seed', '/home/dev', 'secretKey', 'suri', 'SURI']) {
    assert.ok(!html.includes(forbidden), `the page must not contain ${forbidden}`);
  }
  // A mnemonic is twelve or more lowercase words in a row; nothing on this page
  // should look like one.
  assert.ok(!/\b([a-z]{3,8}\s){11}[a-z]{3,8}\b/.test(html.replace(/<[^>]+>/g, ' ')), 'no mnemonic-shaped run of words');
});

test('the standalone copy inlines its data and its script, and the hosted one does not', () => {
  const standalone = renderOversight({ sample, css: '', inlineData: true, standalone: true, inlineScript: 'console.log(1)' });
  assert.ok(standalone.includes('id="oversight-sample"'), 'the sample rides inside the file');
  assert.ok(standalone.includes('console.log(1)'), 'and so does the script');
  assert.ok(!standalone.includes('src="oversight.js"'), 'with nothing left to fetch');
  assert.ok(standalone.includes('data-standalone'));
  assert.ok(html.includes('src="oversight.js"'), 'the hosted page still loads its script by URL');
  assert.ok(!html.includes('id="oversight-sample"'), 'and fetches its data');
});

test('a record missing the provenance the page depends on fails the build', () => {
  for (const key of ['explorer', 'httpEndpoint', 'callIndex']) {
    const broken = { ...sample, provenance: { ...sample.provenance, [key]: undefined } };
    assert.throws(() => renderOversight({ sample: broken }), new RegExp(`provenance\\.${key} is missing`));
  }
  const noThread = { ...sample, summary: { ...sample.summary, thread: null } };
  assert.throws(() => renderOversight({ sample: noThread }), /no complete thread/);
});

test('the script escapes a closing tag inside the inlined data, so markup cannot break out', () => {
  const nasty = {
    ...sample,
    rows: [{ ...sample.rows[0], plaintext: '</script><script>alert(1)</script>' }],
  };
  const standalone = renderOversight({ sample: nasty, css: '', inlineData: true, inlineScript: '' });
  const json = standalone.slice(standalone.indexOf('id="oversight-sample"'));
  assert.ok(!json.slice(0, json.indexOf('</script>')).includes('<script>'), 'no raw script tag survives in the data block');
  assert.ok(!standalone.includes('<script>alert(1)</script>'), 'and none in the rendered row either');
});
