// /network (SITE-REDESIGN.md §5.2): the frame renders the eight sections on
// the shared chrome with every figure a skeleton; the redirect stubs for the
// retired URLs; the event names in plain words, held to the runtime's own
// event list and the indexer's feed; every indexer route the page reads
// exists; and the script's pure parts — the readers, the decoders, the
// derivations and the words for a read that failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_STATS, EMISSION_STATS, ERA_PARAMS, INTRO, SECTIONS, SOURCE_ROWS, STATUS_STATS, embeddedFacts, renderNetwork, renderRedirect } from '../src/network.mjs';
import { SOURCES, STORAGE_KEYS, countSince, failureReason, failureSentences, fetchAllPages, field, pageOf, RpcSocket, Scheduler, API_ORIGIN, RETRY_MS, RPC_URL } from '../src/network/data.js';
import { decodeU32, decodeValidators, headerNumber, storageKey, timestampOf, twox128 } from '../src/network/scale.js';
import { encodeSs58 } from '../src/network/ss58.js';
import { EVENT_NAMES, KINDS, detailsOf, eventName } from '../src/network/events.js';
import { compactCmn, formatBps, formatCmn, formatDuration, nowrap, relativeTime, words } from '../src/network/format.js';
import {
  BLOCKS_PER_HOUR,
  STALE_AFTER_MS,
  activityEmpty,
  agentStatus,
  agentSummary,
  authorOf,
  authoredCounts,
  blockLog,
  hourWindow,
  isOperatorRun,
  nextSettlement,
  openDisputes,
  sinceBlock,
  validatorSet,
  warningText,
} from '../src/network/model.js';
import { COLUMNS, activityRow, agentRow, blockRow, historyRow, readCell, skeletonRows, tr, validatorRow } from '../src/network/rows.js';
import { formatInt, formatUtc } from '../src/chrome/templates.mjs';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = new URL('../../', import.meta.url);
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const facts = readJson('../chain-facts.json');
const history = readJson('../runtime-history.json');
const status = readJson('../public/status.json');
const posture = readJson('../public/posture.json');
const chainEvents = readJson('../chain-events.json');
const builtAt = '2026-10-23T11:32:11.000Z';
const html = renderNetwork({ facts, history, status, posture, builtAt, css: '/*css*/' });
const mainJs = readFileSync(new URL('../src/network/main.js', import.meta.url), 'utf8');

// ── the frame ─────────────────────────────────────────────────────────────────

test('the frame: one h1 "Network", the intro sentence, the eight sections in order, the plain chrome with Network current', () => {
  assert.match(html, /<title>Network — Scalar Commons<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/scalarnet\.io\/network">/);
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(html, /<h1 class="sc-h1">Network<\/h1>/);
  assert.ok(html.includes(INTRO));
  assert.equal(INTRO, 'Live figures read from the public node and the indexer. Every figure names its source at the bottom of the page.');
  const ids = [...html.matchAll(/<section class="sc-section" id="([^"]+)" aria-labelledby="[^"]+"><div class="sc-container"><div class="sc-section-head"><h2 class="sc-h2" id="[^"]+">([^<]+)<\/h2>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ids, SECTIONS);
  assert.deepEqual(
    SECTIONS.map(([, t]) => t),
    ['Status', 'Validators', 'Recent blocks', 'Activity', 'Emissions', 'Agents', 'Runtime history', 'How these figures are read'],
  );
  assert.match(html, /href="\/network" aria-current="page">Network</);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<script type="module" src="network\.js"><\/script>/, 'the page ships one script');
  assert.equal((html.match(/<script type="module"/g) ?? []).length, 1);
  assert.match(html, /<style>\/\*css\*\/<\/style>/, 'the chrome is inlined');
  assert.ok(html.includes('id="activity"'), 'the activity section is linkable: /pulse redirects to it');
  for (const gone of ['nw-', 'reading-value', 'data-reading', 'Observatory', 'Pulse', 'Present', 'SOURCES', '⌘', 'raw ↗', 'blob:', 'instrument']) assert.ok(!html.includes(gone), `the page carries ${gone}`);
  assert.ok(!/<canvas|<svg class="ring|@keyframes|animation:/.test(html), 'nothing is drawn or animated');
});

test('the skeleton contract: every live figure starts as a skeleton the size of its value, never a typed number', () => {
  const stats = [...html.matchAll(/<div class="sc-stat" data-stat="([^"]+)"><span class="sc-stat-label">([^<]+)<\/span><span class="sc-stat-value" data-value>([\s\S]*?)<\/span><span class="sc-stat-caption" data-caption>([\s\S]*?)<\/span><\/div>/g)];
  assert.deepEqual(
    stats.map((m) => m[1]),
    [...STATUS_STATS, ...EMISSION_STATS, ...AGENT_STATS].map((s) => s.key),
  );
  assert.deepEqual(STATUS_STATS.map((s) => s.label), ['Block height', 'Finalized', 'Validators', 'Era', 'Registered agents', 'Open disputes', 'Open agreements', 'Messages sent']);
  assert.equal(STATUS_STATS.length, 8, 'eight stats, two rows of four');
  for (const [, key, , value, caption] of stats) {
    assert.match(value, /^<span class="sc-skeleton" style="width:\d+ch" aria-hidden="true"><\/span><span class="sc-sr">Loading<\/span>$/, `${key} starts as a skeleton`);
    assert.ok(!/\d/.test(caption.replace(/<span class="sc-skeleton"[^>]*><\/span>/g, '')), `${key}'s caption types no figure`);
  }
  // Every stat the frame draws is filled by the script, and every read key in the sources table is stamped by it.
  for (const { key } of [...STATUS_STATS, ...EMISSION_STATS, ...AGENT_STATS]) assert.ok(mainJs.includes(`setStat('${key}'`), `main.js never sets ${key}`);
  for (const [, , key] of SOURCE_ROWS(facts)) assert.ok(mainJs.includes(`stamp('${key}'`), `main.js never stamps ${key}`);
  for (const [key] of ERA_PARAMS) assert.ok(html.includes(`data-param="${key}"`) && (mainJs.includes(`'${key}'`) || key === 'era' || key === 'startBlock'), `the era parameter ${key}`);
  // The tables start as skeleton rows (the runtime history and the sources are records, rendered whole).
  for (const [id, rows] of [['validators-table', facts.state.validators], ['blocks-table', 12], ['activity-table', 5], ['agents-table', 10]]) {
    const table = html.match(new RegExp(`<div class="sc-table-wrap" id="${id}">[\\s\\S]*?</div>`))?.[0] ?? '';
    assert.equal((table.match(/<tr>/g) ?? []).length - 1, rows, `${id} has ${rows} skeleton rows`);
    assert.ok(!/<td[^>]*>[^<]*\d/.test(table), `${id} types no figure`);
  }
  assert.match(html, /<p class="sc-stats-foot" data-updated>Waiting for the first read\.<\/p>/);
  assert.ok(!html.includes('data-warning'), 'no warning until a read fails');
  assert.deepEqual(embeddedFacts(facts), { blockMs: 6000, heartbeatGrace: Number(facts.constants.agents.heartbeatGracePeriod), decimals: 12, symbol: 'CMN', specVersion: facts.provenance.specVersion });
  assert.match(html, /<script type="application\/json" id="network-facts">\{"blockMs":6000,/);
  assert.throws(() => embeddedFacts({ ...facts, constants: { ...facts.constants, babe: { expectedBlockTime: '0' } } }), /blockMs/);
});

test('the runtime history and the sources table are rendered whole from the records, with the three files linked for download', () => {
  for (const u of history.upgrades) {
    assert.ok(html.includes(`>${formatInt(u.specVersion)}</td>`), `spec ${u.specVersion}`);
    assert.ok(html.includes(`href="https://explorer.scalarnet.io/block/${u.appliedAtBlock}">${formatInt(u.appliedAtBlock)}</a>`));
    assert.ok(html.includes(u.summary.replace(/'/g, '&#39;')), `the note of ${u.specVersion}`);
  }
  const order = [...html.matchAll(/<td class="sc-r">(\d{3})<\/td>/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [...order].sort((a, b) => b - a), 'newest first');
  for (const name of ['runtime-history.json', 'status.json', 'posture.json']) assert.ok(html.includes(`<a href="${name}" download="${name}">${name} (download)</a>`), `${name} is linked for download`);
  assert.ok(!/href="[^"]*\.json"(?![^>]*download)/.test(html), 'no JSON file opens in the browser');
  const sources = html.match(/<div class="sc-table-wrap" id="sources-table">[\s\S]*?<\/table>/)?.[0] ?? '';
  for (const [figure, source] of SOURCE_ROWS(facts)) assert.ok(sources.includes(`<td>${figure}</td><td><span class="nk-note">${source.replace(/'/g, '&#39;').replace(/"/g, '&quot;')}</span></td>`), `the sources table names ${figure}`);
  assert.ok(sources.includes('https://api.scalarnet.io/v1') || html.includes('https://api.scalarnet.io/v1'));
  assert.ok(html.includes('wss://rpc.scalarnet.io'));
  assert.ok(sources.includes(`Operator record, updated ${formatUtc(`${status.updated}T00:00:00Z`).replace(/, .*$/, '')}`));
  assert.ok(sources.includes(`Operator record, updated ${formatUtc(`${posture.updated}T00:00:00Z`).replace(/, .*$/, '')}`));
});

test('the filter chips are the six kinds the indexer feeds, All pressed; the explorer links are text buttons', () => {
  assert.deepEqual(KINDS.map((k) => k.label), ['All', 'Agreements', 'Disputes', 'Messages', 'Registrations', 'Slashes']);
  const activity = readFileSync(new URL('indexer/src/activity.ts', repoRoot), 'utf8');
  const kinds = activity.match(/export const ACTIVITY_KINDS = \[([\s\S]*?)\]/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  for (const k of KINDS.slice(1)) assert.ok(kinds.includes(k.value), `${k.value} is a kind the indexer knows`);
  for (const k of KINDS) assert.ok(html.includes(`data-filter="${k.value}" aria-pressed="${k.value === '' ? 'true' : 'false'}">${k.label}</button>`));
  assert.match(html, /class="sc-btn sc-btn-text" href="https:\/\/explorer\.scalarnet\.io\/activity" rel="noopener">All activity in the explorer/);
  assert.match(html, /class="sc-btn sc-btn-text" href="https:\/\/explorer\.scalarnet\.io\/blocks" rel="noopener">Open in explorer/);
  assert.equal((html.match(/sc-btn-primary/g) ?? []).length, 1, 'one primary button on the page: the header’s');
});

test('the redirect stubs: meta refresh to /network and /network#activity, one sentence and a link, no chrome', () => {
  const obs = renderRedirect({ to: '/network', title: 'Network' });
  const pulse = renderRedirect({ to: '/network#activity', title: 'Activity' });
  for (const [stub, to] of [[obs, '/network'], [pulse, '/network#activity']]) {
    assert.match(stub, /^<!doctype html>\n<html lang="en">/);
    assert.match(stub, /<meta charset="utf-8">/);
    assert.ok(stub.includes(`<meta http-equiv="refresh" content="0; url=${to}">`));
    assert.match(stub, /<title>[^<]+ — Scalar Commons<\/title>/);
    assert.ok(stub.includes(`<p>This page has moved to <a href="${to}">`));
    assert.equal((stub.match(/<p>/g) ?? []).length, 1);
    assert.ok(!/sc-header|sc-footer|<nav|<script|<style/.test(stub), 'no legacy chrome, no script');
  }
  assert.match(obs, /<link rel="canonical" href="https:\/\/scalarnet\.io\/network">/);
  assert.match(pulse, /<link rel="canonical" href="https:\/\/scalarnet\.io\/network">/, 'the fragment is not canonical');
});

// ── the event names ───────────────────────────────────────────────────────────

test('event names: plain words, written once, each an event the runtime emits, and every event the indexer’s feed reports has one', () => {
  for (const [key, name] of Object.entries(EVENT_NAMES)) {
    const [section, method] = key.split('.');
    assert.ok(chainEvents.pallets[section]?.includes(method), `${key} is not an event of the runtime at spec ${chainEvents.provenance.specVersion}`);
    assert.match(name, /^[A-Z][a-z]+(?:[ ,][a-z]+)*$/, `"${name}" is not plain sentence-case words`);
    assert.ok(!name.includes('.') && !/[a-z][A-Z]/.test(name), `"${name}" leaks an identifier`);
  }
  const activity = readFileSync(new URL('indexer/src/activity.ts', repoRoot), 'utf8');
  const pairs = [...activity.matchAll(/\{ kind: '[a-z_]+', section: '([a-zA-Z]+)', method: '([A-Za-z]+)' \}/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.ok(pairs.length >= 15, 'the indexer’s feed sources were read');
  for (const pair of pairs) assert.ok(EVENT_NAMES[pair], `${pair} has no plain name`);
  assert.equal(eventName('escrow', 'AgreementCreated'), 'Agreement opened');
  assert.equal(eventName('agents', 'HeartbeatSent'), 'Heartbeat sent');
  assert.equal(eventName('escrow', 'SomethingNew'), 'Something new', 'an event not in the list still reads as words');
  assert.equal(words('DeliveryNotice'), 'Delivery notice');
  assert.equal(words('payload_len'), 'Payload len');
});

test('details are the fields that matter, in words, never an address or a raw field name', () => {
  const buyer = '5EnxpUvAn4y4hmnp88SrNpD25BiD4KsqLyMeufcmic1X6RF7';
  const provider = '5FLMvsLnLjeHx8qVF3shi3J7Nq94kNts4VPLFTwFLVSb6DE4';
  assert.equal(detailsOf({ section: 'escrow', method: 'AgreementCreated', data: { buyer, provider, seq: 14, amount: '20000000000000' } }), '20 CMN, agreement no. 14');
  assert.equal(detailsOf({ section: 'messages', method: 'MessageSent', data: { from: buyer, to: provider, kind: 'DeliveryNotice', payload_len: 292, nonce: '830' } }), 'Delivery notice, 292 bytes');
  assert.equal(detailsOf({ section: 'agents', method: 'AgentRegistered', data: { who: buyer, stake: '1000000000000000', fee: '50000000000000' } }), 'Stake 1,000 CMN, fee 50 CMN');
  assert.equal(detailsOf({ section: 'agents', method: 'HeartbeatSent', data: { who: buyer } }), '');
  assert.equal(detailsOf({ section: 'escrow', method: 'DisputeResolved', data: { buyer, provider, seq: 4, provider_wins: false } }), 'Agreement no. 4, the buyer wins');
  assert.equal(detailsOf({ section: 'escrow', method: 'DisputeOpened', data: { buyer, provider, seq: 1, request_id: '0x868809e66075eed54f0d78dd32c6d8e860c39396e5fe4b2991fe5a58017a1568' } }), 'Agreement no. 1, request 0x868809…1568');
  const generic = detailsOf({ section: 'agents', method: 'SlashExecuted', data: { who: buyer, reason: 'Downtime', count: 3 } });
  assert.equal(generic, 'Reason: Downtime, count: 3');
  for (const text of [generic]) assert.ok(!text.includes(buyer));
  assert.equal(detailsOf({ section: 'x', method: 'y' }), '');
});

// ── what the page reads ───────────────────────────────────────────────────────

test('every indexer route the page reads exists in indexer/src/api.ts, and the storage keys are the named items', () => {
  const api = readFileSync(new URL('indexer/src/api.ts', repoRoot), 'utf8');
  const routes = [...api.matchAll(/path: '(\/v1[^']*)'/g)].map((m) => m[1]);
  const matches = (path) => routes.some((r) => new RegExp(`^${r.replace(/:[a-z]+/gi, '[^/]+')}$`).test(path.replace(/\?.*$/, '')));
  const paths = Object.values(SOURCES).filter((s) => s.kind === 'api').map((s) => s.path);
  assert.ok(paths.length >= 10);
  for (const path of paths) assert.ok(matches(path), `${path} is not a route of the indexer`);
  for (const [, s] of Object.entries(SOURCES).filter(([, s]) => s.kind === 'api')) assert.ok(['live', 'index'].includes(s.reads));
  assert.equal(STORAGE_KEYS.sessionValidators, storageKey('Session', 'Validators'));
  assert.equal(STORAGE_KEYS.stakingValidatorCount, twox128('Staking') + twox128('ValidatorCount').slice(2));
  assert.equal(twox128('Session'), '0xcec5070d609dd3497f72bde07fc96ba0', 'twox128 against a known value');
  assert.equal(SOURCES.newHeads.method, 'chain_subscribeNewHeads');
  assert.equal(SOURCES.finalizedHeads.method, 'chain_subscribeFinalizedHeads');
  assert.equal(API_ORIGIN, 'https://api.scalarnet.io');
  assert.equal(RPC_URL, 'wss://rpc.scalarnet.io');
});

test('the decoders: a u32, a validator list, a header number, the timestamp inherent; a value of the wrong length is an error, never a guess', () => {
  assert.equal(decodeU32('0x08000000'), 8);
  assert.throws(() => decodeU32('0x0800'), /expected 4/);
  const key = new Uint8Array(32).fill(7);
  const hex = `0x04${Buffer.from(key).toString('hex')}`;
  assert.deepEqual(decodeValidators(hex), [key]);
  assert.throws(() => decodeValidators(`${hex}00`), /bytes/);
  assert.equal(headerNumber({ number: '0x11cd71' }), 1166705);
  assert.throws(() => headerNumber({}), /block number/);
  // Block 1,166,831's first extrinsic, read off the node: timestamp.set(1792788642000).
  assert.equal(timestampOf('0x280501000bd0b8876aa101'), 1792788642000);
  assert.throws(() => timestampOf('0x280502000bd0b8876aa101'), /not timestamp\.set/);
  assert.equal(encodeSs58(new Uint8Array(32)), '5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM');
});

test('field refuses a missing key; countSince counts to a block; fetchAllPages walks pages and says whether it read them all', async () => {
  assert.equal(field({ a: { b: 0 } }, 'a.b'), 0);
  assert.throws(() => field({ a: {} }, 'a.b'), /response has no a\.b/);
  assert.throws(() => field({ a: null }, 'a'), /response has no a/);
  assert.deepEqual(countSince([{ blockNumber: 10 }, { blockNumber: 9 }, { blockNumber: 3 }], 5), { count: 2, reachedStart: true });
  assert.deepEqual(countSince([{ blockNumber: 10 }], 5), { count: 1, reachedStart: false });
  const source = { kind: 'api', path: '/v1/agents?limit=2', reads: 'live' };
  assert.equal(pageOf(source, 2), '/v1/agents?limit=2&offset=2');
  const fetcher = async (s, path) => ({ ok: true, at: new Date(), source: s, label: path, data: { total: 3, items: path.includes('offset') ? [{ id: 3 }] : [{ id: 1 }, { id: 2 }] } });
  const all = await fetchAllPages(source, { fetcher });
  assert.deepEqual(all.items.map((i) => i.id), [1, 2, 3]);
  assert.equal(all.complete, true);
  assert.equal(all.pages, 2);
  const short = await fetchAllPages(source, { fetcher, maxPages: 1 });
  assert.equal(short.complete, false);
  const failing = await fetchAllPages(source, { fetcher: async (s, path) => (path.includes('offset') ? { ok: false, error: 'HTTP 502', source: s, at: new Date() } : fetcher(s, path)) });
  assert.equal(failing.ok, false);
  assert.equal(failing.complete, false);
});

test('the scheduler fetches a watched source once per interval for every watcher, pauses while hidden, and discards an answer for a replaced source', async () => {
  const calls = [];
  const scheduler = new Scheduler(async (source) => {
    calls.push(source.path);
    return { ok: true, data: source.path };
  });
  const seen = [];
  scheduler.watch('a', { path: 'one' }, (r) => seen.push(`1:${r.data}`), 60_000);
  scheduler.watch('a', { path: 'one' }, (r) => seen.push(`2:${r.data}`), 60_000);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ['one'], 'two watchers, one fetch');
  assert.deepEqual(seen, ['1:one', '2:one']);
  assert.equal(scheduler.latest('a').data, 'one');
  scheduler.pause();
  scheduler.refresh('a');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ['one'], 'nothing fetches while paused');
  scheduler.resume();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ['one', 'one'], 'resume fetches at once');
  // An in-flight read for a source that was replaced is discarded, and the new source read.
  let release;
  const slow = new Scheduler((source) => (source.path === 'slow' ? new Promise((r) => (release = () => r({ ok: true, data: 'slow' }))) : Promise.resolve({ ok: true, data: source.path })));
  const got = [];
  slow.watch('f', { path: 'slow' }, (r) => got.push(r.data), 60_000);
  await new Promise((r) => setTimeout(r, 5));
  slow.replace('f', { path: 'fast' });
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(got, ['fast'], 'the slow answer never reaches the handler');
  slow.pause();
  scheduler.pause();
  // A failed read is retried after RETRY_MS, not after the watcher's long interval.
  const failing = new Scheduler(async () => ({ ok: false, error: 'HTTP 502' }));
  failing.watch('g', { path: 'g' }, () => {}, 60_000);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(failing.interval(failing.watches.get('g')), RETRY_MS);
  failing.pause();
});

test('the socket: one connection for calls and subscriptions, re-subscribed after a reconnect; a node that closes is a failed record, never a throw', async () => {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.();
      }, 0);
    }
    send(raw) {
      const m = JSON.parse(raw);
      this.sent.push(m);
      if (m.method === 'chain_subscribeNewHeads') this.reply({ id: m.id, result: 'sub-1' });
      else if (m.method === 'state_getStorage') this.reply({ id: m.id, result: '0x08000000' });
      else this.reply({ id: m.id, error: { code: -32601, message: 'no such method' } });
    }
    reply(message) {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', ...message }) }), 0);
    }
    push(number) {
      this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', method: 'chain_newHead', params: { subscription: 'sub-1', result: { number } } }) });
    }
    close() {
      this.readyState = 3;
      setTimeout(() => this.onclose?.({ code: 1000 }), 0);
    }
  }
  const socket = new RpcSocket('wss://example.invalid', { WebSocketImpl: FakeSocket });
  const states = [];
  socket.on('state', ({ state }) => states.push(state));
  const heads = [];
  socket.subscribe(SOURCES.newHeads, (record) => heads.push(record.data.number));
  const read = await socket.call(SOURCES.validatorCount);
  assert.equal(read.ok, true);
  assert.equal(read.data, '0x08000000');
  assert.equal(read.label, 'Staking.ValidatorCount');
  assert.equal(sockets.length, 1, 'calls and subscriptions share one socket');
  sockets[0].push('0x10');
  assert.deepEqual(heads, ['0x10']);
  const bad = await socket.call({ kind: 'rpc', method: 'nope', params: [], label: 'nope' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /RPC error -32601: no such method/);
  socket.pause();
  await new Promise((r) => setTimeout(r, 5));
  const paused = await socket.call(SOURCES.validatorCount);
  assert.equal(paused.ok, false, 'nothing is read while the tab is hidden');
  socket.resume();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sockets.length, 2, 'resume reconnects');
  assert.ok(sockets[1].sent.some((m) => m.method === 'chain_subscribeNewHeads'), 'and re-subscribes');
  assert.deepEqual(states.slice(0, 2), ['connecting', 'open']);
  socket.pause();

  class RefusingSocket {
    constructor() {
      setTimeout(() => this.onclose?.({ code: 1006 }), 0);
    }
    send() {}
    close() {}
  }
  const refused = new RpcSocket('wss://example.invalid', { WebSocketImpl: RefusingSocket });
  const refusedStates = [];
  refused.on('state', ({ state }) => refusedStates.push(state));
  const record = await refused.call(SOURCES.validators);
  assert.equal(record.ok, false);
  assert.equal(record.error, 'the connection closed (code 1006)');
  assert.deepEqual(refusedStates, ['connecting', 'failed', 'closed']);
  assert.equal(failureReason(record), "Can't read Session.Validators from the node (wss://rpc.scalarnet.io): the connection closed (code 1006).");
  refused.pause();
});

// ── the model ─────────────────────────────────────────────────────────────────

const stash = (n) => new Uint8Array(32).fill(n);
const babeKey = (n) => new Uint8Array(32).fill(100 + n);

test('the validator set: active and queued, the BABE authority index mapped to a stash through the queued keys, never guessed', () => {
  const validators = [stash(1), stash(2)];
  const queued = [
    { stash: stash(1), babe: babeKey(1) },
    { stash: stash(2), babe: babeKey(2) },
    { stash: stash(3), babe: babeKey(3) },
  ];
  const babe = [{ key: babeKey(2), weight: 1 }, { key: babeKey(1), weight: 1 }, { key: babeKey(9), weight: 1 }];
  const set = validatorSet({ validators, queued, babe });
  assert.equal(set.active.length, 2);
  assert.deepEqual(set.active.map((v) => v.index), [0, 1]);
  assert.equal(set.active[0].address, encodeSs58(stash(1)));
  assert.equal(set.queued.length, 1);
  assert.equal(set.queued[0].queued, true);
  assert.deepEqual(set.authorities, [set.active[1].stashHex, set.active[0].stashHex, null]);
  const bare = validatorSet({ validators });
  assert.deepEqual(bare.authorities, []);
  assert.equal(bare.active[0].babeHex, null);
  // A BABE pre-runtime digest: 0x06, "BABE", a compact length of 13, variant 2 (secondary plain), authority index 1, slot 0.
  const header = { digest: { logs: ['0x0642414245340201000000' + '0000000000000000'] } };
  const author = authorOf(header, set.authorities);
  assert.equal(author.authorityIndex, 1);
  assert.equal(author.stashHex, set.active[0].stashHex);
  assert.deepEqual(authorOf(header, []), { authorityIndex: 1, stashHex: null });
  assert.equal(authorOf({ digest: { logs: [] } }, set.authorities), null);
  const counts = authoredCounts([{ number: 5, authorHex: 'a' }, { number: 7, authorHex: 'a' }, { number: 6, authorHex: 'b' }, { number: 8, authorHex: null }]);
  assert.deepEqual(counts.get('a'), { count: 2, last: 7 });
  assert.deepEqual(counts.get('b'), { count: 1, last: 6 });
});

test('the block log keeps the newest blocks, merges what each read adds, and never a block without a number', () => {
  const log = blockLog(3);
  log.add({ number: 10, extrinsics: 1 });
  log.add({ number: 11 });
  log.add({ number: 10, authorityIndex: 2, authorRead: true });
  assert.deepEqual(log.get(10), { number: 10, extrinsics: 1, authorityIndex: 2, authorRead: true });
  log.add({ number: 12 });
  log.add({ number: 13 });
  assert.equal(log.size(), 3);
  assert.equal(log.get(10), null, 'the oldest is dropped');
  assert.deepEqual(log.rows(2).map((b) => b.number), [13, 12]);
  assert.equal(log.head(), 13);
  assert.throws(() => log.add({}), /number/);
  assert.equal(blockLog(1).head(), null);
});

test('agents: operator-run by the swarm- prefix, active within the grace period, the status words, the most recent first', () => {
  const grace = 10_800;
  const head = 1_166_000;
  const items = [
    { address: 'A', registeredAtBlock: 100, lastHeartbeatBlock: head - 1, unstakeAtBlock: null, metadata: { name: 'swarm-0001' } },
    { address: 'B', registeredAtBlock: 300, lastHeartbeatBlock: head - grace, unstakeAtBlock: null, metadata: null },
    { address: 'C', registeredAtBlock: 200, lastHeartbeatBlock: head - grace - 1, unstakeAtBlock: null, metadata: { name: 'keith-test' } },
    { address: 'D', registeredAtBlock: 300, lastHeartbeatBlock: 0, unstakeAtBlock: 5, metadata: { name: 'swarm-0002' } },
  ];
  const s = agentSummary(items, { head, grace, disputed: new Set(['A', 'Z']), recent: 3 });
  assert.equal(s.registered, 4);
  assert.equal(s.operatorRun, 2);
  assert.equal(s.active, 2);
  assert.equal(s.inDispute, 1);
  assert.deepEqual(s.recent.map((a) => a.address), ['B', 'D', 'C']);
  assert.ok(isOperatorRun('swarm-0139') && !isOperatorRun('keith') && !isOperatorRun(null));
  assert.deepEqual(agentStatus(items[0], { head, grace, blockMs: 6000 }), { badge: 'Active', text: '' });
  assert.deepEqual(agentStatus(items[2], { head, grace, blockMs: 6000 }), { badge: null, text: 'No heartbeat for 18 h' });
  assert.deepEqual(agentStatus(items[3], { head, grace, blockMs: 6000 }), { badge: null, text: 'Unstaking' });
  assert.deepEqual(agentStatus(items[0], { head: null, grace, blockMs: 6000 }), { badge: null, text: '' }, 'no head, no claim');
});

test('open disputes: every DisputeOpened without a later DisputeResolved for the same agreement, and the agents party to one', () => {
  const ev = (method, blockNumber, buyer, provider, seq, extra = {}) => ({ method, blockNumber, data: { buyer, provider, seq, ...extra } });
  const opened = [ev('DisputeOpened', 900, 'a', 'b', 1), ev('DisputeOpened', 800, 'c', 'd', 2), ev('DisputeOpened', 700, 'a', 'e', 3)];
  const resolved = [ev('DisputeResolved', 850, 'c', 'd', 2, { provider_wins: true })];
  const r = openDisputes(opened, resolved);
  assert.equal(r.count, 2);
  assert.deepEqual([...r.agents].sort(), ['a', 'b', 'e']);
  assert.equal(openDisputes([], []).count, 0);
  // A dispute re-opened after it was resolved is open again.
  assert.equal(openDisputes([ev('DisputeOpened', 900, 'c', 'd', 2)], resolved).count, 1);
});

test('the hour is the index’s newest 600 blocks; the empty sentence names the last event; the era’s settlement is a block and a time', () => {
  assert.equal(BLOCKS_PER_HOUR, 600);
  const h = hourWindow({ chain: { bestBlock: 1_166_752 }, indexer: { syncedHeight: 1_166_750 } }, field);
  assert.deepEqual(h, { since: 1_166_150, to: 1_166_750, best: 1_166_752, behind: 2 });
  assert.throws(() => hourWindow({ chain: {} }, field), /response has no/);
  assert.deepEqual(sinceBlock([{ blockNumber: 10 }, { blockNumber: 5 }], 6), [{ blockNumber: 10 }]);
  assert.equal(activityEmpty([{ blockNumber: 1_165_870 }], formatInt), 'No agent events in the last hour. Last one at block 1,165,870.');
  assert.equal(activityEmpty([{ blockNumber: 7 }], formatInt, 'messages'), 'No messages in the last hour. Last one at block 7.');
  assert.equal(activityEmpty([], formatInt), 'No agent events in the index.');
  const era = { era: 173, startBlock: 1_164_639, durationBlocks: 3600, blocksRemaining: 1486, dueForSettlement: false };
  assert.deepEqual(nextSettlement(era, field, { blockMs: 6000 }), { block: 1_168_239, seconds: 8916, due: false });
  assert.equal(nextSettlement({ ...era, blocksRemaining: 0, dueForSettlement: true }, field, { blockMs: 6000 }).due, true);
});

test('the stale handling: a failed read keeps the figure and names the service and the reason; figures older than 60 s say so', () => {
  const api = { kind: 'api', path: '/v1/status', reads: 'live' };
  const rpc = { kind: 'rpc', method: 'state_getStorage', params: [], label: 'Session.Validators', reads: 'live' };
  assert.equal(failureReason({ source: api, error: 'no answer within 8 s' }), "Can't read /v1/status from the indexer (https://api.scalarnet.io/v1): no answer within 8 s.");
  assert.equal(failureReason({ source: rpc, error: 'the connection closed (code 1006)' }), "Can't read Session.Validators from the node (wss://rpc.scalarnet.io): the connection closed (code 1006).");
  assert.equal(failureReason({ source: { kind: 'socket' }, error: 'the WebSocket connection failed' }), "Can't reach the node (wss://rpc.scalarnet.io): the WebSocket connection failed.");
  const nowMs = Date.parse('2026-10-23T11:33:00.000Z');
  const fresh = nowMs - 10_000;
  assert.equal(warningText({ failures: new Map(), lastOkAt: fresh, nowMs, formatUtc, sentencesOf: failureSentences }), '', 'nothing to say when everything reads');
  const failures = new Map([
    ['status', { source: api, error: 'HTTP 502' }],
    ['era', { source: { ...api, path: '/v1/eras/current' }, error: 'HTTP 502' }],
    ['again', { source: api, error: 'HTTP 502' }],
    ['validators', { source: rpc, error: 'no answer within 8 s' }],
  ]);
  assert.equal(
    warningText({ failures, lastOkAt: fresh, nowMs, formatUtc, sentencesOf: failureSentences }),
    "Can't read /v1/status and /v1/eras/current from the indexer (https://api.scalarnet.io/v1): HTTP 502. Can't read Session.Validators from the node (wss://rpc.scalarnet.io): no answer within 8 s. Values are from 23 Oct 2026, 11:32 UTC.",
    'one sentence per service and reason, then when the values are from',
  );
  assert.deepEqual(
    failureSentences(['/v1/a', '/v1/b', '/v1/c', '/v1/d'].map((path) => ({ source: { ...api, path }, error: 'no connection' }))),
    ["Can't read /v1/a, /v1/b and 2 more from the indexer (https://api.scalarnet.io/v1): no connection."],
  );
  assert.deepEqual(failureSentences([{ source: { kind: 'socket' }, error: 'the WebSocket connection failed' }, { source: rpc, error: 'x' }]), [
    "Can't reach the node (wss://rpc.scalarnet.io): the WebSocket connection failed.",
    "Can't read Session.Validators from the node (wss://rpc.scalarnet.io): x.",
  ]);
  assert.equal(STALE_AFTER_MS, 60_000);
  assert.ok(RETRY_MS <= 12_000, 'a failed read is retried within the status row’s own cadence');
  assert.equal(
    warningText({ failures: new Map(), lastOkAt: nowMs - 90_000, nowMs, formatUtc, sentencesOf: failureSentences }),
    'Values are from 23 Oct 2026, 11:31 UTC; nothing has been read for 2 min.',
  );
  assert.throws(() => warningText({ failures: {}, nowMs, formatUtc, sentencesOf: failureSentences }), /map/);
  // The script: a failed read marks exactly its stats Stale with the chrome's badge, keeps the value, and one callout carries the words.
  assert.match(mainJs, /badge\('Stale'\)/);
  assert.match(mainJs, /callout\(\{ variant: 'warning'/);
  assert.match(mainJs, /if \(v && \$\('\.sc-skeleton', v\)\) \{\s*v\.innerHTML = '—';/, 'a stat never read shows a dash, never zero');
  assert.ok(!/innerHTML = '0'|textContent = '0'/.test(mainJs), 'no zero is written for an unknown');
  assert.equal((mainJs.match(/setInterval\(/g) ?? []).length, 1, 'one timer: the clock for "Updated n s ago" and the ages');
  assert.match(mainJs, /if \(document\.hidden\) return;/, 'the clock does nothing while the tab is hidden');
  assert.match(mainJs, /visibilitychange[\s\S]*scheduler\.pause\(\);\s*paged\.pause\(\);\s*socket\.pause\(\);/, 'nothing polls while the tab is hidden');
  assert.ok(!/requestAnimationFrame|\.animate\(|transition/.test(mainJs), 'nothing animates');
});

// ── formatting and rows ───────────────────────────────────────────────────────

test('formats: relative times that do not break, durations in words, CMN to two decimals with the full value, compact CMN for a stat, basis points', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.equal(relativeTime(now - 4_000, now), nowrap('4 s ago'));
  assert.equal(relativeTime(now - 4 * 60_000, now), nowrap('4 min ago'));
  assert.equal(relativeTime(now - 3 * 3_600_000, now), nowrap('3 h ago'));
  assert.equal(relativeTime(now - 49 * 3_600_000, now), nowrap('2 days ago'));
  assert.equal(relativeTime(now + 5_000, now), nowrap('0 s ago'));
  assert.ok(!relativeTime(now - 4_000, now).includes(' '));
  assert.equal(formatDuration(40), 'about 40 s');
  assert.equal(formatDuration(8916), 'about 2 h 29 min');
  assert.equal(formatDuration(3 * 86_400 + 2 * 3600), 'about 3 days 2 h');
  assert.deepEqual(formatCmn('6054836317050833702831'), { text: '6,054,836,317.05', full: '6,054,836,317.050833702831' });
  assert.deepEqual(formatCmn('1000000000000000000'), { text: '1,000,000', full: '1,000,000' });
  assert.deepEqual(formatCmn('1500000000000'), { text: '1.5', full: '1.5' });
  assert.deepEqual(compactCmn('6054836317050833702831'), { text: '6.05 billion', full: '6,054,836,317.050833702831' });
  assert.deepEqual(compactCmn('100000000000000000000000'), { text: '100 billion', full: '100,000,000,000' });
  assert.deepEqual(compactCmn('1234567000000000000'), { text: '1.23 million', full: '1,234,567' });
  assert.deepEqual(compactCmn('0'), { text: '0', full: '0' });
  assert.equal(formatBps(3000), '30 %');
  assert.equal(formatBps('25'), '0.25 %');
  assert.throws(() => formatBps('x'));
});

test('rows: the chrome’s cells; a pending or finalized badge; the dispute and slash badges; the operator-run badge; an unknown count is a skeleton, not zero', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const addr = '5HpG9w8EBLe5XCrbczpwq5TSXvedjrBGCwqxK1iQ7qUsSWFc';
  assert.deepEqual(Object.keys(COLUMNS), ['validators', 'blocks', 'activity', 'agents', 'history', 'sources']);
  assert.equal(tr(COLUMNS.blocks, ['a', 'b', 'c', 'd', 'e'], ' data-block="1"'), '<tr data-block="1"><td class="sc-r">a</td><td>b</td><td>c</td><td class="sc-r">d</td><td>e</td></tr>');
  assert.equal(skeletonRows(COLUMNS.activity, 2, ['7ch']).length, 2);
  assert.match(skeletonRows(COLUMNS.activity, 1, ['7ch'])[0][0], /width:7ch/);
  const block = { number: 1_166_981, timestampMs: now - 6_000, extrinsics: 1 };
  const pending = blockRow(block, { finalized: 1_166_978, nowMs: now, authorOf: () => ({ address: addr }) });
  assert.match(pending[0], /href="https:\/\/explorer\.scalarnet\.io\/block\/1166981">1,166,981</);
  assert.match(pending[1], /<time datetime="2026-10-23T11:59:54\.000Z" title="23 Oct 2026, 11:59 UTC" data-rel>6 s ago<\/time>/);
  assert.match(pending[2], /sc-addr[\s\S]*href="https:\/\/explorer\.scalarnet\.io\/account\/5HpG9w[^"]+" title="5HpG9w[^"]+">5HpG9w…SWFc</);
  assert.equal(pending[3], '1');
  assert.match(pending[4], /sc-badge-warn">Pending/);
  assert.match(blockRow(block, { finalized: 1_166_981, nowMs: now, authorOf: () => null })[4], /sc-badge-ok">Finalized/);
  assert.match(blockRow(block, { finalized: null, nowMs: now, authorOf: () => null })[2], /sc-skeleton/, 'an unread author is a skeleton');
  assert.match(blockRow(block, { finalized: null, nowMs: now, authorOf: () => false })[2], /Unknown/);
  assert.match(blockRow(block, { finalized: null, nowMs: now, authorOf: () => ({ authorityIndex: 3 }) })[2], /Not mapped/);
  assert.match(blockRow(block, { finalized: null, nowMs: now, authorOf: () => ({ failed: "Can't read x" }) })[2], /title="Can&#39;t read x">Not read</);
  assert.match(blockRow({ number: 1, timestampMs: now }, { finalized: null, nowMs: now, authorOf: () => null })[3], /sc-skeleton/, 'unread extrinsics are a skeleton, not 0');
  const dispute = activityRow({ section: 'escrow', method: 'DisputeOpened', kind: 'dispute', timestampMs: now - 60_000, blockNumber: 5, agents: [addr], data: { seq: 2 } }, now);
  assert.match(dispute[0], /1 min ago/);
  assert.match(dispute[1], /^Dispute opened <span class="sc-badge sc-badge-bad">Dispute<\/span>$/);
  assert.match(dispute[2], /5HpG9w…SWFc/);
  assert.equal(dispute[3], '<span class="nk-note">Agreement no. 2</span>');
  assert.match(activityRow({ section: 'agents', method: 'SlashExecuted', kind: 'slash', timestampMs: null, blockNumber: 5, agents: [], data: {} }, now)[0], /block\/5">5</, 'no chain time: the block, linked');
  assert.equal(activityRow({ section: 'agents', method: 'HeartbeatSent', kind: 'heartbeat', timestampMs: now, blockNumber: 5, agents: [addr], data: { who: addr } }, now)[1], 'Heartbeat sent');
  const ctx = { head: 1_166_000, grace: 10_800, blockMs: 6000 };
  const op = agentRow({ address: addr, registeredAtBlock: 890_908, lastHeartbeatBlock: 1_166_000, unstakeAtBlock: null, metadata: { name: 'swarm-0139' } }, ctx);
  assert.match(op[0], /^swarm-0139 <span class="sc-addr">/);
  assert.match(op[1], /block\/890908">890,908</);
  assert.match(op[2], /sc-badge">Operator-run/);
  assert.match(op[3], /sc-badge-ok">Active/);
  const quiet = agentRow({ address: addr, registeredAtBlock: 1, lastHeartbeatBlock: 1, unstakeAtBlock: null, metadata: null }, ctx);
  assert.equal(quiet[2], '');
  assert.match(quiet[3], /^No heartbeat for/);
  const v = { index: 0, address: addr, stashHex: '0xaa', queued: false };
  assert.match(validatorRow(v, new Map(), { windowSize: 0 })[3], /sc-skeleton/, 'no blocks read: the count is unknown');
  assert.equal(validatorRow(v, new Map(), { windowSize: 48 })[3], '0', 'blocks read, none by this validator: zero is a fact');
  assert.deepEqual(validatorRow(v, new Map([['0xaa', { count: 7, last: 1_166_979 }]]), { windowSize: 48 }).slice(3), ['7', '<a href="https://explorer.scalarnet.io/block/1166979">1,166,979</a>']);
  assert.match(validatorRow({ ...v, queued: true }, new Map(), { windowSize: 48 })[2], /sc-badge-warn">Queued/);
  assert.deepEqual(historyRow({ specVersion: 309, appliedAtBlock: 907_929, date: '2026-10-05', summary: 'Agent messaging.' }), ['309', '<a href="https://explorer.scalarnet.io/block/907929">907,929</a>', nowrap('5 Oct 2026'), '<span class="nk-note">Agent messaging.</span>']);
  assert.equal(readCell(1_166_981, '2026-10-23T21:05:00.000Z'), `1,166,981 · ${nowrap('23 Oct 2026, 21:05 UTC')}`);
  assert.equal(readCell(null, '2026-10-23T21:05:00.000Z'), nowrap('23 Oct 2026, 21:05 UTC'));
});

// ── the build ─────────────────────────────────────────────────────────────────

test('the build emits network.html and network.js, the two redirect stubs, the three records; the observatory and pulse bundles are gone', () => {
  const out = mkdtempSync(join(tmpdir(), 'landing-network-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: landingDir, env: { ...process.env, LANDING_OUT_DIR: out }, stdio: 'pipe' });
  const files = readdirSync(out);
  for (const name of ['network.html', 'network.js', 'observatory.html', 'pulse.html', 'runtime-history.json', 'posture.json', 'status.json']) assert.ok(files.includes(name), `no ${name}`);
  for (const name of ['observatory.js', 'observatory-graph.js', 'observatory.css', 'pulse.js', 'pulse.css']) assert.ok(!files.includes(name), `${name} is still built`);
  for (const name of ['runtime-history.json', 'posture.json', 'status.json']) {
    const source = name === 'runtime-history.json' ? `../${name}` : `../public/${name}`;
    assert.equal(readFileSync(join(out, name), 'utf8'), readFileSync(new URL(source, import.meta.url), 'utf8'), `${name} is copied byte for byte`);
  }
  const page = readFileSync(join(out, 'network.html'), 'utf8');
  assert.match(page, /<title>Network — Scalar Commons<\/title>/);
  assert.match(page, /<style>:root\{/, 'the chrome is inlined, minified');
  assert.match(page, /\.nk-note\{display:block;min-width:24ch/, 'with the page’s one rule');
  assert.ok(!/Source Serif|IBM Plex|chrome-legacy/.test(page), 'the plain chrome only');
  const js = readFileSync(join(out, 'network.js'), 'utf8');
  assert.ok(js.length < 60_000, `network.js is ${js.length} bytes`);
  assert.ok(page.length + js.length < 150_000, 'page and script under the budget before fonts');
  assert.ok(!/d3-|force-graph|gsap/.test(js), 'no library rides in the bundle');
  assert.match(readFileSync(join(out, 'observatory.html'), 'utf8'), /url=\/network"/);
  assert.match(readFileSync(join(out, 'pulse.html'), 'utf8'), /url=\/network#activity"/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  // d3-shape stays only while the transitional Ledger chrome's curve (chrome-legacy/curve.mjs, the old home page) imports it.
  for (const dep of ['d3', 'd3-array', 'd3-force', 'd3-scale', 'force-graph', 'gsap']) assert.ok(!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep], `${dep} is still a dependency`);
  assert.ok(!pkg.scripts['dev:instrument']);
  for (const gone of ['src/pulse', 'src/pulse.mjs', 'src/pulse.css', 'src/observatory.css', 'src/observatory/instruments', 'src/observatory/presenter.js', 'src/observatory/motion.js', 'src/observatory/reveal.js', 'src/observatory/daybar.js', 'src/observatory/hour.js', 'src/observatory/spine.js', 'src/observatory/hero.js', 'src/observatory/statusbar.js', 'src/observatory/readout.js', 'scripts/dev-instrument.mjs']) {
    assert.ok(!existsSync(join(landingDir, gone)), `${gone} still exists`);
  }
});
