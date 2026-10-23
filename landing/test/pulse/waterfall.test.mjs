// Unit tests for the Waterfall's pure helpers (src/pulse/waterfall.js): the
// grid for a width, the rows that fit, the columns in agent-id order with
// the clay head for an operator-run name, the glyph for each kind of event
// (and none for a party that is not a column), the rail's every-tenth label,
// the state's alpha and ink, and the tokens read off :root. The canvas
// itself is exercised in headless Chromium, not here: these tests have none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, KINDS } from '../../src/pulse/model.js';
import { LEGEND } from '../../src/pulse.mjs';
import {
  BORN_ALPHA,
  CONNECTING_ALPHA,
  DESKTOP,
  GLYPH_KINDS,
  HEAD_HEIGHT,
  MOBILE,
  RAIL_EVERY,
  ROWS_VISIBLE,
  TOKENS,
  columnsOf,
  geometry,
  glyphOf,
  glyphToken,
  railLabel,
  readTokens,
  rowsVisible,
  stateAlpha,
} from '../../src/pulse/waterfall.js';

const A = '5A'.padEnd(48, 'a');
const B = '5B'.padEnd(48, 'b');
const C = '5C'.padEnd(48, 'c');
const rowOf = (kind) => EVENTS.find((row) => row.kind === kind);

test('the grid is the brief’s: 4 px columns at 1 px gaps and 6 px rows on desktop; 1 px, no gap, 3 px rows on mobile; about a hundred rows', () => {
  assert.deepEqual([DESKTOP.column, DESKTOP.gap, DESKTOP.row], [4, 1, 6]);
  assert.deepEqual([MOBILE.column, MOBILE.gap, MOBILE.row], [1, 0, 3]);
  assert.equal(ROWS_VISIBLE, 100);
  assert.equal(RAIL_EVERY, 10);
  assert.equal(rowsVisible(HEAD_HEIGHT + 100 * DESKTOP.row, DESKTOP.row), 100);
  assert.equal(rowsVisible(HEAD_HEIGHT + 100 * MOBILE.row, MOBILE.row), 100);
  assert.equal(rowsVisible(0, DESKTOP.row), 0);
});

test('geometry: the pitch is column plus gap and the columns are what fit beside the rail', () => {
  const desk = geometry(DESKTOP.rail + 5 * 10, false);
  assert.equal(desk.pitch, 5);
  assert.equal(desk.columns, 10);
  const mobile = geometry(MOBILE.rail + 300, true);
  assert.equal(mobile.pitch, 1);
  assert.equal(mobile.columns, 300);
  assert.equal(geometry(0).columns, 0);
});

test('columnsOf: agents in agent-id order, then by address when the index gives no id; the index maps address → column', () => {
  const { list, index } = columnsOf([
    { address: C, id: 7 },
    { address: A, id: 2 },
    { address: B, id: 10 },
  ]);
  assert.deepEqual(list.map((c) => c.address), [A, C, B]);
  assert.deepEqual([...index.entries()], [[A, 0], [C, 1], [B, 2]]);
  const noIds = columnsOf([{ address: C }, { address: A }, { address: B }]);
  assert.deepEqual(noIds.list.map((c) => c.address), [A, B, C]);
  assert.deepEqual(columnsOf([{ nope: 1 }, null]).list, []);
});

test('columnsOf: the clay head is the swarm- prefix, from the names map first, then the item’s name', () => {
  const names = new Map([[A, 'swarm-ab'], [B, 'bee']]);
  const { list } = columnsOf([{ address: A, id: 1 }, { address: B, id: 2, name: 'swarm-no' }, { address: C, id: 3, name: 'swarm-c' }], names);
  assert.deepEqual(list.map((c) => c.operator), [true, false, true]);
  assert.equal(list[1].name, 'bee');
});

test('glyphOf: each kind that draws names its parties’ columns; a party that is not a column is null, never a guessed column', () => {
  const { index } = columnsOf([{ address: A, id: 1 }, { address: B, id: 2 }]);
  const agreement = glyphOf({ row: rowOf('agreement'), parties: { from: A, to: B } }, index, 'k');
  assert.deepEqual(agreement, { kind: 'agreement', from: 0, to: 1, key: 'k' });
  const message = glyphOf({ row: rowOf('message'), parties: { from: B, to: C } }, index);
  assert.deepEqual(message, { kind: 'message', from: 1, to: null, key: null });
  assert.equal(glyphOf({ row: rowOf('oracle'), parties: { from: A, to: null } }, index).to, null);
  assert.equal(glyphOf({ row: rowOf('registered'), parties: { from: C, to: null } }, index).from, null);
  assert.equal(glyphOf({ row: rowOf('settled'), parties: { from: A, to: B } }, index).to, 1);
  assert.equal(glyphOf({ row: rowOf('dispute'), parties: { from: A, to: B } }, index).kind, 'dispute');
});

test('glyphOf: a resolution draws nothing of its own but carries its key, so the dispute line it ends can be found', () => {
  const { index } = columnsOf([{ address: A, id: 1 }, { address: B, id: 2 }]);
  assert.deepEqual(glyphOf({ row: rowOf('resolved'), parties: { from: A, to: B } }, index, 'k'), { kind: 'resolved', from: 0, to: 1, key: 'k' });
  assert.equal(glyphOf({ row: { kind: 'nothing' }, parties: {} }, index), null);
});

test('the six glyph kinds are the legend’s six, in the legend’s order, and every kind but resolved', () => {
  assert.deepEqual(GLYPH_KINDS, LEGEND.map(([kind]) => kind));
  assert.deepEqual(GLYPH_KINDS, KINDS.filter((kind) => kind !== 'resolved'));
  assert.equal(LEGEND.length, 6);
  for (const [kind, name] of LEGEND) assert.equal(name, rowOf(kind).describe, `the legend names ${kind} as model.js does`);
});

test('railLabel: a block number every tenth block, grouped, and nothing between', () => {
  assert.equal(railLabel(1_000_000), '1,000,000');
  assert.equal(railLabel(1_000_010), '1,000,010');
  assert.equal(railLabel(1_000_003), null);
  assert.equal(railLabel(NaN), null);
  assert.equal(railLabel(25, 5), '25');
});

test('states: connecting draws the index’s record at 40 %, a born row at 60 %; index behind turns every glyph sage', () => {
  assert.equal(CONNECTING_ALPHA, 0.4);
  assert.equal(BORN_ALPHA, 0.6);
  assert.equal(stateAlpha('connecting'), 0.4);
  assert.equal(stateAlpha('live'), 1);
  assert.equal(stateAlpha('behind'), 1);
  for (const kind of GLYPH_KINDS) assert.equal(glyphToken(kind, 'behind'), 'sage');
  assert.equal(glyphToken('agreement', 'live'), 'filament');
  assert.equal(glyphToken('dispute', 'live'), 'vermilion');
  assert.equal(glyphToken('settled', 'live'), 'bone');
  assert.equal(glyphToken('oracle', 'live'), 'filament');
});

test('readTokens: every colour and the timings come off :root at draw time; nothing is a literal in the module', () => {
  const values = { '--filament': ' #ffe3a3 ', '--sage': '#7f8a80', '--t-shift': '240ms', '--t-cool': '1800ms', '--font-mono': '"Martian Mono", monospace' };
  const win = { document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: (name) => values[name] ?? '' }) };
  const tokens = readTokens(win);
  assert.equal(tokens.filament, '#ffe3a3');
  assert.equal(tokens.sage, '#7f8a80');
  assert.equal(tokens.shift, 240);
  assert.equal(tokens.cool, 1800);
  assert.equal(tokens['font-mono'], '"Martian Mono", monospace');
  for (const name of ['pine-0', 'bone', 'bone-dim', 'sage', 'leader', 'filament', 'vermilion', 'clay']) assert.ok(TOKENS.includes(name), name);
});
