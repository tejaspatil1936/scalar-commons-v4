// Unit tests for the observatory's pure modules: SCALE decoding, SS58 and
// blake2b, formatting, and the chain-pulse stream model.
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
import {
  Stream,
  cadenceOf,
  median,
  timestampOf,
  barHeight,
  trailAlpha,
  riverLayout,
  riverSentence,
  polledNote,
  TRAIL,
} from '../src/observatory/instruments/pulse.js';
import { stateWord, sealingPhrase, init as initStatusBar, SEALING_WINDOW, FINALITY_LAG_ALERT, LATE_MS } from '../src/observatory/statusbar.js';
import { wantsPresenter, stepFor } from '../src/observatory/presenter.js';
import { railPositions } from '../src/observatory.mjs';
import {
  wantsSky,
  hashAddress,
  placeOf,
  activityOf,
  starOf,
  validatorStar,
  starsFor,
  recentSettlements,
  linesFor,
  markerX,
  settleGlow,
  fpsTooLow,
  frameStats,
  parseColor,
  fallbackReason,
  skyExtra,
  init as initSky,
  MAX_STARS,
  SETTLE_FADE_MS,
  SLOT_MS,
  HEARTBEAT_RECENT_BLOCKS,
} from '../src/observatory/sky.js';

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
  s.seed({ number: 10, id: '10:a', at: 1_000, count: 1 });
  s.seed({ number: 11, id: '11:a', at: 7_000, count: 3 });
  s.seed({ number: 12, id: '12:a', at: 13_000, count: 1 });
  assert.equal(s.best, 12);
  assert.deepEqual(s.head({ number: 13, id: '13:a', arrivedAt: 19_000 }), { added: true, advanced: true, superseded: 0 });
  // A live head is placed at its arrival less the learned offset (none yet), with its count unknown.
  const live = s.blocks.find((b) => b.id === '13:a');
  assert.equal(live.at, 19_000);
  assert.equal(live.count, null);
  assert.equal(live.settle, 0);
  // A competing head at the same height supersedes the earlier one.
  assert.deepEqual(s.head({ number: 13, id: '13:b', arrivedAt: 19_500 }), { added: true, advanced: false, superseded: 1 });
  assert.deepEqual(
    s.chain().map((b) => b.id),
    ['13:b', '12:a', '11:a', '10:a'],
  );
  assert.equal(s.blocks.filter((b) => b.superseded).length, 1);
  // A head below the best means a re-org: everything above it is superseded.
  s.head({ number: 12, id: '12:z', arrivedAt: 20_000 });
  assert.equal(s.best, 12);
  assert.deepEqual(s.chain()[0].id, '12:z');
  assert.equal(s.lag(), null);
  const fin = s.finalize(11, 21_000);
  assert.equal(fin.advanced, true);
  assert.deepEqual(
    fin.settled.map((b) => b.id),
    ['10:a', '11:a'],
    'the blocks that just became final are returned so the view can settle them',
  );
  assert.equal(s.lag(), 1);
  assert.deepEqual(s.finalize(11, 22_000), { advanced: false, settled: [] });
  const cadence = cadenceOf(s.blocks);
  // Three surviving blocks (10, 11, 12:z) span 1 000 → 20 000 ms: two intervals.
  assert.ok(Math.abs(cadence.perMinute - 60_000 / ((20_000 - 1_000) / 2)) < 1e-9);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(cadenceOf([]), null);
});

test('Stream: a block body sets the count and the chain time, and the arrival offset is learned from it', () => {
  const s = new Stream();
  s.head({ number: 20, id: '20:a', arrivedAt: 101_200 });
  assert.equal(s.body(20, '20:a', { count: 2, at: 100_000 }), true);
  const block = s.blocks[0];
  assert.equal(block.count, 2);
  assert.equal(block.at, 100_000, 'the chain clock replaces the arrival estimate');
  assert.equal(s.offset(), 1_200);
  // The next arrival is estimated with that offset until its own body is read.
  s.head({ number: 21, id: '21:a', arrivedAt: 107_300 });
  assert.equal(s.blocks[1].at, 106_100);
  assert.equal(s.body(99, '99:a', { count: 1, at: 1 }), false, 'a body for a block not in the model is ignored');
  // Finality measures the wall-clock arrival, not the chain time.
  const fin = s.finalize(21, 110_000);
  assert.deepEqual(s.finalitySamples, [110_000 - 101_200, 110_000 - 107_300]);
  assert.equal(fin.settled.length, 2);
});

/** SCALE compact encoding, for building test vectors. */
function compact(n) {
  if (n < 64) return [n << 2];
  if (n < 2 ** 14) return [((n << 2) | 1) & 0xff, n >> 6];
  if (n < 2 ** 30) return [((n << 2) | 2) & 0xff, (n >> 6) & 0xff, (n >> 14) & 0xff, (n >> 22) & 0xff];
  const bytes = [];
  let v = BigInt(n);
  while (v > 0n) {
    bytes.push(Number(v & 0xffn));
    v >>= 8n;
  }
  return [((bytes.length - 4) << 2) | 3, ...bytes];
}
const toHex = (bytes) => `0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;

test('the timestamp inherent decodes from the first extrinsic, and nothing else passes for it', () => {
  const moment = 1_790_718_348_000; // 2026-09-29, as on the live chain
  const call = [0x04, 0x01, 0x00, ...compact(moment)];
  assert.equal(timestampOf(toHex([...compact(call.length), ...call])), moment);
  // A signed extrinsic (high bit of the version byte) is not the inherent.
  const signed = [0x84, 0x01, 0x00, ...compact(moment)];
  assert.throws(() => timestampOf(toHex([...compact(signed.length), ...signed])), /signed/);
  // Another pallet's call, or another call of the timestamp pallet, is refused rather than read as a time.
  const other = [0x04, 0x04, 0x00, ...compact(moment)];
  assert.throws(() => timestampOf(toHex([...compact(other.length), ...other])), /not timestamp\.set/);
  const otherCall = [0x04, 0x01, 0x01, ...compact(moment)];
  assert.throws(() => timestampOf(toHex([...compact(otherCall.length), ...otherCall])), /not timestamp\.set/);
  assert.throws(() => timestampOf('0x0c0401'), /too short/);
  assert.throws(() => timestampOf(toHex([...compact(3), 0x04, 0x01, 0x00])), /truncated|empty/);
});

test('bars are as tall as their extrinsic count, never off the plate, and the trail fades left', () => {
  assert.equal(barHeight(1), 0.26);
  assert.equal(barHeight(null), 0.26, 'an unread body stands at the floor');
  assert.equal(barHeight(0), 0.26);
  assert.ok(barHeight(2) > barHeight(1));
  assert.ok(Math.abs(barHeight(3) - barHeight(2) - (barHeight(2) - barHeight(1))) < 1e-12, 'each extrinsic adds one step');
  assert.ok(Math.abs(barHeight(100) - 0.94) < 1e-12, 'capped');
  assert.equal(trailAlpha(0), 1);
  assert.ok(trailAlpha(30) < trailAlpha(10));
  assert.ok(Math.abs(trailAlpha(TRAIL) - 0.16) < 1e-12, 'the oldest bar is faint, never gone');
  assert.equal(trailAlpha(10_000), 0.16);
});

test('the river holds sixty blocks on a wide plate and about two dozen on a phone, labels spaced to fit', () => {
  const wide = riverLayout(1200);
  assert.equal(wide.visible, 60);
  assert.ok(Math.abs(wide.slotPx - (1200 - 26) / 60) < 1e-9);
  assert.ok(wide.bar >= 3 && wide.bar <= 8);
  assert.equal(wide.labelEvery, Math.ceil(84 / wide.slotPx));
  const phone = riverLayout(358);
  assert.ok(phone.visible >= 20 && phone.visible < 25, `phone holds ${phone.visible}`);
  assert.ok(phone.bar >= 3 && phone.bar <= wide.bar, `phone bar ${phone.bar}, wide bar ${wide.bar}`);
  assert.ok(phone.labelEvery >= wide.labelEvery);
  assert.equal(riverLayout(100).visible, 20, 'never fewer than twenty');
});

test('the sentence under the river names the rhythm and the time to finality, hedging an estimate', () => {
  assert.equal(riverSentence({ perMinute: 9.84 }, { seconds: 12.4, measured: true }), '9.8 blocks per minute · finality within 12 seconds');
  assert.equal(riverSentence({ perMinute: 10 }, { seconds: 12, measured: false }), '10.0 blocks per minute · finality within about 12 seconds');
  assert.equal(riverSentence({ perMinute: 10 }, null), '10.0 blocks per minute');
  assert.equal(riverSentence(null, null), '');
});

test('polled heights are named as such: no body was read, so the bar stands at the floor', () => {
  // A height taken from /v1/status while the socket is down has no header and
  // no body: its bar can only stand at the one-extrinsic floor. The sentence's
  // provenance line must say so rather than leave a half-toned bar unexplained.
  const s = new Stream();
  s.seed({ number: 10, id: '10:a', at: 1_000, count: 1 });
  s.head({ number: 11, id: '11:b', arrivedAt: 7_000 });
  assert.equal(polledNote(s.blocks), '', 'live heads with a pending body are not polled heights');
  s.head({ number: 12, id: '12:status', arrivedAt: 13_000 });
  assert.equal(polledNote(s.blocks), '1 polled height without a body, drawn at the floor');
  s.head({ number: 13, id: '13:status', arrivedAt: 19_000 });
  assert.equal(polledNote(s.blocks), '2 polled heights without a body, drawn at the floor');
  // The socket returns and the real header for 13 supersedes the polled one: it no longer counts.
  s.head({ number: 13, id: '13:c', arrivedAt: 19_500 });
  assert.equal(polledNote(s.blocks), '1 polled height without a body, drawn at the floor');
  assert.equal(polledNote([]), '');
});

test('the status bar’s state word follows stated rules, worst first', () => {
  const normal = { socket: 'live', lastOk: true, seen: true, lag: 2, intervalMs: 6_000, hidden: false };
  assert.equal(stateWord(normal), 'Network normal');
  assert.equal(stateWord({ ...normal, hidden: true }), 'Paused');
  assert.equal(stateWord({ ...normal, seen: false }), 'Connecting');
  assert.equal(stateWord({ ...normal, lastOk: false }), 'Not updating');
  assert.equal(stateWord({ ...normal, seen: false, lastOk: false }), 'Not updating', 'an outage at first load is an outage, not a connection in progress');
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
  assert.equal(sealingPhrase({ authors: 5, total: 5, observed: 30, error: 'could not decode the set: bad length' }), 'validators unavailable · could not decode the set: bad length');
  assert.equal(sealingPhrase({ authors: null, total: null, observed: 0, error: 'HTTP 502' }), 'validators unavailable · HTTP 502');
});

// The status bar's event wiring, not only its pure helpers: the three faults
// the bar exists to flag (a finality stall, a block stall, a chain that is
// polled at one height) all live in `init`'s handlers, so these tests drive
// the real `init` against a fake root, bus and clock.

function fakeBar() {
  // Minimal DOM stand-ins: the bar only reads textContent/dataset.
  const el = () => ({ textContent: '', dataset: {}, classList: { add() {}, remove() {} }, offsetWidth: 0 });
  const nodes = { '.pulse-dot': el(), '.sb-state': el(), '.sb-validators': el(), '.sb-finality': el() };
  const root = { dataset: {}, querySelector: (s) => nodes[s] ?? null };
  const handlers = {};
  let clock = 1_000_000;
  const ctx = {
    bus: { on: (name, fn) => { (handlers[name] ||= []).push(fn); } },
    motion: { reduced: () => true },
    format: { formatInteger: (n) => String(n) },
    readout: { showValue() {}, showError() {} },
    watch() {},
    field: () => { throw new Error('not used'); },
    now: () => clock,
  };
  return {
    root, ctx, nodes,
    emit: (name, payload) => { for (const fn of handlers[name] ?? []) fn(payload); },
    advance: (ms) => { clock += ms; },
    now: () => clock,
    state: () => root.dataset.state,
  };
}

test('status bar: a finality stall is reported even though no finalized event arrives', async () => {
  const { root, ctx, emit, state } = fakeBar();
  const { init } = await import('../src/observatory/statusbar.js');
  init(root, ctx);

  emit('head', { record: { ok: true }, number: 100, author: { authorityIndex: 0 }, arrivedAt: ctx.now() });
  emit('finalized', { number: 98 });
  assert.equal(state(), 'network-normal', 'lag 2 is healthy');

  // Finality stops; blocks keep coming. No further `finalized` events.
  for (let n = 101; n <= 112; n++) {
    emit('head', { record: { ok: true }, number: n, author: { authorityIndex: n % 3 }, arrivedAt: ctx.now() });
  }
  assert.equal(state(), 'finality-lagging', 'lag must grow from heads alone');
});

test('status bar: a full block stall is reported with no event to prompt it', async () => {
  const { root, ctx, emit, advance, state } = fakeBar();
  const { init, LATE_MS, STALL_CHECK_MS } = await import('../src/observatory/statusbar.js');
  init(root, ctx);

  emit('head', { record: { ok: true }, number: 100, author: { authorityIndex: 0 }, arrivedAt: ctx.now() });
  emit('finalized', { number: 99 });
  assert.equal(state(), 'network-normal');

  // The chain dies. Nothing arrives. Only the clock moves.
  advance(LATE_MS + STALL_CHECK_MS);
  emit('visibility', { hidden: false }); // any re-render; the ticker does this unprompted in a browser
  assert.equal(state(), 'blocks-late', 'elapsed time since the last block must count');
});

test('status bar: polling that repeats the same height is not a stream of arrivals', async () => {
  const { root, ctx, emit, advance, state } = fakeBar();
  const { init, LATE_MS } = await import('../src/observatory/statusbar.js');
  init(root, ctx);

  emit('head', { record: { ok: true }, number: 100, author: null, arrivedAt: ctx.now() });
  emit('finalized', { number: 100 });

  // Polling emits a head every ~6 s whether or not the chain moved. Same
  // height each time: these are polls, not blocks.
  for (let i = 0; i < 6; i++) {
    advance(6_000);
    emit('head', { record: { ok: true }, number: 100, author: null, arrivedAt: ctx.now() });
  }
  advance(LATE_MS);
  emit('visibility', { hidden: false });
  assert.equal(state(), 'blocks-late', 'a height that never advances is a stalled chain, polling or not');
});

test('status bar: returning from a hidden tab is not a late block', async () => {
  const { root, ctx, emit, advance, state } = fakeBar();
  const { init } = await import('../src/observatory/statusbar.js');
  init(root, ctx);

  emit('head', { record: { ok: true }, number: 100, author: { authorityIndex: 0 }, arrivedAt: ctx.now() });
  emit('finalized', { number: 99 });
  emit('visibility', { hidden: true });
  advance(10 * 60_000); // ten minutes in another tab
  emit('visibility', { hidden: false });
  assert.equal(state(), 'network-normal', 'the hidden interval is not a chain fault');
});

test('sealing phrase never claims more validators than the set holds', async () => {
  const { sealingPhrase: phrase, SEALING_WINDOW: win } = await import('../src/observatory/statusbar.js');
  // The window still holds indices from a larger, previous set.
  assert.equal(phrase({ authors: 6, total: 5, observed: win }), '5 of 5 validators sealing');
});

// A second harness for the paths the block above does not reach: the `poll`
// event, the readout calls, the validators read, and the ticker main.js drives.
function statusBarHarness() {
  const el = () => ({ textContent: '', dataset: {}, classList: { add() {}, remove() {} }, offsetWidth: 1 });
  const slots = { '.pulse-dot': el(), '.sb-state': el(), '.sb-validators': el(), '.sb-finality': el() };
  const root = { dataset: {}, querySelector: (sel) => slots[sel] ?? null };
  const listeners = new Map();
  const bus = {
    on: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    emit: (name, payload) => (listeners.get(name) ?? []).forEach((fn) => fn(payload)),
  };
  const calls = { shown: [], errors: [] };
  const watches = new Map();
  let now = 1_000_000;
  const ctx = {
    bus,
    now: () => now,
    format: { formatInteger: (n) => n.toLocaleString('en-US') },
    motion: { reduced: () => false },
    readout: { showValue: (t, r, o) => calls.shown.push(o.value), showError: (t, r) => calls.errors.push(r) },
    field: (data, path) => path.split('.').reduce((v, k) => v[k], data),
    watch: (name, handler) => watches.set(name, handler),
  };
  const controller = initStatusBar(root, ctx);
  return {
    root, slots, bus, calls, controller, watches,
    now: () => now,
    /** Advances the clock and lets the ticker ask, as main.js does every STALL_CHECK_MS. */
    tick(ms) { now += ms; controller.tick(); },
    head: (number) => bus.emit('head', { record: { ok: true }, number, header: {}, author: { authorityIndex: number % 5 }, arrivedAt: now }),
    poll: (number, finalized) => bus.emit('poll', { record: { ok: true }, number, finalized, arrivedAt: now }),
  };
}

test('status bar wiring: polled heights arrive on `poll`, carry finality, beat only when the height moves, and read late when it stops', () => {
  const h = statusBarHarness();
  h.bus.emit('socket', { state: 'failed', attempts: 3 });
  h.poll(500, 498);
  h.tick(6_000);
  h.poll(501, 499);
  assert.equal(h.slots['.sb-state'].textContent, 'Polling');
  assert.equal(h.slots['.sb-finality'].textContent, 'finality 2 blocks');
  assert.equal(h.slots['.sb-validators'].textContent, 'validators not yet read');
  assert.deepEqual(h.calls.shown, [500, 501], 'each poll refreshes the figure and its provenance');
  assert.equal(h.controller.state().intervalMs, 6_000);
  for (let i = 0; i < 4; i += 1) { h.tick(6_000); h.poll(501, 499); }
  assert.equal(h.controller.state().best, 501);
  assert.equal(h.slots['.sb-state'].textContent, 'Blocks late', 'four polls at one height: the ticker said the stall');
  h.poll(502, 500);
  h.tick(6_000);
  h.poll(503, 501);
  assert.equal(h.slots['.sb-state'].textContent, 'Polling');
  // A failed poll is "Not updating", shown through the readout like a failed head.
  h.bus.emit('poll', { record: { ok: false, error: 'HTTP 502' }, number: null, finalized: null, arrivedAt: h.now() });
  assert.equal(h.slots['.sb-state'].textContent, 'Not updating');
  assert.equal(h.calls.errors.length, 1);
});

test('status bar wiring: the finality lag is held, not read from the DOM, and grows on heads alone', () => {
  const h = statusBarHarness();
  h.head(100);
  h.bus.emit('finalized', { record: { ok: true }, number: 98 });
  assert.equal(h.slots['.sb-finality'].textContent, 'finality 2 blocks');
  for (let n = 101; n <= 100 + FINALITY_LAG_ALERT + 1; n += 1) { h.tick(6_000); h.head(n); }
  assert.equal(h.slots['.sb-finality'].textContent, 'finality 9 blocks');
  assert.equal(h.slots['.sb-state'].textContent, 'Finality lagging');
  assert.deepEqual([h.controller.state().best, h.controller.state().lastFinalized], [107, 98]);
  h.tick(LATE_MS + 1);
  assert.equal(h.slots['.sb-state'].textContent, 'Finality lagging', 'the worse fault stays first');
});

test('status bar wiring: the validators read is said honestly — decoded, undecodable, or failed — and a changed set restarts the window', () => {
  const h = statusBarHarness();
  for (const n of [10, 11, 12]) { h.head(n); h.tick(6_000); }
  const validators = h.watches.get('validators');
  const five = { ok: true, data: { result: '0x' + '14' + '11'.repeat(32).repeat(5) } };
  validators(five);
  assert.equal(h.controller.state().total, 5);
  assert.equal(h.slots['.sb-validators'].textContent, '3 of 5 validators seen sealing so far', 'the first read keeps the window');
  const quiet = mock.method(console, 'error', () => {});
  validators({ ok: true, data: { result: '0x' + '05' + '11'.repeat(16) } });
  quiet.mock.restore();
  assert.equal(quiet.mock.callCount(), 1, 'the decode error is logged, not swallowed');
  assert.equal(h.controller.state().total, null);
  assert.match(h.slots['.sb-validators'].textContent, /^validators unavailable · could not decode the set: /);
  validators({ ok: false, error: 'HTTP 502' });
  assert.equal(h.slots['.sb-validators'].textContent, 'validators unavailable · HTTP 502');
  validators(five);
  assert.equal(h.slots['.sb-validators'].textContent, '5 validators in the set', 'the window restarted when the set changed');
  h.head(13);
  assert.equal(h.slots['.sb-validators'].textContent, '1 of 5 validators seen sealing so far');
  // Falling back to polling drops the window too: polled heights have no author.
  h.poll(14, 12);
  assert.equal(h.slots['.sb-validators'].textContent, '5 validators in the set');
});

test('status bar wiring: a height far below the best is a reset, not a stall', () => {
  const h = statusBarHarness();
  h.head(800_000);
  h.tick(6_000);
  h.head(800_001);
  h.bus.emit('finalized', { record: { ok: true }, number: 799_999 });
  assert.equal(h.slots['.sb-state'].textContent, 'Network normal');
  // The test network is reset: the next head is block 5.
  h.tick(6_000);
  h.head(5);
  assert.equal(h.controller.state().best, 5, 'the held height follows the reset');
  assert.equal(h.slots['.sb-finality'].textContent, 'finality —', 'the old finalized height is not compared with the new chain');
  h.tick(6_000);
  h.head(6);
  h.bus.emit('finalized', { record: { ok: true }, number: 4 });
  assert.equal(h.slots['.sb-finality'].textContent, 'finality 2 blocks');
  assert.equal(h.slots['.sb-state'].textContent, 'Network normal');
});

test('rail markers are equally spaced in order, whatever the block heights', () => {
  assert.deepEqual(railPositions(4), [8, 36, 64, 92]);
  assert.deepEqual(railPositions(1), [50]);
  assert.deepEqual(railPositions(0), []);
  const five = railPositions(5);
  for (let i = 1; i < five.length; i += 1) assert.ok(Math.abs(five[i] - five[i - 1] - 21) < 1e-9);
});

test('presenter mode is asked for by ?present=1 and driven by the arrow keys', () => {
  assert.equal(wantsPresenter('?present=1'), true);
  assert.equal(wantsPresenter('?a=b&present=1'), true);
  assert.equal(wantsPresenter('?present=1&a=b'), true);
  assert.equal(wantsPresenter('?present=10'), false);
  assert.equal(wantsPresenter('?present=0'), false);
  assert.equal(wantsPresenter(''), false);
  assert.equal(stepFor('ArrowRight', 0, 8), 1);
  assert.equal(stepFor('ArrowRight', 7, 8), 0, 'wraps');
  assert.equal(stepFor('ArrowLeft', 0, 8), 7);
  assert.equal(stepFor('Home', 5, 8), 0);
  assert.equal(stepFor('End', 5, 8), 7);
  assert.equal(stepFor(' ', 2, 8), 3);
  assert.equal(stepFor('a', 2, 8), null);
  assert.equal(stepFor('ArrowRight', 0, 0), null);
});

test('the sky is asked for by ?sky=1 and places every address by its hash, the same on every visit', () => {
  assert.equal(wantsSky('?sky=1'), true);
  assert.equal(wantsSky('?present=1&sky=1'), true);
  assert.equal(wantsSky('?sky=10'), false);
  assert.equal(wantsSky(''), false);
  assert.equal(wantsSky(undefined), false);
  assert.equal(hashAddress(''), 0x811c9dc5);
  assert.equal(hashAddress('a'), 0xe40c292c);
  const a = placeOf('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty');
  assert.deepEqual(placeOf('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'), a, 'deterministic');
  for (const v of [a.x, a.y, a.depth]) assert.ok(v >= 0 && v < 1);
  // The documented mapping: x from the low sixteen bits, y from the high sixteen, depth from the hash of address + ':depth'.
  const h = hashAddress('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty');
  assert.equal(a.x, (h & 0xffff) / 0x10000);
  assert.equal(a.y, (h >>> 16) / 0x10000);
  assert.equal(a.depth, (hashAddress('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty:depth') & 0xffff) / 0x10000);
  assert.notDeepEqual(placeOf('5FHneW47'), a);
});

test('a star is sized by stake and brightened by recent activity; a validator is a fixed bright star with the reticle', () => {
  const scale = { maxStake: '10000000000000000', maxActivity: 4 };
  const big = starOf('x', { stakePlancks: '10000000000000000', activity: 4 }, scale);
  const small = starOf('x', { stakePlancks: '0', activity: 0 }, scale);
  assert.deepEqual([big.x, big.y, big.depth], [small.x, small.y, small.depth], 'stake and activity change size and light, never place');
  assert.ok(Math.abs(big.size - 12) < 1e-9 && Math.abs(big.bright - 1) < 1e-9);
  assert.ok(Math.abs(small.size - 3) < 1e-9 && Math.abs(small.bright - 0.35) < 1e-9);
  assert.ok(Math.abs(starOf('x', { stakePlancks: '2500000000000000', activity: 1 }, scale).size - 7.5) < 1e-9, 'a quarter of the stake is half the size step');
  assert.equal(starOf('x', { stakePlancks: '5', activity: 5 }).size, 3, 'with no scale every star is the smallest and dimmest');
  assert.equal(starOf('x', { stakePlancks: '5', activity: 5 }).bright, 0.35);
  assert.equal(starOf('x', { stakePlancks: 'nope', activity: 0 }, scale).size, 3, 'a non-numeric stake is no stake, never NaN');
  const v = validatorStar('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
  assert.deepEqual([v.kind, v.size, v.bright], [1, 16, 1]);
  assert.deepEqual([v.x, v.y, v.depth], Object.values(placeOf('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY')));

  // Recent activity: open agreements now, settlements in the last ten minutes, a heartbeat within about an hour.
  const recentSettled = new Map([['a', 2]]);
  assert.equal(activityOf({ address: 'a', activeEscrowCount: 3, lastHeartbeatBlock: 1000 }, { best: 1000 + HEARTBEAT_RECENT_BLOCKS, recentSettled }), 6);
  assert.equal(activityOf({ address: 'a', activeEscrowCount: 3, lastHeartbeatBlock: 1000 }, { best: 1001 + HEARTBEAT_RECENT_BLOCKS, recentSettled }), 5, 'an older heartbeat is not recent');
  assert.equal(activityOf({ address: 'b', activeEscrowCount: 0, lastHeartbeatBlock: null }, { best: 5000, recentSettled }), 0);
  assert.equal(activityOf({ address: 'b' }, {}), 0, 'missing counters count as none, never NaN');
  const counts = recentSettlements([{ buyer: 'a', provider: 'b', seq: 1, blockNumber: 990 }, { buyer: 'a', provider: 'c', seq: 1, blockNumber: 1 }], { best: 1000 });
  assert.deepEqual([...counts], [['a', 1], ['b', 1]], 'a settlement older than ten minutes no longer counts');
});

test('the field lists agents then validators, capped, and lines only between stars it has', () => {
  const agents = [
    { address: 'a', stakePlancks: '4', activeEscrowCount: 1, lastHeartbeatBlock: 0 },
    { address: 'b', stakePlancks: '1', activeEscrowCount: 0, lastHeartbeatBlock: 0 },
    { address: 'v', stakePlancks: '1', activeEscrowCount: 0, lastHeartbeatBlock: 0 },
  ];
  const placed = starsFor(agents, ['v', 'w'], { best: 10 });
  assert.equal(placed.stars.length, 5);
  assert.deepEqual(placed.stars.map((s) => s.kind), [0, 0, 0, 1, 1]);
  assert.deepEqual([...placed.index], [['a', 0], ['b', 1], ['v', 2], ['w', 4]], 'an address that is both agent and validator is drawn as the agent');
  assert.ok(Math.abs(placed.stars[0].size - 12) < 1e-9 && Math.abs(placed.stars[1].size - 7.5) < 1e-9);
  assert.equal(placed.maxActivity, 2, 'one open agreement and a heartbeat within the hour');
  assert.ok(Math.abs(placed.stars[0].bright - 1) < 1e-9 && Math.abs(placed.stars[1].bright - (0.35 + 0.65 * Math.sqrt(0.5))) < 1e-9);
  const many = starsFor(Array.from({ length: MAX_STARS + 10 }, (_, i) => ({ address: `agent-${i}`, stakePlancks: '1' })), ['v']);
  assert.equal(many.stars.length, MAX_STARS, 'validators never push the field past its cap');

  const seen = new Map();
  const open = [
    { buyer: 'a', provider: 'b', seq: 1, status: 'Created' },
    { buyer: 'a', provider: 'b', seq: 2, status: 'Disputed' },
    { buyer: 'a', provider: 'zz', seq: 1, status: 'Created' },
  ];
  const settled = [
    { buyer: 'a', provider: 'b', seq: 1, blockNumber: 999 }, // still open under the same key: not drawn twice
    { buyer: 'b', provider: 'v', seq: 7, blockNumber: 990 },
    { buyer: 'b', provider: 'v', seq: 6, blockNumber: 1000 - SETTLE_FADE_MS / SLOT_MS }, // ten minutes ago: gone
    { buyer: 'b', provider: 'zz', seq: 1, blockNumber: 999 },
  ];
  const first = linesFor(open, settled, placed.index, { best: 1000, now: 50, seen });
  assert.deepEqual(first.lines, [
    { key: 'a/b/1', from: 0, to: 1, state: 0, t0: 0 },
    { key: 'a/b/2', from: 0, to: 1, state: 1, t0: 50 },
    { key: 'b/v/7', from: 1, to: 2, state: 2, t0: 50 - 10 * SLOT_MS },
  ]);
  assert.equal(first.omitted, 2, 'a line to an address that is not a star is counted, never placed');
  const later = linesFor(open, settled, placed.index, { best: 1000, now: 80, seen });
  assert.equal(later.lines[1].t0, 50, 'a dispute keeps the moment it was first seen: it flickers once');
  const gone = linesFor([open[0]], [], placed.index, { best: 1000, now: 90, seen });
  assert.equal(seen.size, 0, 'a dispute that has left the list is forgotten');
  assert.equal(gone.lines.length, 1);
});

test('the sky’s marker, glow, frame judge and fallbacks follow stated rules', () => {
  assert.equal(markerX(0), 1);
  assert.equal(markerX(30), 0);
  assert.equal(markerX(60), -1);
  assert.equal(markerX(600), -1, 'never past the left edge');
  assert.equal(markerX(NaN), 1);
  assert.equal(settleGlow(0), 1);
  assert.equal(settleGlow(SETTLE_FADE_MS / 2), 0.5);
  assert.equal(settleGlow(SETTLE_FADE_MS), 0);
  assert.equal(settleGlow(SETTLE_FADE_MS * 3), 0);
  assert.equal(fpsTooLow([20, 20]), false, 'two slow seconds are not three');
  assert.equal(fpsTooLow([60, 20, 20, 20]), true);
  assert.equal(fpsTooLow([20, 20, 31]), false);
  assert.equal(fpsTooLow([20, 29.9, 20]), true);
  assert.deepEqual(frameStats([]), { frames: 0, fps: null, worstMs: null });
  assert.deepEqual(frameStats([16.6, 16.8, 16.6]), { frames: 3, fps: 60, worstMs: 16.8 });
  assert.deepEqual(frameStats([50]), { frames: 1, fps: 20, worstMs: 50 });
  assert.deepEqual(parseColor('#8a97a8'), [0x8a / 255, 0x97 / 255, 0xa8 / 255]);
  assert.deepEqual(parseColor('#fff'), [1, 1, 1]);
  assert.deepEqual(parseColor('rgba(111, 211, 199, 0.35)'), [111 / 255, 211 / 255, 199 / 255]);
  assert.equal(parseColor('teal'), null);
  assert.equal(parseColor(undefined), null);
  assert.equal(fallbackReason({ webgl: true, reduced: false }), null);
  assert.match(fallbackReason({ webgl: false, reduced: false }), /no WebGL/);
  assert.match(fallbackReason({ webgl: true, reduced: true }), /reduced motion/);
  assert.match(fallbackReason({ webgl: false, reduced: true }), /reduced motion/, 'reduced motion is named first: it is the reader’s choice');
  assert.equal(
    skyExtra({ validators: 5, lines: 1, omitted: 0, settled: 2, complete: true }),
    'one per registered agent, sized by stake, brighter the more recent its activity; 5 validators as fixed stars (Session.Validators); 1 line, one per open agreement (/v1/escrows); 2 settlements of the last ten minutes glowing (escrow.DeliveryConfirmed); the field moves once per block and drifts 1° a minute',
  );
  assert.match(skyExtra({ validators: 5, lines: 3, omitted: 2, settled: 0, complete: false }), /agent listed, .*3 lines, .*2 not drawn: a party is not a registered agent; 0 settlements/);
});

test('the sky never loads its scene without the flag, and stands down before loading it under reduced motion or without WebGL', async () => {
  const note = { hidden: true, querySelector: (sel) => (sel === '.reading-prov' ? prov : value) };
  const value = { textContent: '', classList: { remove() {} } };
  const prov = { cleared: 0, replaceChildren() { this.cleared += 1; } };
  const html = { attrs: new Map(), setAttribute(k, v) { this.attrs.set(k, v); }, removeAttribute(k) { this.attrs.delete(k); }, hasAttribute(k) { return this.attrs.has(k); } };
  const doc = (webgl) => ({ documentElement: html, defaultView: { location: { search: '?sky=1' } }, querySelector: () => note, createElement: () => ({ getContext: () => (webgl ? {} : null) }), body: { append() {} } });
  let loads = 0;
  const load = async () => { loads += 1; return { start: () => ({ stopped: false }) }; };
  const ctx = (reduced) => ({ motion: { reduced: () => reduced }, bus: { on() {} }, format: { formatInteger: String } });
  assert.equal(initSky(doc(true), ctx(false), { search: '', load }), null, 'off by default');
  assert.equal(loads, 0);
  const reduced = initSky(doc(true), ctx(true), { load });
  assert.match(reduced.reason, /reduced motion/);
  assert.match(value.textContent, /reduced motion/);
  assert.equal(await reduced.ready, null);
  const noGl = initSky(doc(false), ctx(false), { load });
  assert.match(noGl.reason, /no WebGL/);
  assert.equal(loads, 0, 'neither fallback fetched the scene');
  assert.equal(prov.cleared, 2, 'a fallback clears the provenance line it no longer describes');
  const on = initSky(doc(true), ctx(false), { load });
  assert.equal(on.reason, null);
  assert.ok(html.hasAttribute('data-sky'));
  assert.deepEqual(await on.ready, { stopped: false });
  assert.equal(loads, 1, 'the scene is fetched once, only when it can run');
});
