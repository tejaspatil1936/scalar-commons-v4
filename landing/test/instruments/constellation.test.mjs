// Unit tests for the constellation's pure model: edge keying and diffing,
// point synthesis for parties that have left, the radius scale, the label and
// fade thresholds, and the bundle offsets for parallel agreements.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUNDLE_CAP,
  BUNDLE_MAX_BAND,
  BUNDLE_MIN_SPACING,
  BUNDLE_SPACING,
  FADE_ISOLATED_ABOVE,
  GHOST_RADIUS,
  ISOLATED_ALPHA,
  LABEL_MAX_NODES,
  buildEdges,
  bundleLayout,
  diffEdges,
  edgeKey,
  forceScale,
  labelPolicy,
  nodeRadius,
  pairKey,
  parallelOffset,
  seedAngle,
  stateOf,
  summaryText,
  synthesizeNodes,
} from '../../src/observatory/instruments/constellation.js';

const A = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const B = '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y';
const C = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const D = '5GEEaf5HcdzeUDEH8t1naW6nP55sfSJWVxf5JCGJMQaEFQfd';

const open = (buyer, provider, seq, status = 'Created', createdAtBlock = 100) => ({
  buyer,
  provider,
  seq,
  status,
  amountPlancks: '10000000000000',
  createdAtBlock,
});
const settled = (buyer, provider, seq, blockNumber = 50) => ({
  buyer,
  provider,
  seq,
  amountPlancks: '10000000000000',
  blockNumber,
});
const agent = (address, stakePlancks = '10000000000000000') => ({
  address,
  stakePlancks,
  completedAgreements: 1,
  activeEscrowCount: 0,
  name: null,
  leaving: false,
});

test('edge keys are the on-chain identity: buyer, provider and running number', () => {
  assert.equal(edgeKey(A, B, 0), `${A}/${B}/0`);
  assert.notEqual(edgeKey(A, B, 0), edgeKey(B, A, 0), 'direction matters to the key');
  assert.equal(pairKey(A, B), pairKey(B, A), 'but both directions share one bundle');
});

test('Created and Delivered are open lines; Disputed is its own state', () => {
  assert.equal(stateOf('Created'), 'open');
  assert.equal(stateOf('Delivered'), 'open');
  assert.equal(stateOf('Disputed'), 'disputed');
});

test('buildEdges keeps every open line, adds settled ones once, and skips a settled key still open', () => {
  const { edges, settledShown } = buildEdges(
    [open(A, B, 0), open(A, B, 1, 'Disputed'), open(C, D, 0, 'Delivered')],
    [settled(A, B, 0), settled(B, C, 3), settled(B, C, 3), settled(D, A, 7)],
  );
  assert.equal(edges.size, 5);
  assert.equal(settledShown, 2, 'one settled line duplicated a key, one was still open');
  assert.equal(edges.get(edgeKey(A, B, 0)).state, 'open', 'the open agreement wins over a same-key settled event');
  assert.equal(edges.get(edgeKey(A, B, 1)).state, 'disputed');
  assert.equal(edges.get(edgeKey(C, D, 0)).state, 'open');
  assert.equal(edges.get(edgeKey(B, C, 3)).state, 'settled');
  assert.equal(edges.get(edgeKey(B, C, 3)).block, 50, 'a settled line carries the block it was confirmed in');
  assert.equal(edges.get(edgeKey(D, A, 7)).state, 'settled');
});

test('diffEdges reports what is new, what is gone and what became a dispute', () => {
  const before = buildEdges([open(A, B, 0), open(A, B, 1), open(C, D, 0)], [settled(B, C, 3)]).edges;
  const after = buildEdges([open(A, B, 1, 'Disputed'), open(C, D, 0), open(D, A, 9)], [settled(B, C, 3), settled(A, B, 0)]).edges;
  const diff = diffEdges(before, after);
  assert.deepEqual(
    diff.added.map((e) => e.key),
    [edgeKey(D, A, 9)],
    'A/B/0 moved from open to settled under the same key, so it is a change, not an arrival',
  );
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.disputed.map((e) => e.key), [edgeKey(A, B, 1)]);

  const gone = diffEdges(after, buildEdges([open(C, D, 0)], []).edges);
  assert.deepEqual(
    gone.removed.map((e) => e.key).sort(),
    [edgeKey(A, B, 0), edgeKey(A, B, 1), edgeKey(B, C, 3), edgeKey(D, A, 9)].sort(),
  );
  assert.deepEqual(gone.added, []);
  assert.deepEqual(gone.disputed, []);
});

test('a line already disputed does not pulse again', () => {
  const before = buildEdges([open(A, B, 1, 'Disputed')], []).edges;
  const after = buildEdges([open(A, B, 1, 'Disputed')], []).edges;
  assert.deepEqual(diffEdges(before, after).disputed, []);
});

test('synthesizeNodes adds a hollow point for a party not in the agent list, and counts degree', () => {
  const { edges } = buildEdges([open(A, B, 0), open(A, C, 0)], [settled(D, A, 2)]);
  const nodes = synthesizeNodes([agent(A), agent(B), agent(C)], edges);
  assert.equal(nodes.size, 4);
  assert.equal(nodes.get(A).ghost, false);
  assert.equal(nodes.get(A).degree, 3);
  assert.equal(nodes.get(B).degree, 1);
  assert.equal(nodes.get(D).ghost, true);
  assert.equal(nodes.get(D).reason, 'no longer registered');
  assert.equal(nodes.get(D).degree, 1);
  assert.equal(nodes.get(A).stakePlancks, '10000000000000000', 'agent fields ride along');
});

test('when the agent list was cut short, an absent party is not called "no longer registered"', () => {
  const { edges } = buildEdges([open(A, D, 0)], []);
  const nodes = synthesizeNodes([agent(A)], edges, { listComplete: false });
  assert.equal(nodes.get(D).ghost, true);
  assert.match(nodes.get(D).reason, /cut short/);
  assert.doesNotMatch(nodes.get(D).reason, /no longer registered/);
});

test('an agent with no lines is a lone point of degree zero', () => {
  const nodes = synthesizeNodes([agent(A), agent(B)], new Map());
  assert.equal(nodes.get(A).degree, 0);
  assert.equal(nodes.get(B).degree, 0);
});

test('nodeRadius grows with the square root of stake, between 3 and 11 px, and scales with crowding', () => {
  assert.equal(nodeRadius(10_000, 10_000), 11);
  assert.equal(nodeRadius(2_500, 10_000), 3 + 8 * 0.5, 'a quarter of the stake is half the radius step');
  assert.equal(nodeRadius(0, 10_000), 3);
  assert.equal(nodeRadius(10_000, 0), 11, 'with no scale to speak of every point is full size');
  assert.equal(nodeRadius(20_000, 10_000), 11, 'never beyond the range');
  assert.equal(nodeRadius(10_000, 10_000, 0.5), 5.5);
  assert.ok(GHOST_RADIUS < nodeRadius(0, 1), 'a party that has left is drawn smaller than any agent');
});

test('labels need a 64 rem viewport and at most 120 points; radii shrink and lone points fade beyond that', () => {
  assert.deepEqual(labelPolicy(1440, 34), { labels: true, radiusFactor: 1, isolatedAlpha: 1 });
  assert.deepEqual(labelPolicy(1023, 34), { labels: false, radiusFactor: 1, isolatedAlpha: 1 });
  assert.deepEqual(labelPolicy(1024, LABEL_MAX_NODES), { labels: true, radiusFactor: 1, isolatedAlpha: 1 });
  assert.deepEqual(labelPolicy(1440, LABEL_MAX_NODES + 1), { labels: false, radiusFactor: 0.7, isolatedAlpha: 1 });
  assert.deepEqual(labelPolicy(1440, FADE_ISOLATED_ABOVE), { labels: false, radiusFactor: 0.7, isolatedAlpha: 1 });
  assert.deepEqual(labelPolicy(1440, FADE_ISOLATED_ABOVE + 1), { labels: false, radiusFactor: 0.5, isolatedAlpha: ISOLATED_ALPHA });
  assert.deepEqual(labelPolicy(1440, 500), { labels: false, radiusFactor: 0.5, isolatedAlpha: ISOLATED_ALPHA });
  assert.equal(labelPolicy(1200, 34, 20).labels, false, 'the threshold follows the root font size');
});

test('parallel agreements fan out symmetrically and never wider than a band', () => {
  assert.equal(parallelOffset(0, 1), 0);
  assert.deepEqual([parallelOffset(0, 2), parallelOffset(1, 2)], [-3.5, 3.5]);
  assert.deepEqual([parallelOffset(0, 3), parallelOffset(1, 3), parallelOffset(2, 3)], [-7, 0, 7]);
  for (const n of [5, 8, 12, 20, 60]) {
    const offsets = Array.from({ length: n }, (_, i) => parallelOffset(i, n));
    assert.ok(Math.abs(offsets[0] + offsets[n - 1]) < 1e-9, `symmetric for ${n}`);
    const band = offsets[n - 1] - offsets[0];
    const spacing = offsets[1] - offsets[0];
    assert.ok(band <= Math.max(BUNDLE_MAX_BAND, BUNDLE_MIN_SPACING * (n - 1)) + 1e-9, `the band is bounded for ${n}`);
    assert.ok(spacing >= BUNDLE_MIN_SPACING - 1e-9 && spacing <= BUNDLE_SPACING + 1e-9, `lines stay apart but no wider than a small bundle for ${n}`);
  }
  assert.equal(parallelOffset(5, 6) - parallelOffset(4, 6), BUNDLE_SPACING, 'six lines still get the full spacing');
  assert.equal(parallelOffset(19, 20) - parallelOffset(18, 20), BUNDLE_MIN_SPACING, 'twenty close up to the minimum');
});

test('the screen-reader summary reads as a sentence', () => {
  assert.equal(summaryText({ agents: 34, open: 36, disputed: 2, settled: 40 }), '34 agents, 36 open agreements, 2 disputed, 40 recently settled');
  assert.equal(summaryText({ agents: 1, open: 1, disputed: 0, settled: 0 }), '1 agent, 1 open agreement, 0 disputed, 0 recently settled');
});

test('a new point lands at a stable angle for its address', () => {
  assert.equal(seedAngle(A), seedAngle(A));
  assert.notEqual(seedAngle(A), seedAngle(B));
  for (const address of [A, B, C, D]) {
    assert.ok(seedAngle(address) >= 0 && seedAngle(address) < Math.PI * 2);
  }
});

test('bundleLayout draws at most the cap per state, disputes first, and labels the rest with a count', () => {
  const lines = [
    ...Array.from({ length: 9 }, (_, i) => ({ key: `s${i}`, state: 'settled', block: 100 - i })),
    { key: 'o1', state: 'open', block: 200 },
    { key: 'd1', state: 'disputed', block: 300 },
  ];
  const { drawn, hidden, labels } = bundleLayout(lines);
  assert.equal(drawn.length, 1 + 1 + BUNDLE_CAP);
  assert.equal(hidden.length, 9 - BUNDLE_CAP);
  assert.equal(drawn[0].key, 'd1', 'the dispute is never the one hidden');
  assert.equal(drawn[1].key, 'o1');
  assert.deepEqual(drawn.slice(2).map((l) => l.block), [92, 93, 94, 95, 96, 97], 'oldest settled first');
  assert.deepEqual(labels, [{ state: 'settled', count: 9, text: '×9 settled' }]);
  assert.deepEqual(bundleLayout([{ key: 'o1', state: 'open', block: 1 }]).labels, [], 'no label under the cap');
});

test('forceScale shrinks the layout for a phone plate and never below 0.4', () => {
  assert.equal(forceScale(952, 595), 1);
  assert.ok(forceScale(358, 268) < 0.5 && forceScale(358, 268) >= 0.4);
  assert.equal(forceScale(10, 10), 0.4);
});
