// Unit tests for the observatory's pure modules: SCALE decoding, SS58 and
// blake2b, formatting, and the chain-pulse stream model.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hexToBytes,
  bytesToHex,
  readCompact,
  decodeCompactLength,
  decodeFixedVec,
  decodeValidators,
  decodeBabeAuthorities,
  decodeQueuedKeys,
  decodeBabePreDigest,
  babePreDigestOf,
} from '../src/observatory/scale.js';
import { blake2b, base58Encode, encodeSs58 } from '../src/observatory/ss58.js';
import {
  formatInteger,
  relativeTime,
  formatDuration,
  shortAddress,
  shortHash,
  formatCmn,
  cmnNumber,
} from '../src/observatory/format.js';
import { field, countSince, pageOf, fetchAllPages, Scheduler, SOURCES } from '../src/observatory/data.js';
import { Stream, cadenceOf, median } from '../src/observatory/instruments/pulse.js';
import { stateWord, sealingPhrase, SEALING_WINDOW, FINALITY_LAG_ALERT } from '../src/observatory/statusbar.js';

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

test('compact integers in all four modes', () => {
  assert.deepEqual(readCompact(hexToBytes('0x00')), { value: 0, next: 1 });
  assert.deepEqual(readCompact(hexToBytes('0x14')), { value: 5, next: 1 });
  assert.deepEqual(readCompact(hexToBytes('0x0101')), { value: 64, next: 2 });
  assert.deepEqual(readCompact(hexToBytes('0xb501')), { value: 109, next: 2 });
  assert.deepEqual(readCompact(hexToBytes('0x02000100')), { value: 16384, next: 4 });
  assert.deepEqual(readCompact(hexToBytes('0x0300000040')), { value: 1 << 30, next: 5 });
  assert.equal(decodeCompactLength('0x14aabb'), 5);
  assert.throws(() => decodeCompactLength('0x'), /empty/);
  assert.throws(() => decodeCompactLength(null), /hex/);
  assert.throws(() => readCompact(hexToBytes('0x01')), /truncated/);
});

test('fixed-entry vectors refuse a length that does not fit', () => {
  const five = `0x14${'ab'.repeat(32 * 5)}`;
  assert.equal(decodeValidators(five).length, 5);
  assert.equal(decodeValidators(five)[4].length, 32);
  assert.throws(() => decodeFixedVec(`0x14${'ab'.repeat(32 * 5 - 1)}`, 32), /expected 161/);
  assert.throws(() => decodeFixedVec(`0x14${'ab'.repeat(32 * 5 + 1)}`, 32), /bytes/);
});

test('Babe.Authorities and Session.QueuedKeys layouts', () => {
  const key = (n) => n.toString(16).padStart(2, '0').repeat(32);
  const authorities = `0x08${key(1)}0100000000000000${key(2)}0200000000000000`;
  const decoded = decodeBabeAuthorities(authorities);
  assert.equal(decoded.length, 2);
  assert.equal(hex(decoded[0].key), key(1));
  assert.equal(decoded[1].weight, 2);
  const queued = `0x04${key(9)}${key(1)}${key(2)}${key(3)}`;
  const [entry] = decodeQueuedKeys(queued);
  assert.equal(hex(entry.stash), key(9));
  assert.equal(hex(entry.babe), key(1));
  assert.equal(hex(entry.grandpa), key(2));
  assert.equal(hex(entry.authorityDiscovery), key(3));
});

test('BABE pre-digest: as seen on the live chain', () => {
  // Secondary plain, authority 1, from a real header on rpc.scalarnet.io.
  const secondary = decodeBabePreDigest('0x0642414245340201000000c0fcc91100000000');
  assert.deepEqual(secondary, { kind: 'secondary-plain', authorityIndex: 1, slot: 0x11c9fcc0 });
  // Primary (109-byte payload, two-byte compact prefix 0xb501), authority 0.
  const primary = decodeBabePreDigest(`0x0642414245b5010100000000c1fcc91100000000${'00'.repeat(96)}`);
  assert.equal(primary.kind, 'primary');
  assert.equal(primary.authorityIndex, 0);
  assert.equal(decodeBabePreDigest('0x05424142450101bcee'), null); // a seal, not a pre-runtime digest
  assert.throws(() => decodeBabePreDigest('0x0642414245340901000000c0fcc91100000000'), /variant/);
  assert.equal(babePreDigestOf({ digest: { logs: ['0x05424142450101bc', '0x0642414245340201000000c0fcc91100000000'] } }).authorityIndex, 1);
  assert.equal(babePreDigestOf({ digest: { logs: [] } }), null);
  assert.equal(bytesToHex(hexToBytes('0x00ff10')), '0x00ff10');
});

test('blake2b-512 matches the reference vector for "abc"', () => {
  const digest = blake2b(new TextEncoder().encode('abc'), 64);
  assert.equal(
    hex(digest),
    'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
  );
  // And for the empty message.
  assert.equal(
    hex(blake2b(new Uint8Array(0), 64)).slice(0, 32),
    '786a02f742015903c6c6fd852552d272',
  );
});

test('SS58 encoding reproduces well-known addresses', () => {
  // Alice on the generic (42) network.
  const alice = hexToBytes('0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d');
  assert.equal(encodeSs58(alice, 42), '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
  assert.equal(base58Encode(new Uint8Array([0, 0, 1])), '112');
  assert.throws(() => encodeSs58(new Uint8Array(31)), /32-byte/);
});

test('formatting helpers', () => {
  assert.equal(formatInteger(819086), '819,086');
  const now = Date.parse('2026-09-29T14:00:00Z');
  assert.equal(relativeTime(now - 30_000, now), 'less than a minute ago');
  assert.equal(relativeTime(now - 5 * 3600_000, now), '5 hours ago');
  assert.equal(relativeTime(now - 72 * 3600_000, now), '3 days ago');
  assert.equal(formatDuration(40), 'about 40 s');
  assert.equal(formatDuration(6120), 'about 1 h 42 min');
  assert.equal(formatDuration(3600), 'about 1 h');
  assert.equal(formatDuration(90), 'about 2 min');
  assert.equal(shortAddress('5Ck2miBfCe1JQ4cY3NDsXyBaD6EcsgiVmEFTWwqNSs25XDEq'), '5Ck2…XDEq');
  assert.equal(shortHash('9b67d2f14ce062442f6d6abe158fa2bf95d47b9ac7b45e2901f3e065ae60ed2a'), '9b67d2f1…ae60ed2a');
  assert.equal(formatCmn('1000000000000000'), '1,000');
  assert.equal(formatCmn('1999999999999999'), '1,999');
  assert.equal(cmnNumber('1500000000000'), 1.5);
});

test('field() refuses to guess; countSince and pageOf', () => {
  assert.equal(field({ chain: { bestBlock: 7 } }, 'chain.bestBlock'), 7);
  assert.equal(field({ items: [{ blockNumber: 3 }] }, 'items.0.blockNumber'), 3);
  assert.throws(() => field({ chain: {} }, 'chain.bestBlock'), /chain\.bestBlock/);
  assert.throws(() => field(null, 'chain'), /chain/);
  assert.deepEqual(countSince([{ blockNumber: 30 }, { blockNumber: 20 }, { blockNumber: 10 }], 20), {
    count: 2,
    reachedStart: true,
  });
  assert.equal(pageOf(SOURCES.slashes, 200), `${SOURCES.slashes.path}&offset=200`);
});

test('fetchAllPages walks a list and says whether it got everything', async () => {
  const pages = [
    { ok: true, data: { total: 5, items: [1, 2] } },
    { ok: true, data: { total: 5, items: [3, 4] } },
    { ok: true, data: { total: 5, items: [5] } },
  ];
  let calls = 0;
  const fetcher = async () => pages[calls++];
  const all = await fetchAllPages({ kind: 'api', path: '/x?limit=2' }, { fetcher, maxPages: 5 });
  assert.deepEqual(all.items, [1, 2, 3, 4, 5]);
  assert.equal(all.complete, true);
  calls = 0;
  const capped = await fetchAllPages({ kind: 'api', path: '/x?limit=2' }, { fetcher, maxPages: 2 });
  assert.deepEqual(capped.items, [1, 2, 3, 4]);
  assert.equal(capped.complete, false);
  calls = 0;
  const failing = await fetchAllPages(
    { kind: 'api', path: '/x' },
    { fetcher: async () => ({ ok: false, error: 'HTTP 502' }) },
  );
  assert.equal(failing.ok, false);
  assert.equal(failing.complete, false);
});

test('Scheduler fetches a shared source once per interval and pauses', async () => {
  let fetches = 0;
  const scheduler = new Scheduler(async () => ({ ok: true, n: ++fetches }));
  const seen = [];
  const stopA = scheduler.watch('s', { kind: 'api' }, (r) => seen.push(['a', r.n]), 50);
  const stopB = scheduler.watch('s', { kind: 'api' }, (r) => seen.push(['b', r.n]), 1000);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, [['a', 1], ['b', 1]]);
  scheduler.pause();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fetches, 1, 'no fetch while paused');
  scheduler.resume();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fetches, 2);
  stopA();
  stopB();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fetches, 2, 'no fetch after every watcher left');
});

test('Stream: seeding, arrival, forks and finality', () => {
  const s = new Stream();
  s.seed({ number: 10, id: '10:a', at: 1_000 });
  s.seed({ number: 11, id: '11:a', at: 7_000 });
  s.seed({ number: 12, id: '12:a', at: 13_000 });
  assert.equal(s.best, 12);
  assert.deepEqual(s.head({ number: 13, id: '13:a', at: 19_000 }), { added: true, advanced: true, superseded: 0 });
  // A competing head at the same height supersedes the earlier one.
  assert.deepEqual(s.head({ number: 13, id: '13:b', at: 19_500 }), { added: true, advanced: false, superseded: 1 });
  assert.deepEqual(
    s.chain().map((b) => b.id),
    ['13:b', '12:a', '11:a', '10:a'],
  );
  assert.equal(s.blocks.filter((b) => b.superseded).length, 1);
  // A head below the best means a re-org: everything above it is superseded.
  s.head({ number: 12, id: '12:z', at: 20_000 });
  assert.equal(s.best, 12);
  assert.deepEqual(s.chain()[0].id, '12:z');
  assert.equal(s.lag(), null);
  assert.deepEqual(s.finalize(11, 21_000), { advanced: true });
  assert.equal(s.lag(), 1);
  assert.deepEqual(s.finalize(11, 22_000), { advanced: false });
  const cadence = cadenceOf(s.blocks);
  // Three surviving blocks (10, 11, 12:z) span 1 000 → 20 000 ms: two intervals.
  assert.ok(Math.abs(cadence.perMinute - 60_000 / ((20_000 - 1_000) / 2)) < 1e-9);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(cadenceOf([]), null);
});

test('the status bar’s state word follows stated rules, worst first', () => {
  const normal = { socket: 'live', lastOk: true, seen: true, lag: 2, intervalMs: 6_000, hidden: false };
  assert.equal(stateWord(normal), 'Network normal');
  assert.equal(stateWord({ ...normal, hidden: true }), 'Paused');
  assert.equal(stateWord({ ...normal, seen: false }), 'Connecting');
  assert.equal(stateWord({ ...normal, lastOk: false }), 'Not updating');
  assert.equal(stateWord({ ...normal, lag: FINALITY_LAG_ALERT + 1 }), 'Finality lagging');
  assert.equal(stateWord({ ...normal, lag: FINALITY_LAG_ALERT }), 'Network normal');
  assert.equal(stateWord({ ...normal, intervalMs: 19_000 }), 'Blocks late');
  assert.equal(stateWord({ ...normal, socket: 'polling' }), 'Polling');
  assert.equal(stateWord({ ...normal, lag: null, intervalMs: null }), 'Network normal', 'unknowns are not faults');
});

test('the sealing phrase says "seen so far" until the window has filled, and never invents a count', () => {
  assert.equal(sealingPhrase({ authors: 5, total: 5, observed: SEALING_WINDOW }), '5 of 5 validators sealing');
  assert.equal(sealingPhrase({ authors: 5, total: 5, observed: 6 }), '5 of 5 validators sealing', 'all seen: no hedge needed');
  assert.equal(sealingPhrase({ authors: 3, total: 5, observed: 6 }), '3 of 5 validators seen sealing so far');
  assert.equal(sealingPhrase({ authors: 4, total: 5, observed: SEALING_WINDOW }), '4 of 5 validators sealing');
  assert.equal(sealingPhrase({ authors: null, total: 5, observed: 0 }), '5 validators in the set', 'polling: no author to count');
  assert.equal(sealingPhrase({ authors: 2, total: null, observed: 10 }), 'validators not yet read');
});
