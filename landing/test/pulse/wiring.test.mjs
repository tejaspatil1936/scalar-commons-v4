// The pure parts of the page's wiring: what the strip says a figure was
// counted from, what the banner says for each feed state, an agent's role
// from the open agreements, and the device-pixel ceiling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisText, KEYS } from '../../src/pulse/strip.js';
import { MAX_DPR, bannerText, capDevicePixelRatio, roleOf } from '../../src/pulse/wiring.js';
import { FIGURES } from '../../src/pulse.mjs';

test('the strip names both reads a figure comes from, and the three keys are the page’s three figures', () => {
  assert.equal(basisText(0), 'from the index’s last hour');
  assert.equal(basisText(1), 'from the index’s last hour and 1 live event since');
  assert.equal(basisText(12), 'from the index’s last hour and 12 live events since');
  assert.deepEqual(KEYS, FIGURES.map(([key]) => key));
});

test('the banner says why nothing is moving, and nothing when the feed is live', () => {
  assert.equal(bannerText({ state: 'live' }), '');
  assert.equal(bannerText({ state: 'connecting' }), '');
  assert.equal(bannerText({ state: 'unavailable', reason: 'socket WebSocket closed (code 1006); status poll request failed' }), 'live feed unavailable — socket WebSocket closed (code 1006); status poll request failed');
  assert.equal(bannerText({ state: 'unavailable' }), 'live feed unavailable — no source answered');
  assert.equal(bannerText({ state: 'stale', head: 920_000, indexed: 919_000 }, (n) => n.toLocaleString('en-US')), 'live feed paused — the index is 1,000 blocks behind the chain');
  assert.equal(bannerText({ state: 'stale', reason: 'the index has not reported its height' }), 'live feed paused — the index has not reported its height');
});

test('an agent’s role is provider if it provides in any open agreement, else buyer if it buys, else agent', () => {
  const links = [
    { buyer: 'a', provider: 'b' },
    { buyer: 'b', provider: 'c' },
  ];
  assert.equal(roleOf('a', links), 'buyer');
  assert.equal(roleOf('b', links), 'provider', 'providing outranks buying');
  assert.equal(roleOf('c', links), 'provider');
  assert.equal(roleOf('d', links), 'agent');
  assert.equal(roleOf('a', []), 'agent');
});

test('the device-pixel ratio is capped at two, and a lower one is left alone', () => {
  assert.equal(MAX_DPR, 2);
  const phone = { devicePixelRatio: 3 };
  assert.equal(capDevicePixelRatio(phone), 2);
  assert.equal(phone.devicePixelRatio, 2);
  const laptop = { devicePixelRatio: 1.5 };
  assert.equal(capDevicePixelRatio(laptop), 1.5);
  assert.equal(laptop.devicePixelRatio, 1.5);
  assert.equal(capDevicePixelRatio({}), 1);
});
