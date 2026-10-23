// /network's script in a browser (jsdom) against a fake node and a fake
// indexer: every value is replaced in place from what they answer, the
// tables fill, the authorship of each header is attributed through the BABE
// keys, and with both answering there is no warning callout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, statText, FIX } from './lib/network-dom.mjs';

const { document, settle } = await boot();
await settle(() => statText(document, 'messages').value === '42' && document.querySelectorAll('#validators-table tbody tr').length === 2);

test('the status row is replaced in place from the node and the indexer', () => {
  assert.equal(statText(document, 'height').value, String(FIX.best));
  assert.equal(statText(document, 'finalized').value, String(FIX.finalized));
  assert.deepEqual(statText(document, 'validators'), { value: '2', caption: `of ${FIX.seats} seats` });
  assert.deepEqual(statText(document, 'era'), { value: String(FIX.era), caption: `${FIX.best - FIX.eraStart} / 3,600 blocks` });
  assert.equal(statText(document, 'agents').value, String(FIX.agents));
  assert.equal(statText(document, 'agents').caption, '1 operator-run');
  assert.equal(statText(document, 'agreements').value, String(FIX.agreements));
  assert.equal(statText(document, 'messages').value, '42');
  assert.equal(statText(document, 'disputes').value, '1', 'a whole escrow list replaces the build-time count');
  assert.equal(document.querySelector('[data-alert]').textContent.trim(), '', 'no warning while both answer');
  assert.match(document.querySelector('[data-updated]').textContent, /^Updated \d+ s ago\.$/);
  assert.equal(document.querySelectorAll('.sc-skeleton').length, 0, 'no loading bar is left');
});

test('emissions and agents', () => {
  assert.deepEqual(statText(document, 'issued'), { value: '18 billion', caption: '18 % of the cap' });
  assert.deepEqual(statText(document, 'lastEmission'), { value: '2,500', caption: `Era ${FIX.era - 1}` });
  assert.equal(statText(document, 'settlement').value, '3,650');
  assert.match(statText(document, 'settlement').caption, /^≈ \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC \(in about/);
  assert.equal(statText(document, 'active').value, '3', 'every heartbeat is within the grace period of block 100');
  assert.equal(statText(document, 'inDispute').value, '2');
  assert.equal(statText(document, 'slashed').value, '2', 'both slashes are within an hour of block 100');
  const rows = [...document.querySelectorAll('#agents-table tbody tr')].map((r) => r.textContent);
  assert.equal(rows.length, 3);
  assert.match(rows[1], /Leaving at block 400/, 'newest first; an unstaking agent says when it leaves');
  assert.match(document.querySelector('#agents-table').textContent, /swarm-0001[\s\S]*Operator-run[\s\S]*Active/);
});

test('validators: every header in the window attributed through the BABE keys; recent blocks with age, author and finality', () => {
  const rows = [...document.querySelectorAll('#validators-table tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.replace(/Copy$/, '').trim()));
  assert.deepEqual(rows.map((r) => [r[0], r[2], r[3]]), [['1', 'Active', '30'], ['2', 'Active', '30']]);
  assert.deepEqual(rows.map((r) => r[4]), ['100', '99'], 'even blocks name authority 0, odd ones authority 1');
  assert.equal(document.querySelector('#validators-table thead th:nth-child(4)').textContent, 'Blocks authored (last 60 blocks)');
  const blocks = [...document.querySelectorAll('#blocks-table tbody tr')];
  assert.equal(blocks.length, 12);
  assert.match(blocks[0].textContent, /^100/);
  assert.match(blocks[0].textContent, /Pending$/);
  assert.match(blocks[2].textContent, /Finalized$/);
  assert.equal(blocks[0].cells[3].textContent, '2', 'the extrinsic count');
  assert.ok(blocks[0].cells[1].querySelector('[title$="UTC"]'), 'the age carries the UTC time in its title');
  assert.ok(blocks[0].cells[2].querySelector(`a[href="https://explorer.scalarnet.io/account/${FIX.addresses[0]}"]`), 'the author links to the explorer');
});

test('activity in plain words, with the dispute badge, and a filter chip reads the indexer’s own kind', async () => {
  const row = document.querySelector('#activity-table tbody tr');
  assert.match(row.cells[1].textContent, /^Dispute opened\s*Dispute$/);
  assert.equal(row.cells[3].textContent, 'Agreement 3');
  assert.equal(row.cells[2].querySelectorAll('a').length, 2);
  const chip = [...document.querySelectorAll('.sc-chip')].find((c) => c.textContent === 'Disputes');
  chip.click();
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelectorAll('.sc-chip[aria-pressed="true"]').length, 1);
});

test('the sources table says when each figure was last read', () => {
  for (const key of ['height', 'agentList', 'escrows', 'messages', 'activity', 'slashes']) {
    assert.match(document.querySelector(`[data-read="${key}"]`).textContent, /^Block 100, \d{2}:\d{2}:\d{2} UTC$/, key);
  }
});
