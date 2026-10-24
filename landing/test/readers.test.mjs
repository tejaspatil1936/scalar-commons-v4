// Unit tests for the observatory's data readers that /network and the
// oversight page still use: SCALE decoding, SS58 and blake2b, formatting,
// and the indexer/RPC record helpers (src/observatory/{scale,ss58,format,data}.js).
import { test, mock } from 'node:test';
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
  assert.equal(pageOf(SOURCES.registrations, 200), `${SOURCES.registrations.path}&offset=200`);
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

test('fetchAllPages reads a newest-first event list only back to a block, and says when the cap stopped it first', async () => {
  const ev = (blockNumber) => ({ blockNumber });
  const pages = [
    { ok: true, data: { total: 9, items: [ev(120), ev(110), ev(105)] } },
    { ok: true, data: { total: 9, items: [ev(101), ev(99), ev(90)] } },
    { ok: true, data: { total: 9, items: [ev(80), ev(70), ev(60)] } },
  ];
  let calls = 0;
  const fetcher = async () => pages[calls++];
  const source = (since) => ({ kind: 'api', path: '/x?limit=3', stopBelow: () => since });
  // The second page reaches below block 100: no third page is read.
  const hour = await fetchAllPages(source(100), { fetcher, maxPages: 10 });
  assert.equal(calls, 2);
  assert.equal(hour.since, 100);
  assert.equal(hour.reachedStart, true);
  assert.deepEqual(countSince(hour.items, hour.since), { count: 4, reachedStart: true });
  // The cap stops the read before the start: the count is a floor.
  calls = 0;
  const capped = await fetchAllPages(source(50), { fetcher, maxPages: 2 });
  assert.equal(capped.reachedStart, false);
  // The list ends before the start: everything since it is in hand.
  calls = 0;
  const whole = await fetchAllPages(source(10), { fetcher, maxPages: 10 });
  assert.equal(whole.complete, true);
  assert.equal(whole.reachedStart, true);
  // A failure carries no start reached, and no source without `stopBelow` gets the fields.
  const failing = await fetchAllPages(source(100), { fetcher: async () => ({ ok: false, error: 'HTTP 502' }) });
  assert.equal(failing.reachedStart, false);
  calls = 0;
  assert.equal('reachedStart' in (await fetchAllPages({ kind: 'api', path: '/x?limit=3' }, { fetcher, maxPages: 1 })), false);
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

