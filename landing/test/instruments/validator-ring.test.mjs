// Unit tests for the validator ring's pure helpers: point placement on the
// ring, chords, the authority-index → stash mapping, the finality-vote
// sampler, queued-vs-active diffing and the phrases the list carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIZE,
  CENTRE,
  RADIUS,
  VOTES_R,
  MIN_SAMPLES,
  ALL_CHORDS_UP_TO,
  pointAt,
  ringPositions,
  chordPairs,
  labelAnchor,
  votesArcPath,
  buildSet,
  stashForAuthority,
  VoteSampler,
  sealedPhrase,
  votesPhrase,
  ariaSummary,
} from '../../src/observatory/instruments/validator-ring.js';
import { decodeValidators, decodeQueuedKeys, decodeBabeAuthorities, bytesToHex } from '../../src/observatory/scale.js';
import { encodeSs58 } from '../../src/observatory/ss58.js';
import { formatInteger } from '../../src/observatory/format.js';

// The live storage values on 2026-09-29 (five validators, all with queued keys).
const VALIDATORS_HEX =
  '0x141e07379407fecc4b89eb7dbd287c2c781cfb1907a96947a3eb18e4f8e71986258ac59e11963af19174d0b94d5d78041c233f55d2e19324665bafdfb62925af2dbe5ddb1579b72e84524fc29e78609e3caf42e85aa118ebfe0b0ad404b5bdd25fe860f1b1c7227f7c22602f53f15af80747814dffd839719731ee3bba6edc126cfe65717dad0447d715f660a0a58411de509b42e6efb8375f562f58a554d5860e';
const QUEUED_HEX =
  '0x141e07379407fecc4b89eb7dbd287c2c781cfb1907a96947a3eb18e4f8e719862590b5ab205c6974c9ea841be688864633dc9ca8a357843eeacf2314649965fe22439660b36c6c03afafca027b910b4fecf99801834c62a5e6006f27d978de234f90b5ab205c6974c9ea841be688864633dc9ca8a357843eeacf2314649965fe228ac59e11963af19174d0b94d5d78041c233f55d2e19324665bafdfb62925af2de659a7a1628cdd93febc04a4e0646ea20e9f5f0ce097d9a05290d4a9e054df4e1dfe3e22cc0d45c70779c1095f7489a8ef3cf52d62fbd8c2fa38c9f1723502b5e659a7a1628cdd93febc04a4e0646ea20e9f5f0ce097d9a05290d4a9e054df4ebe5ddb1579b72e84524fc29e78609e3caf42e85aa118ebfe0b0ad404b5bdd25fd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d88dc3417d5058ec4b4503e0c12ea1a0a89be200fe98922423d4334014fa6b0eed43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27de860f1b1c7227f7c22602f53f15af80747814dffd839719731ee3bba6edc126c306721211d5404bd9da88e0204360a1a9ab8b87c66c1bc2fcdd37f3c2222cc205e639b43e0052c47447dac87d6fd2b6ec50bdd4d0f614e4299c665249bbd09d9306721211d5404bd9da88e0204360a1a9ab8b87c66c1bc2fcdd37f3c2222cc20fe65717dad0447d715f660a0a58411de509b42e6efb8375f562f58a554d5860e8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48d17c2d7823ebf260fd138f2d7e27d114c0145d968b5ff5006125f2414fadae698eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48';
const BABE_HEX =
  '0x1490b5ab205c6974c9ea841be688864633dc9ca8a357843eeacf2314649965fe220100000000000000e659a7a1628cdd93febc04a4e0646ea20e9f5f0ce097d9a05290d4a9e054df4e0100000000000000d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d0100000000000000306721211d5404bd9da88e0204360a1a9ab8b87c66c1bc2fcdd37f3c2222cc2001000000000000008eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a480100000000000000';

// grandpa_roundState.best.precommits.missing on the same day: the SS58 of the grandpa keys.
const MISSING_ALL = [
  '5Ck2miBfCe1JQ4cY3NDsXyBaD6EcsgiVmEFTWwqNSs25XDEq',
  '5DbKjhNLpqX3zqZdNBc9BGb4fHU1cRBaDhJUskrvkwfraDi6',
  '5ECTwv6cZ5nJQPk6tWfaTrEk8YH2L7X1VT4EL5Tx2ikfFwb7',
  '5FA9nQDVg267DEd8m1ZypXLBnvN7SFxYwV7ndqSYGiN9TTpu',
  '5GoNkf6WdbxCFnPdAnYYQyCjAKPJgLNxXwPjwTh6DGg6gN3E',
];

const validators = decodeValidators(VALIDATORS_HEX);
const queued = decodeQueuedKeys(QUEUED_HEX);
const babe = decodeBabeAuthorities(BABE_HEX);

test('positions: evenly spaced from twelve o’clock, clockwise, on the track', () => {
  assert.equal(SIZE, 320);
  const five = ringPositions(5);
  assert.equal(five.length, 5);
  assert.equal(five[0].x, CENTRE);
  assert.equal(five[0].y, CENTRE - RADIUS);
  // The second point is to the right of and below the first (clockwise).
  assert.ok(five[1].x > five[0].x && five[1].y > five[0].y);
  // The last point mirrors the second across the vertical axis.
  assert.ok(Math.abs(five[4].x - (2 * CENTRE - five[1].x)) < 1e-6);
  assert.ok(Math.abs(five[4].y - five[1].y) < 1e-6);
  for (const p of five) assert.ok(Math.abs(Math.hypot(p.x - CENTRE, p.y - CENTRE) - RADIUS) < 0.01);
  // Four points: twelve, three, six, nine o'clock.
  const four = ringPositions(4);
  assert.equal(four[1].x, CENTRE + RADIUS);
  assert.equal(four[2].y, CENTRE + RADIUS);
  assert.equal(four[3].x, CENTRE - RADIUS);
  assert.deepEqual(ringPositions(0), []);
  const one = ringPositions(1);
  assert.equal(one[0].y, CENTRE - RADIUS);
});

test('pointAt agrees with the positions and rounds to a thousandth', () => {
  const p = pointAt(0, 10, 0, 0);
  assert.deepEqual(p, { x: 10, y: 0 });
  assert.equal(pointAt(Math.PI / 2, 10, 0, 0).y, 10);
});

test('chords: every pair up to twelve validators, neighbours only above', () => {
  assert.equal(ALL_CHORDS_UP_TO, 12);
  assert.deepEqual(chordPairs(0), []);
  assert.deepEqual(chordPairs(1), []);
  assert.deepEqual(chordPairs(2), [[0, 1]]);
  assert.equal(chordPairs(5).length, 10);
  assert.equal(chordPairs(12).length, 66);
  const ring = chordPairs(13);
  assert.equal(ring.length, 13);
  assert.deepEqual(ring[12], [12, 0]);
  assert.equal(chordPairs(40).length, 40);
});

test('labels anchor away from the ring: start on the right, end on the left, middle at top and bottom', () => {
  assert.equal(labelAnchor(-Math.PI / 2), 'middle');
  assert.equal(labelAnchor(Math.PI / 2), 'middle');
  assert.equal(labelAnchor(0), 'start');
  assert.equal(labelAnchor(Math.PI), 'end');
  const five = ringPositions(5);
  assert.deepEqual(five.map((p) => labelAnchor(p.angle)), ['middle', 'start', 'start', 'end', 'end']);
});

test('the vote arc: empty at zero, one arc below half, large-arc above, two half-arcs when every round was seen', () => {
  assert.equal(votesArcPath(0, 100, 100), '');
  assert.equal(votesArcPath(NaN, 100, 100), '');
  const quarter = votesArcPath(0.25, 100, 100);
  assert.match(quarter, new RegExp(`^M 100 ${100 - VOTES_R} A ${VOTES_R} ${VOTES_R} 0 0 1 ${100 + VOTES_R} 100$`));
  assert.match(votesArcPath(0.75, 100, 100), /A 13 13 0 1 1 /);
  const full = votesArcPath(1, 100, 100);
  assert.equal((full.match(/ A /g) ?? []).length, 2);
  assert.equal(votesArcPath(2, 100, 100), full);
});

test('buildSet decodes the live set: five active, none queued, keys mapped by stash', () => {
  const set = buildSet({ validators, queued, babe });
  assert.equal(set.active.length, 5);
  assert.equal(set.queued.length, 0);
  assert.deepEqual(
    set.active.map((v) => v.address),
    [
      '5Ck5SLSHYac6WFt5UZRSsdJjwmpSZq85fd5TRNAdZQVzEAPT',
      '5FCfAonRZgTFrTd9HREEyeJjDpT397KMzizE6T3DvebLFE7n',
      '5GNJqTPyNqANBkUVMN1LPPrxXnFouWXoe2wNSmmEoLctxiZY',
      '5HKPmK9GYtE1PSLsS1qiYU9xQ9Si1NcEhdeCq9sw5bqu4ns8',
      '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc',
    ],
  );
  assert.deepEqual(set.active.map((v) => v.index), [0, 1, 2, 3, 4]);
  // Every grandpa address the node names as missing belongs to one of the five.
  const grandpa = new Set(set.active.map((v) => v.grandpaAddress));
  for (const id of MISSING_ALL) assert.ok(grandpa.has(id), `${id} is not a validator's grandpa key`);
  // The BABE authority list, in order, maps to the stashes in Session.Validators order today.
  assert.deepEqual(set.authorities, set.active.map((v) => v.stashHex));
});

test('authority index → stash: through Babe.Authorities and the queued babe key', () => {
  const set = buildSet({ validators, queued, babe });
  assert.equal(stashForAuthority(0, set.authorities), bytesToHex(validators[0]));
  assert.equal(stashForAuthority(4, set.authorities), bytesToHex(validators[4]));
  assert.equal(stashForAuthority(5, set.authorities), null);
  assert.equal(stashForAuthority(-1, set.authorities), null);
  assert.equal(stashForAuthority(1.5, set.authorities), null);
  assert.equal(stashForAuthority(undefined, set.authorities), null);
  // A babe key the queued keys do not name cannot be attributed.
  const stranger = { key: new Uint8Array(32).fill(9), weight: 1 };
  const shifted = buildSet({ validators, queued, babe: [stranger, ...babe] });
  assert.equal(stashForAuthority(0, shifted.authorities), null);
  assert.equal(stashForAuthority(1, shifted.authorities), bytesToHex(validators[0]));
});

test('without queued keys or authorities the set is still drawn, and nothing is attributed', () => {
  const set = buildSet({ validators });
  assert.equal(set.active.length, 5);
  assert.deepEqual(set.authorities, []);
  assert.equal(set.active[0].grandpaAddress, null);
  assert.equal(set.active[0].babeHex, null);
  assert.equal(stashForAuthority(0, set.authorities), null);
  const withBabe = buildSet({ validators, babe });
  assert.deepEqual(withBabe.authorities, [null, null, null, null, null]);
});

test('queued-vs-active: a stash in QueuedKeys but not in Session.Validators is drawn at the next position as queued', () => {
  const joiner = {
    stash: new Uint8Array(32).fill(0xaa),
    babe: new Uint8Array(32).fill(0xbb),
    grandpa: new Uint8Array(32).fill(0xcc),
    authorityDiscovery: new Uint8Array(32).fill(0xdd),
  };
  const set = buildSet({ validators, queued: [...queued, joiner], babe });
  assert.equal(set.active.length, 5);
  assert.equal(set.queued.length, 1);
  const q = set.queued[0];
  assert.equal(q.index, 5);
  assert.equal(q.queued, true);
  assert.equal(q.address, encodeSs58(joiner.stash, 42));
  assert.equal(q.grandpaAddress, encodeSs58(joiner.grandpa, 42));
  // Once it is in Session.Validators it is active, not queued.
  const next = buildSet({ validators: [...validators, joiner.stash], queued: [...queued, joiner], babe });
  assert.equal(next.active.length, 6);
  assert.equal(next.queued.length, 0);
  // A validator that left the queue but is still active keeps its point, with no keys to attribute.
  const leaving = buildSet({ validators, queued: queued.slice(1), babe });
  assert.equal(leaving.active.length, 5);
  assert.equal(leaving.active[0].grandpaAddress, null);
  assert.equal(leaving.queued.length, 0);
  // The same queued stash twice is one point.
  const twice = buildSet({ validators, queued: [...queued, joiner, joiner], babe });
  assert.equal(twice.queued.length, 1);
});

test('the vote sampler counts a round once, and a validator as seen if any sample of that round found it present', () => {
  const set = buildSet({ validators, queued, babe });
  const ids = set.active.map((v) => v.grandpaAddress);
  const s = new VoteSampler();
  assert.equal(s.roundsSampled(), 0);
  assert.deepEqual(s.countsFor(ids[0]), { seen: 0, sampled: 0 });
  const none = { prevotes: [], precommits: [] };
  // Round 360 sampled at its start: no vote of either kind has arrived.
  s.add(360, { prevotes: MISSING_ALL, precommits: MISSING_ALL }, ids);
  assert.equal(s.roundsSampled(), 1);
  assert.deepEqual(s.countsFor(ids[0]), { seen: 0, sampled: 1 });
  // The same round sampled again: three prevotes are in, no precommit yet. Still one round.
  s.add(360, { prevotes: MISSING_ALL.slice(3), precommits: MISSING_ALL }, ids);
  assert.equal(s.roundsSampled(), 1);
  const seen = ids.map((id) => s.countsFor(id).seen);
  assert.equal(seen.filter((n) => n === 1).length, 3);
  assert.equal(seen.filter((n) => n === 0).length, 2);
  // A later sample of the same round cannot un-see a vote.
  s.add(360, { prevotes: MISSING_ALL, precommits: MISSING_ALL }, ids);
  assert.deepEqual(ids.map((id) => s.countsFor(id).seen), seen);
  // A precommit alone also counts as seen.
  s.add(360, { prevotes: MISSING_ALL, precommits: MISSING_ALL.slice(0, 4) }, ids);
  assert.equal(ids.map((id) => s.countsFor(id).seen).filter((n) => n === 1).length, 4);
  // Round 361 with everyone present.
  s.add(361, none, ids);
  assert.equal(s.roundsSampled(), 2);
  for (const id of ids) assert.equal(s.countsFor(id).sampled, 2);
  assert.equal(s.countsFor(ids[0]).seen, 2);
  // A validator not in the set at the time of a sample is not counted for that round.
  s.add(362, none, ids.slice(0, 2));
  assert.deepEqual(s.countsFor(ids[0]), { seen: 3, sampled: 3 });
  assert.equal(s.countsFor(ids[4]).sampled, 2);
  // A validator without a known grandpa key is skipped, not counted.
  s.add(363, none, [null, ids[0]]);
  assert.equal(s.countsFor(ids[0]).sampled, 4);
  assert.equal(s.roundsSampled(), 4);
  // A sample with no known grandpa key at all is nobody's round, so it is not counted as sampled.
  s.add(365, none, [null, null]);
  assert.equal(s.roundsSampled(), 4);
  // A malformed sample is refused rather than counted as a round.
  assert.throws(() => s.add('360', none, ids), /round/);
  assert.throws(() => s.add(364, { prevotes: null, precommits: [] }, ids), /missing/);
  assert.throws(() => s.add(364, { prevotes: [], precommits: undefined }, ids), /missing/);
  assert.equal(s.roundsSampled(), 4);
  assert.equal(MIN_SAMPLES, 3);
});

test('the phrases say "since you opened this page" and never a percentage', () => {
  assert.equal(sealedPhrase(undefined, formatInteger), 'no block sealed since you opened this page');
  assert.equal(sealedPhrase({ count: 0, last: null }, formatInteger), 'no block sealed since you opened this page');
  assert.equal(sealedPhrase({ count: 1, last: 820715 }, formatInteger), 'sealed 1 block since you opened this page · last #820,715');
  assert.equal(sealedPhrase({ count: 12, last: 820800 }, formatInteger), 'sealed 12 blocks since you opened this page · last #820,800');
  assert.equal(votesPhrase({ seen: 0, sampled: 0 }, formatInteger), 'no GRANDPA round sampled yet');
  assert.equal(votesPhrase({ seen: 1, sampled: 1 }, formatInteger), 'GRANDPA votes seen in 1 of 1 round sampled since you opened this page');
  const phrase = votesPhrase({ seen: 4, sampled: 5 }, formatInteger);
  assert.equal(phrase, 'GRANDPA votes seen in 4 of 5 rounds sampled since you opened this page');
  assert.ok(!phrase.includes('%'));
});

test('the aria summary names the set, the last author and anyone joining', () => {
  assert.equal(ariaSummary({ active: 5, queued: 0, lastAuthor: null }), '5 validators in the active set');
  assert.equal(
    ariaSummary({ active: 5, queued: 0, lastAuthor: 3 }),
    '5 validators in the active set; validator 3 sealed the latest block',
  );
  assert.equal(
    ariaSummary({ active: 5, queued: 1, lastAuthor: 3 }),
    '5 validators in the active set; validator 3 sealed the latest block; 1 joining next session',
  );
  assert.equal(ariaSummary({ active: 1, queued: 0, lastAuthor: null }), '1 validator in the active set');
});
