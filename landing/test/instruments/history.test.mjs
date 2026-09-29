// Unit tests for the history strips' pure helpers: block intervals with
// missing timestamps, era bucketing against real boundaries (including the
// rule that drops eras the fetched events do not reach), the cumulative
// agent series with its baseline, the emission series and CMN scaling, and
// the plot frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NOMINAL_BLOCK_S,
  ERAS_SHOWN,
  blockIntervals,
  intervalStats,
  eraSpans,
  bucketByEra,
  emissionSeries,
  agentSteps,
  plotFrame,
  yCeiling,
} from '../../src/observatory/instruments/history.js';
import { field } from '../../src/observatory/data.js';
import { cmnNumber, formatCmn } from '../../src/observatory/format.js';

// The live shape of /v1/eras?limit=14 on 2026-09-29: the era in progress,
// then thirteen settled ones newest first (68 carried a non-zero weight).
const ERAS = [
  { era: 80, settled: false, totalEmissionPlancks: null, settledAtBlock: null, startBlock: 820862, durationBlocks: 3600, blocksElapsed: 14 },
  { era: 79, settled: true, totalEmissionPlancks: '0', settledAtBlock: 820862, startBlock: null },
  { era: 78, settled: true, totalEmissionPlancks: '0', settledAtBlock: 817157, startBlock: null },
  { era: 77, settled: true, totalEmissionPlancks: '0', settledAtBlock: 813442, startBlock: null },
  { era: 76, settled: true, totalEmissionPlancks: '0', settledAtBlock: 809739, startBlock: null },
  { era: 75, settled: true, totalEmissionPlancks: '0', settledAtBlock: 806033, startBlock: null },
  { era: 74, settled: true, totalEmissionPlancks: '0', settledAtBlock: 802328, startBlock: null },
  { era: 73, settled: true, totalEmissionPlancks: '0', settledAtBlock: 798623, startBlock: null },
  { era: 72, settled: true, totalEmissionPlancks: '0', settledAtBlock: 794903, startBlock: null },
  { era: 71, settled: true, totalEmissionPlancks: '0', settledAtBlock: 791227, startBlock: null },
  { era: 70, settled: true, totalEmissionPlancks: '0', settledAtBlock: 787529, startBlock: null },
  { era: 69, settled: true, totalEmissionPlancks: '0', settledAtBlock: 783814, startBlock: null },
  { era: 68, settled: true, totalEmissionPlancks: '0', settledAtBlock: 780099, startBlock: null },
  { era: 67, settled: true, totalEmissionPlancks: '0', settledAtBlock: 776394, startBlock: null },
];

/** A newest-first /v1/blocks page: `count` blocks ending at `last`, 6 s apart unless overridden. */
function blocksPage(last, count, { at = {}, missing = [] } = {}) {
  const items = [];
  for (let i = 0; i < count; i += 1) {
    const number = last - i;
    const base = 1_790_000_000_000 + number * 6_000;
    items.push({ number, timestampMs: missing.includes(number) ? null : (at[number] ?? base) });
  }
  return items;
}

test('block intervals run oldest to newest, one per consecutive pair', () => {
  const page = blocksPage(820881, 200);
  const series = blockIntervals(page, field);
  assert.equal(series.blocks, 200);
  assert.equal(series.points.length, 199);
  assert.equal(series.first, 820682);
  assert.equal(series.last, 820881);
  assert.equal(series.skipped, 0);
  assert.equal(series.points[0].number, 820683);
  assert.equal(series.points[198].number, 820881);
  assert.ok(series.points.every((p) => p.seconds === 6));
});

test('a block with no timestamp drops both pairs it belongs to, never a guessed gap', () => {
  const page = blocksPage(1000, 6, { missing: [998] });
  const series = blockIntervals(page, field);
  assert.equal(series.points.length, 3);
  assert.equal(series.skipped, 2);
  assert.deepEqual(
    series.points.map((p) => p.number),
    [996, 997, 1000],
  );
  // A gap in the block numbers is not an interval either.
  const gap = blockIntervals([{ number: 10, timestampMs: 60_000 }, { number: 8, timestampMs: 48_000 }], field);
  assert.equal(gap.points.length, 0);
  assert.equal(gap.skipped, 1);
});

test('a missing block number is a decode failure, not a zero', () => {
  assert.throws(() => blockIntervals([{ timestampMs: 1 }, { number: 1, timestampMs: 2 }], field), /response has no number/);
});

test('interval stats: last, mean, min, max; null for an empty series', () => {
  const page = blocksPage(100, 5, { at: { 100: 1_790_000_000_000 + 100 * 6_000 + 6_000 } });
  const stats = intervalStats(blockIntervals(page, field).points);
  assert.equal(stats.last, 12);
  assert.equal(stats.min, 6);
  assert.equal(stats.max, 12);
  assert.equal(stats.mean, 7.5);
  assert.equal(intervalStats([]), null);
});

test('era spans: settled era k runs from the settlement of k−1 to its own, twelve at most', () => {
  const { whole, open, settled } = eraSpans(ERAS, field);
  assert.equal(settled.length, 13);
  assert.equal(whole.length, ERAS_SHOWN);
  assert.deepEqual(whole[0], { era: 68, start: 776394, end: 780099 });
  assert.deepEqual(whole[11], { era: 79, start: 817157, end: 820862 });
  assert.deepEqual(open, { era: 80, start: 820862 });
  // Thirteen settled entries make twelve whole eras; era 67's start is unknown.
  assert.ok(!whole.some((s) => s.era === 67));
});

test('era spans use only the contiguous run ending at the newest settled era', () => {
  const withGap = ERAS.filter((e) => e.era !== 74);
  const { whole } = eraSpans(withGap, field);
  assert.deepEqual(
    whole.map((s) => s.era),
    [76, 77, 78, 79],
  );
  // No settled era at all: nothing whole, and the open era still reported.
  const young = eraSpans([ERAS[0]], field);
  assert.deepEqual(young.whole, []);
  assert.deepEqual(young.open, { era: 80, start: 820862 });
  // One settled era gives no whole span either.
  assert.deepEqual(eraSpans(ERAS.slice(0, 2), field).whole, []);
});

test('bucketing counts each event into the era whose span holds it, with the era in progress "so far"', () => {
  const { whole, open } = eraSpans(ERAS, field);
  const events = [
    { blockNumber: 820900 }, // era 80, in progress
    { blockNumber: 820862 }, // first block of era 80
    { blockNumber: 820861 }, // last block of era 79
    { blockNumber: 817157 }, // first block of era 79
    { blockNumber: 808507 }, // era 76
    { blockNumber: 808504 }, // era 76
    { blockNumber: 776394 }, // first block of era 68
  ];
  const result = bucketByEra(whole, open, events, { complete: true, indexFrom: 496606 });
  assert.equal(result.dropped, 0);
  assert.equal(result.historyFrom, 776394);
  const counts = Object.fromEntries(result.buckets.map((b) => [b.era, b.count]));
  assert.equal(counts[79], 2);
  assert.equal(counts[76], 2);
  assert.equal(counts[68], 1);
  assert.equal(counts[70], 0);
  assert.equal(result.open.count, 2);
  assert.equal(result.buckets.length, 12);
});

test('bucketing drops the eras a short event list cannot fill, and says where history begins', () => {
  const { whole, open } = eraSpans(ERAS, field);
  // The page cap cut the list short and the oldest event on hand is in era 74.
  const events = [{ blockNumber: 820900 }, { blockNumber: 805000 }, { blockNumber: 800000 }];
  const cut = bucketByEra(whole, open, events, { complete: false, indexFrom: 496606 });
  assert.deepEqual(
    cut.buckets.map((b) => b.era),
    [75, 76, 77, 78, 79],
  );
  assert.equal(cut.dropped, 7);
  assert.equal(cut.historyFrom, 802328);
  assert.equal(cut.buckets.find((b) => b.era === 75).count, 1);
  // The same events with the list complete: nothing older exists, so every era is fillable.
  const full = bucketByEra(whole, open, events, { complete: true, indexFrom: 496606 });
  assert.equal(full.dropped, 0);
  assert.equal(full.buckets.length, 12);
  // An index that begins inside the window drops the eras before it.
  const late = bucketByEra(whole, open, events, { complete: true, indexFrom: 790000 });
  assert.deepEqual(
    late.buckets.map((b) => b.era),
    [72, 73, 74, 75, 76, 77, 78, 79],
  );
  assert.equal(late.historyFrom, 791227);
  // Nothing fillable at all.
  const none = bucketByEra(whole, open, [{ blockNumber: 820900 }], { complete: false, indexFrom: 496606 });
  assert.deepEqual(none.buckets, []);
  assert.equal(none.historyFrom, 820862);
  assert.equal(none.open.count, 1);
});

test('emission series: settled eras oldest first, CMN as a number for the scale, plancks kept for the figure', () => {
  const series = emissionSeries(ERAS, field, cmnNumber);
  assert.equal(series.length, 12);
  assert.equal(series[0].era, 68);
  assert.equal(series[11].era, 79);
  assert.equal(series[11].settledAt, 820862);
  assert.ok(series.every((e) => e.cmn === 0 && e.plancks === '0'));
  const rich = emissionSeries(
    [{ era: 5, settled: true, totalEmissionPlancks: '1234567890123456789', settledAtBlock: 10 }],
    field,
    cmnNumber,
  );
  assert.equal(rich[0].cmn, 1234567.890123);
  assert.equal(formatCmn(rich[0].plancks), '1,234,567');
});

test('cmnNumber scales plancks to CMN for charts, keeping six decimals', () => {
  assert.equal(cmnNumber('0'), 0);
  assert.equal(cmnNumber('1000000000000'), 1);
  assert.equal(cmnNumber('1500000000000'), 1.5);
  assert.equal(cmnNumber('123456789012345678901234'), 123456789012.345678);
});

test('the agent series starts from a baseline of agents the index never saw register', () => {
  const registrations = [808497, 789416, 528191]; // newest first, as the index lists them
  const series = agentSteps({ registrations, unstakes: [], totalNow: 6, indexFrom: 496606, nowBlock: 820876 });
  assert.equal(series.baseline, 3);
  assert.equal(series.total, 6);
  assert.equal(series.start, 496606);
  assert.equal(series.end, 820876);
  assert.deepEqual(series.points, [
    { block: 496606, count: 3 },
    { block: 528191, count: 4 },
    { block: 789416, count: 5 },
    { block: 808497, count: 6 },
    { block: 820876, count: 6 },
  ]);
});

test('a departure steps the series down, and the numbers must reconcile', () => {
  const series = agentSteps({ registrations: [700, 600], unstakes: [650], totalNow: 4, indexFrom: 500, nowBlock: 800 });
  assert.equal(series.baseline, 3);
  assert.deepEqual(
    series.points.map((p) => p.count),
    [3, 4, 3, 4, 4],
  );
  assert.throws(() => agentSteps({ registrations: [1, 2, 3], unstakes: [], totalNow: 2, indexFrom: 0, nowBlock: 10 }), /reconcile/);
  // No now block: the series ends at its last event and says so.
  const open = agentSteps({ registrations: [700], unstakes: [], totalNow: 1, indexFrom: 500, nowBlock: null });
  assert.equal(open.end, null);
  assert.equal(open.points[open.points.length - 1].block, 700);
  // No events at all: a flat line from the index start to now.
  const flat = agentSteps({ registrations: [], unstakes: [], totalNow: 3, indexFrom: 500, nowBlock: 900 });
  assert.deepEqual(flat.points, [
    { block: 500, count: 3 },
    { block: 900, count: 3 },
  ]);
});

test('the plot frame leaves room for the end labels and the y ceiling is never zero', () => {
  const frame = plotFrame(300, 88);
  assert.equal(frame.top, 6);
  assert.equal(frame.bottom, 72);
  assert.equal(frame.left, 1);
  assert.equal(frame.right, 299);
  assert.equal(frame.innerHeight, 66);
  assert.equal(yCeiling([0, 0, 0]), 1);
  assert.equal(yCeiling([]), 1);
  assert.ok(yCeiling([6, 12, NOMINAL_BLOCK_S * 2]) > 12);
  assert.equal(yCeiling([50]), 54);
});
