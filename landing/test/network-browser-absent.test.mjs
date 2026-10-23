// /network's script when the node answers but returns nothing for a storage
// item (absent, or a key this runtime does not have): that figure says
// "Not read" once the read is done — never a loading bar left in place, and
// never a zero for a value the page did not get.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageKey } from '../src/observatory/scale.js';
import { boot, statText, FIX } from './lib/network-dom.mjs';

const absent = [storageKey('Escrow', 'ActiveAgreementCount'), storageKey('Emissions', 'LastEraEmission')];
const { document, settle } = await boot({ absent });
await settle(() => statText(document, 'height').value === String(FIX.best) && statText(document, 'agents').value === String(FIX.agents), 10_000);
await settle(() => statText(document, 'agreements').value !== '', 2_000);

test('a storage item the node returned nothing for says Not read, not a loading bar and not zero', () => {
  for (const key of ['agreements', 'lastEmission']) {
    const el = document.querySelector(`[data-stat="${key}"] [data-value]`);
    assert.equal(el.querySelector('.sc-skeleton'), null, `${key}: no loading bar after the read`);
    assert.equal(statText(document, key).value, 'Not read', key);
  }
  // The items that were there are shown as read.
  assert.equal(statText(document, 'agents').value, String(FIX.agents));
});
