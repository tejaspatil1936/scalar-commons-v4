// Unit tests for the Waterfall's pure helpers (src/pulse/waterfall.js): the
// grid for a width, the rows that fit, the columns in agent-id order with
// the double head for an operator-run name, the glyph for each kind of event
// (and none for a party that is not a column), the rail's every-tenth label,
// the state's alpha and the Ledger's inks (no hue: shape and ink carry the
// kind and the state), and the tokens read off :root. The canvas
// itself is exercised in headless Chromium, not here: these tests have none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVENTS, KINDS } from '../../src/pulse/model.js';
import { LEGEND } from '../../src/pulse.mjs';
import {
  BORN_ALPHA,
  CONNECTING_ALPHA,
  DASH,
  DESKTOP,
  GLYPH_KINDS,
  HEAD_HEIGHT,
  MOBILE,
  RAIL_EVERY,
  ROWS_VISIBLE,
  TOKENS,
  columnsOf,
  createWaterfall,
  geometry,
  glyphOf,
  glyphToken,
  headOf,
  lineToken,
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

test('geometry: every registered agent is a column — the gap goes first, then the column narrows, never below 1 px', () => {
  const room = 1000;
  const fits = geometry(DESKTOP.rail + room, false, 150);
  assert.deepEqual([fits.column, fits.gap, fits.pitch], [4, 1, 5], 'at the brief’s pitch when they fit');
  const noGap = geometry(DESKTOP.rail + room, false, 204);
  assert.deepEqual([noGap.column, noGap.gap], [4, 0], 'the gap goes first');
  assert.ok(noGap.columns >= 204);
  const narrow = geometry(DESKTOP.rail + room, false, 400);
  assert.deepEqual([narrow.column, narrow.gap], [2, 0]);
  assert.ok(narrow.columns >= 400);
  assert.equal(geometry(DESKTOP.rail + 10, false, 400).column, 1, 'never below 1 px');
  assert.ok(DESKTOP.rail >= 9 * 7, 'the rail holds a grouped seven-digit block number at 11 px mono');
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

test('columnsOf: the operator-run head is the swarm- prefix, from the names map first, then the item’s name', () => {
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

test('states: connecting draws the index’s record at 40 %, a born row at 60 %; index behind turns every glyph rule-2', () => {
  assert.equal(CONNECTING_ALPHA, 0.4);
  assert.equal(BORN_ALPHA, 0.6);
  assert.equal(stateAlpha('connecting'), 0.4);
  assert.equal(stateAlpha('live'), 1);
  assert.equal(stateAlpha('behind'), 1);
  for (const kind of GLYPH_KINDS) {
    assert.equal(glyphToken(kind, 'behind'), 'rule-2');
    assert.equal(lineToken(kind, 'behind'), 'rule-2');
  }
});

test('the Ledger’s glyphs (SITE-ROUND2.md §1.2): ink marks, lighter lines, a dashed dispute, ink heads for the joined, a double head for operator-run', () => {
  const inks = new Set(['ink', 'ink-2', 'ink-3', 'rule', 'rule-2']);
  for (const kind of GLYPH_KINDS) {
    assert.ok(inks.has(glyphToken(kind, 'live')), `${kind} is drawn in a Ledger ink`);
    assert.ok(inks.has(lineToken(kind, 'live')), `${kind}’s line is drawn in a Ledger ink`);
  }
  // agreement = 1 px ink line with end ticks
  assert.equal(glyphToken('agreement', 'live'), 'ink');
  assert.equal(lineToken('agreement', 'live'), 'ink');
  // message = 4×4 ink-3 cell with a 1 px rule-2 line
  assert.equal(glyphToken('message', 'live'), 'ink-3');
  assert.equal(lineToken('message', 'live'), 'rule-2');
  // paid = 4×6 ink cell, line ink-3
  assert.equal(glyphToken('settled', 'live'), 'ink');
  assert.equal(lineToken('settled', 'live'), 'ink-3');
  // dispute = a 1 px line dashed 2/2; oracle = an ink tick; joined = the head printed ink
  assert.equal(lineToken('dispute', 'live'), 'ink');
  assert.equal(DASH, 2);
  assert.equal(glyphToken('oracle', 'live'), 'ink');
  assert.deepEqual(headOf({ joined: true }, 'live'), { token: 'ink', double: false });
  assert.deepEqual(headOf({}, 'live'), { token: 'rule-2', double: false });
  assert.deepEqual(headOf({ operator: true }, 'live'), { token: 'ink-3', double: true }, 'operator-run: the double outline’s language');
  assert.deepEqual(headOf({ joined: true, operator: true }, 'behind'), { token: 'rule-2', double: true });
});

test('readTokens: every colour and the timings come off :root at draw time; nothing is a literal in the module', () => {
  // The values a browser would return; spelled as tokens.css spells them, read from that file, never typed here.
  const tokensCss = readFileSync(new URL('../../src/chrome/tokens.css', import.meta.url), 'utf8');
  const declared = (name) => tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  const values = { '--ink': ` ${declared('ink')} `, '--rule-2': declared('rule-2'), '--t-shift': '240ms', '--t-cool': '1800ms', '--font-mono': declared('font-mono') };
  const win = { document: { documentElement: {} }, getComputedStyle: () => ({ getPropertyValue: (name) => values[name] ?? '' }) };
  const tokens = readTokens(win);
  assert.equal(tokens.ink, declared('ink'));
  assert.equal(tokens['rule-2'], declared('rule-2'));
  assert.equal(tokens.shift, 240);
  assert.equal(tokens.cool, 1800);
  assert.equal(tokens['font-mono'], declared('font-mono'));
  assert.deepEqual(TOKENS, ['paper', 'paper-2', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-2', 'font-mono'], 'the Ledger’s names, and no hue');
  for (const name of TOKENS.filter((n) => n !== 'font-mono')) assert.ok(declared(name), `--${name} is a token in tokens.css`);
  for (const gone of ['pine-0', 'bone', 'bone-dim', 'sage', 'leader', 'filament', 'vermilion', 'clay']) assert.ok(!TOKENS.includes(gone), `${gone} is gone`);
});

test('the Waterfall draws in the Ledger’s inks only: every glyph on a mock canvas is one of the tokens, the dispute is dashed 2/2 down the rows, and nothing glows', () => {
  const tokensCss = readFileSync(new URL('../../src/chrome/tokens.css', import.meta.url), 'utf8');
  const declared = (name) => tokensCss.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
  const win = {
    document: { hidden: false, documentElement: {} },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ getPropertyValue: (name) => (name === '--t-shift' ? '240ms' : name === '--t-cool' ? '1800ms' : declared(name.slice(2)) ?? '') }),
  };
  const calls = [];
  const context = {
    fillStyle: '', globalAlpha: 1, font: '', textBaseline: '', textAlign: '', shadowBlur: 0, shadowColor: '',
    clearRect() {},
    fillRect(x, y, w, h) { calls.push({ style: this.fillStyle, x, y, w, h }); },
    fillText() {},
  };
  const ctx = { motion: { reduced: () => true, tween: () => () => {} }, fitCanvas: () => () => ({ context, width: 600, height: 400 }) };
  const wf = createWaterfall({}, { ctx, win });
  wf.setAgents([{ address: A, id: 1 }, { address: B, id: 2, name: 'swarm-b' }, { address: C, id: 3 }]);
  wf.setState('live');
  wf.block(100);
  for (const kind of ['agreement', 'message', 'settled', 'dispute', 'oracle', 'registered']) {
    wf.event({ event: { blockNumber: 100 }, row: rowOf(kind), parties: { from: A, to: kind === 'oracle' || kind === 'registered' ? null : C }, key: kind === 'dispute' ? 'd1' : null });
  }
  wf.block(101);
  calls.length = 0; // one whole draw: the field as it stands after block 102
  wf.block(102);
  const inks = new Set(['paper', 'paper-2', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-2'].map(declared));
  assert.ok(calls.length > 0, 'something was drawn');
  for (const call of calls) assert.ok(inks.has(call.style), `a mark drawn in ${call.style}, not a Ledger token`);
  assert.equal(context.shadowBlur, 0, 'no glow');
  // The open dispute continues into the new rows as 2 px dashes at a 4 px pitch, in ink.
  const dashes = calls.filter((c) => c.style === declared('ink') && c.h === 1 && c.w === DASH);
  assert.ok(dashes.length >= 4, 'the dispute line is dashed down the rows');
  const rows = new Map();
  for (const dash of dashes) rows.set(dash.y, [...(rows.get(dash.y) ?? []), dash.x]);
  assert.ok(rows.size >= 2, 'the dashed line repeats on more than one row');
  for (const xs of rows.values()) for (let i = 1; i < xs.length; i += 1) assert.equal(xs[i] - xs[i - 1], 2 * DASH, '2 px on, 2 px off');
  // The operator-run head is a double tick: two 1 px rows at y 0 and 2, in ink-3.
  const heads = calls.filter((c) => c.style === declared('ink-3') && c.h === 1 && (c.y === 0 || c.y === 2));
  assert.ok(heads.some((c) => c.y === 0) && heads.some((c) => c.y === 2), 'a double head for swarm-b');
  // The joined agent's head is printed ink.
  assert.ok(calls.some((c) => c.style === declared('ink') && c.y === 0 && c.h === 1), 'the joined head in ink');
});
