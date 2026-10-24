// /network's script when neither the node nor the indexer answers: the
// build-time values stay, each is marked Stale, a value the build never had
// says "Not read" (never zero), tables say why in one sentence, and the
// warning callout names both and the time the values are from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, statText, facts } from './lib/network-dom.mjs';

const { document, settle } = await boot({ fail: true });
await settle(() => /Can’t reach/.test(document.querySelector('[data-alert]').textContent) && document.querySelectorAll('.sc-skeleton').length === 0, 15_000);

test('the warning callout names the node and the indexer and the time the values are from', () => {
  const alert = document.querySelector('[data-alert] .sc-callout-warning');
  assert.ok(alert, 'a warning callout');
  assert.match(alert.textContent, /Can’t reach the node \(wss:\/\/rpc\.scalarnet\.io\) or the indexer \(https:\/\/api\.scalarnet\.io\/v1\)\. Values are from when this page was built/);
});

test('build-time values stay, marked Stale; unknowns say Not read, never zero', () => {
  const height = statText(document, 'height');
  assert.equal(height.value, new Intl.NumberFormat('en-US').format(facts.provenance.readAtBlock));
  assert.match(height.caption, /Stale/);
  // Open disputes is a build value read from the indexer's escrows: when that read fails it is Stale too.
  const disputes = statText(document, 'disputes');
  assert.equal(disputes.value, new Intl.NumberFormat('en-US').format(facts.state.openDisputes));
  assert.match(disputes.caption, /Stale/);
  for (const key of ['agreements', 'messages', 'lastEmission', 'active', 'inDispute', 'slashed']) {
    const s = statText(document, key);
    assert.equal(s.value, 'Not read', key);
    assert.match(s.caption, /Stale/, key);
  }
  assert.ok(![...document.querySelectorAll('[data-value]')].some((v) => v.textContent.trim() === '0'), 'no zero for an unknown');
});

test('tables that could not be read say so in a sentence', () => {
  assert.equal(document.querySelector('#activity-table tbody').textContent.trim(), 'Not read: the indexer did not answer.');
  assert.equal(document.querySelector('#validators-table tbody').textContent.trim(), 'Not read: the node did not answer.');
  assert.equal(document.querySelector('#agents-table tbody').textContent.trim(), 'Not read: the indexer did not answer.');
  assert.ok(document.querySelector('#blocks-table tbody tr td:nth-child(2)').textContent.includes('Not read'));
});
