// The words the page's readings and feed add around a figure, held to the
// brief: the stale stub's `as of <UTC>` (§4) and the quiet feed's sentence
// (§5.3). Both are pure; the DOM side is exercised in headless Chromium.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asOfText } from '../../src/pulse/readings.js';
import { quietText } from '../../src/pulse/ticker.js';

test('a stalled or disconnected reading says "as of <UTC>" from the instant its record was fetched, in epoch ms or ISO', () => {
  assert.equal(asOfText(Date.UTC(2026, 9, 23, 5, 48, 45)), 'as of 2026-10-23 05:48:45 UTC');
  assert.equal(asOfText('2026-10-23T05:48:45.123Z'), 'as of 2026-10-23 05:48:45 UTC');
  assert.equal(asOfText(null), 'as of —');
});

test('the quiet feed says exactly "no agent events in the last hour · last at block n", with the block grouped', () => {
  assert.equal(quietText(1157819), 'no agent events in the last hour · last at block 1,157,819');
  assert.match(quietText(7), /^no agent events in the last hour · last at block \d/);
});
