// Tests for /observatory — the one page on this site that reads the chain live.
//
// The landing page's rule is "no figure written by hand". The observatory keeps
// it the other way round: its figures are fetched in the browser, so the build
// must ship no figure at all in a reading slot, every endpoint and field the
// script reads must exist in the indexer it reads them from, and the only
// numbers the build does carry — the runtime upgrade record and the security
// posture record — must be labelled as records and agree with the files
// checked into the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_ORIGIN, RPC_URL, GITHUB_COMMITS_URL, SOURCES, STORAGE_KEYS } from '../src/observatory/data.js';
import { twox128 } from '../src/observatory/scale.js';
import { renderSection, railPositions } from '../src/observatory.mjs';
import { contrast } from './lib/contrast.mjs';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = new URL('../../', import.meta.url);
const readRepoFile = (relPath) => readFileSync(new URL(relPath, repoRoot), 'utf8');
const history = JSON.parse(readFileSync(new URL('../runtime-history.json', import.meta.url), 'utf8'));
const posture = JSON.parse(readFileSync(new URL('../public/posture.json', import.meta.url), 'utf8'));
const status = JSON.parse(readFileSync(new URL('../public/status.json', import.meta.url), 'utf8'));

/** Every client-side source file the bundle is built from. */
function clientSources() {
  const dir = fileURLToPath(new URL('../src/observatory/', import.meta.url));
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) files.push(p);
    }
  };
  walk(dir);
  return files.map((p) => [p.replace(dir, ''), readFileSync(p, 'utf8')]);
}

function build() {
  const out = mkdtempSync(join(tmpdir(), 'landing-observatory-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: landingDir,
    env: { ...process.env, LANDING_OUT_DIR: out },
    stdio: 'pipe',
  });
  return out;
}

const out = build();
const page = readFileSync(join(out, 'observatory.html'), 'utf8');
const index = readFileSync(join(out, 'index.html'), 'utf8');
const bundle = readFileSync(join(out, 'observatory.js'), 'utf8');

test('the build emits the observatory page, its bundle, stylesheet, fonts and records', () => {
  const files = readdirSync(out);
  for (const name of ['observatory.html', 'observatory.js', 'observatory.css', 'runtime-history.json', 'posture.json', 'status.json', 'fonts']) {
    assert.ok(files.includes(name), `build produced no ${name} (got: ${files.join(', ')})`);
  }
  const fonts = readdirSync(join(out, 'fonts'));
  for (const face of ['source-serif-4', 'inter', 'jetbrains-mono']) {
    assert.ok(fonts.some((f) => f.startsWith(face) && f.endsWith('.woff2')), `no ${face} woff2 in dist/fonts`);
  }
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /<script type="module" src="observatory\.js"><\/script>/);
  // The stylesheet is inlined for first paint; the same bytes ship as a file.
  const css = readFileSync(join(out, 'observatory.css'), 'utf8');
  assert.ok(page.includes(`<style>${css}</style>`), 'observatory.html must inline observatory.css verbatim');
  // Served as /observatory by nginx `try_files $uri.html` and by GitHub Pages,
  // so every asset reference is relative to the site root.
  assert.ok(!/(?:src|href)="\/(?!\/)/.test(page), 'observatory.html must not use root-absolute paths');
  // The bundle is one file, minified, and small enough for the first-paint budget.
  assert.ok(bundle.length < 180 * 1024, `observatory.js is ${(bundle.length / 1024).toFixed(0)} kB; the budget is 180 kB`);
  assert.ok(!/from\s+["']d3/.test(bundle), 'the bundle must not leave bare d3 imports unresolved');
});

test('the site nav links the observatory, and the landing page stays script-free', () => {
  assert.match(index, /<nav[^>]*>[\s\S]*<a href="observatory">Observatory<\/a>[\s\S]*<\/nav>/);
  assert.match(page, /<nav[^>]*>[\s\S]*<a href="observatory" aria-current="page">Observatory<\/a>[\s\S]*<\/nav>/);
  assert.ok(!/<script/i.test(index), 'index.html must stay script-free');
});

test('no reading ships with a value: every figure on the page is fetched, not built in', () => {
  const values = [...page.matchAll(/<(?:p|span) class="reading-value[^"]*"[^>]*>([\s\S]*?)<\/(?:p|span)>/g)].map((m) => m[1]);
  assert.ok(values.length >= 20, `expected every reading to have a value slot, found ${values.length}`);
  for (const value of values) {
    assert.ok(!/\d/.test(value.replace(/<[^>]+>/g, '')), `a reading ships a built-in figure: ${value}`);
  }
  const readings = [...page.matchAll(/<(?:div|figure) class="[^"]*reading[^"]*" data-reading="([^"]+)"[\s\S]*?<p class="reading-prov">/g)];
  assert.ok(readings.length >= 18, `found ${readings.length} readings`);
  for (const [block, key] of readings) {
    assert.match(block, /class="[^"]*\breading-label\b/, `${key} has no label`);
  }
});

test('every reading in the page is fed by a source the data layer knows', () => {
  const keys = new Set([...page.matchAll(/data-reading="([^"]+)"/g)].map((m) => m[1]));
  const fed = new Set(Object.values(SOURCES).flatMap((source) => source.readings));
  for (const key of keys) {
    assert.ok(fed.has(key), `reading "${key}" has no source in data.js`);
  }
});

test('the three records on the page are labelled as records, and the posture record invents nothing', () => {
  // The posture record now sits inside Verify, collapsed with the sources; the upgrade rail's sentence says it is a record.
  const verify = page.match(/<section id="verify"[\s\S]*?<\/section>/)[0];
  assert.match(verify, /<div class="posture-record" data-record="true">/);
  assert.match(verify, /Record, not live/);
  assert.match(page.match(/<section id="upgrades"[\s\S]*?<\/section>/)[0], /checked-in record/);
  for (const [key, entry] of Object.entries(posture.fields)) {
    assert.ok('value' in entry && 'asOf' in entry && 'todo' in entry, `posture field ${key} is missing value/asOf/todo`);
    if (entry.value === null) {
      assert.match(entry.todo, /^TODO\(owner\)/, `posture field ${key} has no value and no TODO for the owner`);
      assert.match(page, new RegExp(`data-posture="${key}" data-recorded="false"[\\s\\S]*?not yet recorded`));
    }
  }
  // A posture value slot carries no digits unless a value was recorded.
  const strip = page.match(/<dl class="posture">[\s\S]*?<\/dl>/)[0];
  const rows = [...strip.matchAll(/<dd>([\s\S]*?)<\/dd>/g)];
  assert.equal(rows.length, 4);
  for (const [, value] of rows) {
    const text = value.replace(/<[^>]+>/g, '');
    if (text.includes('not yet recorded')) assert.ok(!/\d/.test(text), `posture shows a number with nothing recorded: ${text}`);
    else assert.match(text, /as of \d{4}-\d{2}-\d{2}/, 'a recorded value carries its date');
  }
  // A recorded value is traceable to a document in this repository, and the page names it.
  for (const [key, entry] of Object.entries(posture.fields)) {
    if (entry.value === null) continue;
    assert.match(entry.asOf, /^\d{4}-\d{2}-\d{2}$/, `${key} has no date`);
    assert.ok(typeof entry.source === 'string' && entry.source.length > 20, `${key} names no source`);
    assert.ok(page.includes(`<span class="posture-value">${entry.value}</span>`), `${key} is not on the page`);
    assert.ok(page.includes(entry.source.slice(0, 40).replace(/&/g, '&amp;').replace(/'/g, '&#39;')), `${key}'s source is not on the page`);
  }
  // The two numbers recorded today, each in the document it cites.
  assert.equal(posture.fields.findingsExamined.value, 382);
  assert.match(readRepoFile('TESTNETAUDIT.md'), /\*\*382 findings\*\* from 17 auditors/);
  assert.equal(posture.fields.fixedIn307.value, 4);
  const escrow = readRepoFile('pallets/escrow/src/lib.rs');
  for (const name of ['MaxAgreementSpan', 'SpanTooLong']) assert.ok(escrow.includes(name), `pallets/escrow lacks ${name}, which the 307 record cites`);
  assert.ok(readRepoFile('pallets/agents/src/lib.rs').includes('NoSuchSlash'), 'pallets/agents lacks NoSuchSlash, which the 307 record cites');
});

test('the 307 record says what is on chain: no consent or expiry calls, which came to the source later (#233) and are not claimed for 307', () => {
  const spec307 = history.upgrades.find((u) => u.specVersion === 307);
  assert.doesNotMatch(spec307.summary, /consent|expiry|expire/i, 'the consent and expiry calls are not in the 307 runtime');
  assert.match(spec307.summaryNote, /accept_agreement/);
  // The calls are in the runtime's source now (pull request #233, 2026-10-01), for a later runtime; the record says so.
  for (const name of ['accept_agreement', 'expire_agreement', 'reject_agreement', 'cancel_pending']) {
    assert.ok(readRepoFile('pallets/escrow/src/lib.rs').includes(`fn ${name}`), `pallets/escrow no longer has ${name}: revisit the 307 record's note`);
  }
  assert.match(spec307.summaryNote, /#233/, 'the note names the pull request that added the calls to the source');
  assert.match(spec307.summaryNote, /not on chain at 307/);
});

test('the upgrade record: 305, 306, 307, 309 all applied, each agreeing with its file', () => {
  assert.deepEqual(
    history.upgrades.map((u) => [u.specVersion, u.status]),
    [
      [305, 'applied'],
      [306, 'applied'],
      [307, 'applied'],
      // 309 went to prod at block 907929 on 2026-10-05.
      [309, 'applied'],
    ],
  );
  for (const upgrade of history.upgrades.filter((u) => u.status === 'applied')) {
    assert.match(upgrade.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isInteger(upgrade.appliedAtBlock) && upgrade.appliedAtBlock > 0);
    assert.match(upgrade.blockHash, /^0x[0-9a-f]{64}$/);
    assert.match(upgrade.wasm.sha256, /^[0-9a-f]{64}$/);
    assert.match(upgrade.wasm.blake2_256, /^0x[0-9a-f]{64}$/);
    assert.ok(upgrade.summary.length > 0 && upgrade.summary.length <= 140, `${upgrade.specVersion} summary is not one line`);
  }
  for (const upgrade of history.upgrades.filter((u) => u.recordFile)) {
    const record = readRepoFile(upgrade.recordFile);
    assert.ok(record.includes(`spec ${upgrade.specVersion}`), `${upgrade.recordFile} is not about spec ${upgrade.specVersion}`);
    assert.ok(record.includes(`#${upgrade.appliedAtBlock}`), `${upgrade.recordFile} never names block #${upgrade.appliedAtBlock}`);
    assert.ok(record.includes(upgrade.blockHash), `${upgrade.recordFile} never names block hash ${upgrade.blockHash}`);
    assert.ok(record.includes(upgrade.wasm.blake2_256), `${upgrade.recordFile} never names ${upgrade.wasm.blake2_256}`);
  }
  const spec307 = history.upgrades.find((u) => u.specVersion === 307);
  assert.equal(spec307.appliedAtBlock, 813625);
  assert.equal(spec307.wasm.sha256, '0b515ea41bb3b1134072dc696b95d2ce85cf671bf89fc460d8fb20b7cd196d6c');
  for (const upgrade of history.upgrades.filter((u) => u.summarySource)) readRepoFile(upgrade.summarySource);
});

test('the upgrade rail renders every row with its hash in full, copyable, and a chain confirmation slot', () => {
  // The chrome's Rail: one entry per row, newest on top, the one in force lit.
  const rail = page.match(/<ol class="nw-rail upgrade-rail">[\s\S]*?<\/ol>/)?.[0] ?? '';
  assert.ok(rail, 'the upgrades are a Rail');
  for (const upgrade of history.upgrades) {
    assert.match(rail, new RegExp(`<div class="upgrade" data-spec="${upgrade.specVersion}" data-status="${upgrade.status}"`));
    if (upgrade.wasm) {
      assert.ok(page.includes(upgrade.wasm.sha256), `sha256 for ${upgrade.specVersion} not rendered in full`);
      assert.ok(page.includes(`data-copy="${upgrade.wasm.sha256}"`), `sha256 for ${upgrade.specVersion} has no copy control`);
      assert.ok(page.includes(`data-confirm-block="${upgrade.appliedAtBlock}"`), `${upgrade.specVersion} has no chain-confirmation slot`);
      assert.ok(rail.includes(`SEALED · BLOCK ${upgrade.appliedAtBlock.toLocaleString('en-US')}`), `${upgrade.specVersion} has no block under its tick`);
    }
  }
  // Newest on top; exactly one lit tick, on the runtime in force; the rest sage.
  const specs = [...rail.matchAll(/data-spec="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(specs, history.upgrades.map((u) => u.specVersion).reverse());
  assert.equal((rail.match(/nw-rail-tick is-newest/g) ?? []).length, 1);
  assert.equal((rail.match(/nw-rail-tick is-final/g) ?? []).length, history.upgrades.filter((u) => u.status === 'applied').length - 1);
  assert.ok(railPositions(4).length === 4, 'the horizontal positions helper is kept for the library');
  assert.match(section('upgrades'), /<p class="nw-small nw-dim upgrade-gap">308 was never shipped<\/p>/);
});

test('the script reads only indexer endpoints that exist, with fields the indexer emits', () => {
  const api = readRepoFile('indexer/src/api.ts');
  const routes = [...api.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  const toPattern = (route) => new RegExp(`^${route.replace(/:[a-z]+/g, '[^/]+')}$`);
  const indexerSources = Object.entries(SOURCES).filter(([, source]) => source.kind === 'api');
  assert.ok(indexerSources.length >= 10);
  for (const [name, source] of indexerSources) {
    const path = new URL(source.path, API_ORIGIN).pathname;
    assert.ok(routes.some((route) => toPattern(route).test(path)), `source "${name}" reads ${path}, which indexer/src/api.ts does not serve`);
    const limit = new URL(source.path, API_ORIGIN).searchParams.get('limit');
    if (limit !== null) assert.ok(Number(limit) <= 200, `source "${name}" asks for limit=${limit}; the indexer caps at 200`);
  }
  const indexer = api + readRepoFile('indexer/src/chainState.ts') + readRepoFile('indexer/src/store.ts');
  // `field(data, '…')` and any reader built on it (`erasField(item, '…')`).
  const paths = clientSources().flatMap(([, src]) => [...src.matchAll(/[fF]ield\([^,]+, '([^']+)'\)/g)].map((m) => m[1]));
  assert.ok(paths.length >= 15, `expected the instruments to read fields through field(), found ${paths.length}`);
  for (const path of new Set(paths)) {
    for (const segment of path.split('.').filter((s) => !/^\d+$/.test(s))) {
      // JSON-RPC and GitHub envelopes are not the indexer's; their keys are checked where they are read.
      if (['result', 'commit', 'committer', 'date', 'sha', 'html_url', 'peers', 'isSyncing', 'best', 'background', 'prevotes', 'precommits', 'missing', 'round', 'setId', 'totalWeight', 'thresholdWeight', 'currentWeight'].includes(segment)) continue;
      assert.ok(new RegExp(`\\b${segment}\\b`).test(indexer), `field "${path}" — "${segment}" is not in the indexer source`);
    }
  }
  // Event sections and methods named in sources exist in the pallets.
  const pallets = {
    escrow: readRepoFile('pallets/escrow/src/lib.rs'),
    agents: readRepoFile('pallets/agents/src/lib.rs'),
    messages: readRepoFile('pallets/messages/src/lib.rs'),
    oracle: readRepoFile('pallets/oracle/src/lib.rs'),
  };
  for (const [name, source] of indexerSources) {
    const params = new URL(source.path, API_ORIGIN).searchParams;
    const section = params.get('section');
    const method = params.get('method');
    if (!section || !method || section === 'system') continue;
    assert.ok(pallets[section], `source "${name}" names pallet "${section}", which is not one this test knows`);
    assert.ok(new RegExp(`\\b${method}\\s*\\{`).test(pallets[section]), `source "${name}": pallets/${section} emits no ${method} event`);
  }
});

test('every event the page counts is one the runtime declares, read from its own metadata (chain-events.json)', () => {
  const metadata = JSON.parse(readFileSync(new URL('../chain-events.json', import.meta.url), 'utf8'));
  assert.equal(metadata.provenance.specName, 'scalar-commons');
  assert.ok(metadata.provenance.specVersion >= 307 && /^0x[0-9a-f]{64}$/.test(metadata.provenance.genesisHash), 'the record says which runtime it was read from');
  // A reading fenced to a later runtime (`data-min-spec`, hidden below it) may count an event this runtime
  // does not have yet: it is checked against its pallet's source instead, and must really be fenced.
  const fence = new Map([...page.matchAll(/data-reading="([^"]+)" data-min-spec="(\d+)"/g)].map((m) => [m[1], Number(m[2])]));
  for (const [name, source] of Object.entries(SOURCES)) {
    if (source.kind !== 'api' || !source.path.startsWith('/v1/events?')) continue;
    const params = new URL(source.path, API_ORIGIN).searchParams;
    const section = params.get('section');
    const method = params.get('method');
    const fences = (source.readings ?? []).map((key) => fence.get(key));
    if (!metadata.pallets[section] && fences.length && fences.every((min) => min > metadata.provenance.specVersion)) {
      const pallet = readRepoFile(`pallets/${section}/src/lib.rs`);
      assert.ok(new RegExp(`\\b${method}\\s*\\{`).test(pallet), `source "${name}": pallets/${section} emits no ${method}`);
      continue;
    }
    assert.ok(metadata.pallets[section], `source "${name}": the runtime has no pallet "${section}"`);
    assert.ok(metadata.pallets[section].includes(method), `source "${name}": ${section} emits no ${method} (it emits ${metadata.pallets[section].join(', ')})`);
  }
  // The last hour's settlements are DeliveryConfirmed: the runtime has no AgreementSettled.
  assert.equal(SOURCES.deliveriesConfirmed.path, '/v1/events?section=escrow&method=DeliveryConfirmed&limit=200');
  assert.ok(SOURCES.deliveriesConfirmed.readings.includes('hourSettled'));
  assert.ok(!metadata.pallets.escrow.includes('AgreementSettled'));
});

test('the raw storage locations are computed from their names, never pasted', () => {
  // twox128 of the names, checked one name at a time against the values every
  // Substrate client derives (System and Account are the textbook vectors).
  assert.equal(twox128('System'), '0x26aa394eea5630e07c48ae0c9558cef7');
  assert.equal(twox128('Account'), '0xb99d880ec681799c0cf30e8886371da9');
  assert.equal(twox128('Session'), '0xcec5070d609dd3497f72bde07fc96ba0');
  assert.equal(twox128('Validators'), '0x88dcde934c658227ee1dfafcd6e16903');
  assert.equal(twox128('Babe'), '0x1cb6f36e027abb2091cfb5110ab5087f');
  assert.equal(twox128('Authorities'), '0x5e0621c4869aa60c02be9adcc98a0d1d');
  assert.equal(STORAGE_KEYS.sessionValidators, twox128('Session') + twox128('Validators').slice(2));
  assert.equal(STORAGE_KEYS.sessionQueuedKeys, twox128('Session') + twox128('QueuedKeys').slice(2));
  assert.equal(STORAGE_KEYS.babeAuthorities, twox128('Babe') + twox128('Authorities').slice(2));
  assert.equal(STORAGE_KEYS.sessionValidators.length, 2 + 64);
  // No 32-byte hex literal anywhere in the client: a storage location pasted
  // in is indistinguishable from a private key to a reader or a scanner.
  for (const [file, src] of clientSources()) {
    assert.ok(!/0x[0-9a-f]{64}/i.test(src), `${file} contains a 32-byte hex literal`);
  }
});

test('the script contacts only the chain API, the chain RPC and GitHub', () => {
  assert.equal(API_ORIGIN, 'https://api.scalarnet.io');
  // WebSocket, not HTTPS POST: rpc.scalarnet.io answers POSTs with
  // Access-Control-Allow-Origin twice (node --rpc-cors plus nginx), which
  // browsers reject. A WebSocket handshake is not subject to CORS.
  assert.equal(RPC_URL, 'wss://rpc.scalarnet.io');
  assert.equal(new URL(GITHUB_COMMITS_URL).origin, 'https://api.github.com');
  assert.match(GITHUB_COMMITS_URL, /\/repos\/tejaspatil1936\/scalar-commons-v4\/commits\?sha=master/);
  const allowed = new Set(['api.scalarnet.io', 'rpc.scalarnet.io', 'api.github.com', 'github.com', 'explorer.scalarnet.io', 'scalarnet.io']);
  for (const [file, src] of clientSources()) {
    const hosts = new Set([...src.matchAll(/(?:https|wss):\/\/([a-z0-9.-]+)/g)].map((m) => m[1]));
    for (const host of hosts) assert.ok(allowed.has(host), `${file} references ${host}`);
  }
});

test('no instrument loops forever or ignores reduced motion', () => {
  for (const [file, src] of clientSources()) {
    assert.ok(!/setInterval\(/.test(src) || file === 'main.js', `${file} uses setInterval; use ctx.watch so it pauses when hidden`);
    assert.ok(!/animation-iteration-count|infinite/.test(src), `${file} declares an infinite animation`);
  }
  const css = readFileSync(new URL('../src/observatory.css', import.meta.url), 'utf8');
  assert.ok(!/infinite/.test(css), 'observatory.css declares an infinite animation');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // One theme: the light scheme is gone (brief §2.1).
  assert.ok(!/prefers-color-scheme: light/.test(css), 'observatory.css still carries a light scheme');
  // Extended to the new components: the instruments' sheets, the spine, the
  // lamp and the chrome's behaviour loop nothing. The one permitted loop is
  // the loading leader (`nw-travel`) in chrome.css, only while a Reading loads,
  // and it stops under reduced motion.
  for (const name of readdirSync(new URL('../src/observatory/instruments/', import.meta.url)).filter((n) => n.endsWith('.css'))) {
    const sheet = readFileSync(new URL(`../src/observatory/instruments/${name}`, import.meta.url), 'utf8');
    assert.ok(!/infinite|@keyframes/.test(sheet), `${name} declares an animation`);
  }
  const chrome = readFileSync(new URL('../src/chrome/chrome.css', import.meta.url), 'utf8');
  const loops = [...chrome.matchAll(/animation:[^;]*infinite/g)];
  assert.equal(loops.length, 1, 'the chrome has one loop');
  assert.match(chrome, /\.nw-reading\.is-loading \.nw-leader::before \{[^}]*animation: nw-travel[^}]*infinite/);
  assert.match(chrome.slice(chrome.indexOf('@media (prefers-reduced-motion: reduce)')), /\.nw-reading\.is-loading \.nw-leader::before \{ display: none; \}/);
  const chromeBehaviour = fileURLToPath(new URL('../src/chrome/behaviour/', import.meta.url));
  for (const name of readdirSync(chromeBehaviour)) {
    const src = readFileSync(join(chromeBehaviour, name), 'utf8');
    assert.ok(!/requestAnimationFrame\(function loop|animation-iteration-count|infinite/.test(src), `${name} declares a loop`);
  }
  assert.ok(!/setInterval\(/.test(readFileSync(new URL('../src/observatory/spine.js', import.meta.url), 'utf8')), 'the spine ticks on the bus only');
});

const css = readFileSync(new URL('../src/observatory.css', import.meta.url), 'utf8');
const allCss = css + readdirSync(new URL('../src/observatory/instruments/', import.meta.url))
  .filter((name) => name.endsWith('.css'))
  .map((name) => readFileSync(new URL(`../src/observatory/instruments/${name}`, import.meta.url), 'utf8'))
  .join('\n');
/** The declarations of the first rule whose selector is exactly `selector`. */
const rule = (selector, source = css) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const section = (id) => page.match(new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? '';

test('renderSection renders each section on its own for the harness', () => {
  for (const name of ['chain', 'economy', 'validators', 'history', 'upgrades', 'verify']) {
    const html = renderSection(name, { history, posture, status });
    assert.match(html, new RegExp(`<section id="${name}"`));
  }
  assert.throws(() => renderSection('nope', { history, posture, status }), /no section named/);
});

test('one URL: no ?sky and no ?present, and no three.js, GSAP or WebGL anywhere in the page, its bundle or its manifest', () => {
  const sources = clientSources();
  assert.ok(!sources.some(([file]) => /^sky/.test(file)), 'the sky modules are gone');
  for (const [file, src] of sources) {
    assert.ok(!/location\.search|URLSearchParams|[?&](?:sky|present)=/.test(src), `${file} still reads a URL flag`);
    assert.ok(!/from ['"](?:three|gsap)/.test(src) && !/import\(['"]\.\/sky/.test(src), `${file} still loads the sky`);
  }
  assert.ok(!/location\.search/.test(page), 'no script in the page reads the URL');
  for (const word of ['WebGLRenderer', 'ScrollTrigger', 'gsap', 'sky-field', 'sky=0']) {
    assert.ok(!bundle.includes(word), `the bundle still carries ${word}`);
  }
  // One script on the page. The network graph is a second, self-contained
  // bundle, fetched only by the switch that shows it, never by the page.
  // (/pulse has its own one script, pulse.js, which this page never names; test/pulse.test.mjs holds it to the same rule.)
  // Every page's own script, one each; the observatory's two are among them and nothing else of the observatory's.
  const scripts = readdirSync(out).filter((name) => name.endsWith('.js')).sort();
  assert.deepEqual(scripts.filter((name) => name.startsWith('observatory')), ['observatory-graph.js', 'observatory.js']);
  assert.ok(scripts.includes('pulse.js'));
  assert.deepEqual([...page.matchAll(/<script[^>]* src="([^"]+)"/g)].map((m) => m[1]), ['observatory.js'], 'the page loads one script');
  assert.ok(!page.includes('observatory-graph'), 'the page never names the graph bundle');
  assert.ok(!/from"\.\/observatory-/.test(bundle), 'observatory.js imports no chunk statically');
  const graphBundle = readFileSync(join(out, 'observatory-graph.js'), 'utf8');
  assert.ok(graphBundle.includes('forceSimulation') || /forceManyBody|alphaDecay/.test(graphBundle), 'd3-force lives in the graph bundle');
  assert.ok(!/alphaDecay/.test(bundle), 'and not in the page’s script');
  // gsap is a dependency again, for /pulse only: the assertions above hold this page's bundle free of it.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const dep of ['three']) assert.ok(!(dep in (pkg.dependencies ?? {})), `${dep} is still a dependency`);
  assert.ok(!bundle.includes('force-graph') && !/kapsule|ForceGraph/.test(bundle), 'the observatory bundle carries no force-graph');
  assert.ok(!page.includes('data-reading="sky"') && !css.includes('.sky'), 'no sky slot or rule is left behind');
});

// ── the Nightwatch design contract (brief §2–§5.2) ────────────────────────────
const tokensCss = readFileSync(new URL('../src/chrome/tokens.css', import.meta.url), 'utf8');
const chromeCss = readFileSync(new URL('../src/chrome/chrome.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries([...tokensCss.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const barHtml = () => page.match(/<header class="nw-bar" data-bar>[\s\S]*?<\/header>/)?.[0] ?? '';
const heroHtml = () => page.match(/<header class="hero"[\s\S]*?<\/header>/)?.[0] ?? '';
/** Every declaration block of a stylesheet, as [selector, body]. */
const blocks = (source) => [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));

test('the top bar: the chrome’s bar before the first screen — wordmark, nav with the current page, the lamp, Sources, ⌘K and Present', () => {
  const bar = barHtml();
  assert.ok(bar, 'the bar is the chrome’s header at the top of the page');
  assert.ok(page.indexOf('<header class="nw-bar" data-bar>') < page.indexOf('<header class="hero"'));
  assert.match(bar, /<a class="nw-wordmark" href="\.\/">Scalar Commons<\/a>/);
  assert.match(bar, /<nav class="nw-nav nw-label" aria-label="Site" id="nw-nav">[\s\S]*<a href="observatory" aria-current="page">Observatory<\/a>[\s\S]*<\/nav>/);
  assert.match(bar, /<span class="nw-lamp" data-lamp data-state="connecting" data-lit="false" role="status" aria-live="off">/);
  assert.match(bar, /connecting · wss:\/\/rpc\.scalarnet\.io/);
  assert.match(bar, /<button type="button" class="nw-sources nw-label" role="switch" aria-checked="false" data-sources-switch>Sources/);
  assert.match(bar, /data-palette-open/);
  assert.match(bar, /<button type="button" class="nw-quiet nw-present" aria-pressed="false" aria-keyshortcuts="P">Present<\/button>/);
  // No status pill: the lamp carries the chain's state, fed from the head bus in main.js.
  assert.ok(!/sb-pill|statusbar/.test(page), 'the status pill is gone');
  assert.ok(bundle.includes('data-lamp') && /finality/.test(bundle), 'the bundle wires the lamp');
  assert.ok(!bundle.includes('.sb-state'), 'the bundle no longer drives the pill');
  // The bar's height is the token; its sheet turns pine-1 once scrolled.
  assert.match(chromeCss, /\.nw-bar \{[^}]*height: var\(--bar\)/);
  assert.match(chromeCss, /\.nw-bar\.is-scrolled/);
});

test('the first screen: Observatory in the display face, the one sentence, four Readings at figure-xl with live stubs, the operator-run note verbatim, the last hour at figure-m, the margin Spine', () => {
  const hero = heroHtml();
  assert.match(hero, /<header class="hero" data-instrument="hero" data-present-screen aria-labelledby="hero-h">/);
  assert.ok(!/nw-wordmark|Scalar Commons<\//.test(hero), 'the wordmark lives in the top bar only');
  assert.match(hero, /<ol class="nw-spine nw-spine--margin" data-spine role="img" aria-label="[^"]+"><\/ol>/, 'the margin Spine, empty until the head bus fills it');
  assert.ok(hero.indexOf('nw-spine') < hero.indexOf('<h1'), 'the Spine runs down the left');
  assert.match(hero, /<h1 class="nw-display" id="hero-h">Observatory<\/h1>\s*<p class="nw-body dek">The public chain, read from a running node\. Every figure names its source\.<\/p>/);
  const figures = [...hero.matchAll(/<div class="nw-reading[^"]*" data-reading="([^"]+)"[^>]*>[\s\S]*?<span class="reading-value nw-figure nw-figure--([a-z]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(figures.slice(0, 5), [['heroHeight', 'xl'], ['agents', 'xl'], ['operatorRun', 'm'], ['activeAgreements', 'xl'], ['messagesSent', 'xl']]);
  assert.deepEqual([...hero.matchAll(/<span class="nw-label reading-label">([^<]+)<\/span>/g)].map((m) => m[1]).slice(0, 5), ['Height', 'Agents registered', 'Operator-run', 'Agreements open', 'Messages sent']);
  // Every one is live: its stub says so, and its receipt names the declared source.
  for (const [key] of figures) {
    const block = hero.match(new RegExp(`data-reading="${key}"[\\s\\S]*?<div class="nw-receipt" data-receipt>[\\s\\S]*?data-raw>`))[0];
    assert.match(block, /<button class="nw-stub" type="button" data-state="connecting" aria-label="CONNECTING · show the source" aria-expanded="false"><\/button>/, `${key} has no stub: CONNECTING until the first read, then LIVE from the readout`);
    assert.match(block, /<div data-request>(GET api\.scalarnet\.io\/v1\/|WS rpc\.scalarnet\.io\/chain_)/, `${key} names no endpoint`);
    assert.match(block, /<div data-fetched>fetched — · —<\/div>/, `${key} ships a fetch time`);
  }
  // The operator-run note, verbatim, beside the figure and never behind a disclosure.
  assert.match(hero, /<p class="hero-note nw-small nw-dim" id="operator-note">Agents run by the Scalar Commons team to exercise the network\. Identified on-chain by the swarm- prefix\.<\/p>/);
  assert.ok(hero.indexOf('data-reading="operatorRun"') < hero.indexOf('id="operator-note"') && hero.indexOf('id="operator-note"') < hero.indexOf('data-reading="activeAgreements"'));
  assert.ok(!/<details[^>]*>[\s\S]*operator-note/.test(hero), 'the note is never behind a disclosure');
  // Activity in the last hour: the label, then the figure-m row; disputes in vermilion, slashes in ice, each colour with its word.
  const hour = hero.match(/<section class="hour" aria-labelledby="hour-h">[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(hour, /<h2 class="nw-label hour-title" id="hour-h">Activity in the last hour<\/h2>/);
  assert.match(chromeCss, /\.nw-label \{[^}]*text-transform: uppercase/);
  assert.match(hour, /<p class="hour-note nw-small nw-dim" hidden><\/p>/, 'the index-behind sentence has its slot');
  assert.deepEqual([...hour.matchAll(/data-reading="([^"]+)"/g)].map((m) => m[1]), ['hourOracle', 'hourSettled', 'hourDisputes', 'hourSlashes', 'hourMessages']);
  for (const key of ['hourOracle', 'hourSettled', 'hourDisputes', 'hourSlashes', 'hourMessages']) assert.match(hour, new RegExp(`data-reading="${key}"[\\s\\S]*?nw-figure nw-figure--m`), `${key} is not figure-m`);
  assert.match(hour, /class="nw-reading nw-reading--stack is-loading is-vermilion" data-reading="hourDisputes"/);
  assert.match(hour, /class="nw-reading nw-reading--stack is-loading is-ice" data-reading="hourSlashes"/);
  assert.match(css, /\.is-vermilion \.nw-figure \{ color: var\(--vermilion\); \}/);
  assert.match(css, /\.is-ice \.nw-figure \{ color: var\(--ice\); \}/);
  // The spec-309 fence stays on the message figures.
  for (const key of ['messagesSent', 'hourMessages']) assert.match(hero, new RegExp(`data-reading="${key}" data-min-spec="309" hidden`));
  // The layout: the Spine's 96 px, five columns, seven columns; nothing viewport-tall.
  assert.match(css, /\.hero-grid \{[^}]*grid-template-columns: 96px minmax\(0, 5fr\) minmax\(0, 7fr\)/);
  assert.ok(!/100s?vh/.test(css.match(/\.hero \{[^}]*\}/)?.[0] ?? ''), 'the hero is not a viewport-height block');
  // The Spine is fed by the head bus and marks the finalized boundary.
  const spine = readFileSync(new URL('../src/observatory/spine.js', import.meta.url), 'utf8');
  assert.match(spine, /ctx\.bus\.on\('head'/);
  assert.match(spine, /ctx\.bus\.on\('finalized'/);
  assert.match(spine, /is-newest/);
  assert.match(spine, /TICKS = 100/);
});

test('the agent activity panel: the title as a label, the Network graph switch, one legend, the field on canvas, one live line, one footnote, the list behind its disclosure', () => {
  const panel = heroHtml().match(/<figure class="panel hero-panel instrument"[\s\S]*?<\/figure>/)?.[0] ?? '';
  assert.match(panel, /<figcaption class="panel-head">\s*<h2 class="nw-label panel-title" id="panel-h">Agent activity<\/h2>\s*<button type="button" class="nw-quiet graph-toggle" role="switch" aria-checked="false">Network graph<\/button>/);
  const legend = panel.match(/<ul class="legend field-legend nw-label"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  assert.deepEqual([...legend.matchAll(/<\/span>([^<]+)<\/li>/g)].map((m) => m[1]), ['Idle', 'Working', 'In dispute', 'Slashed, last hour', 'Operator-run']);
  // The legend's marks are the state tokens, each beside its word.
  for (const [cls, token] of [['dot-working', 'filament'], ['dot-disputed', 'vermilion'], ['dot-slashed', 'ice'], ['dot-ring', 'clay'], ['dot-idle', 'sage']]) {
    assert.match(css, new RegExp(`\\.${cls}[^{]*\\{ color: var\\(--${token}\\); \\}`), `${cls} is not ${token}`);
  }
  assert.match(panel, /<canvas class="field-canvas" role="img" aria-label="[^"]+"><\/canvas>\s*<div class="tooltip field-tip nw-tag" role="tooltip" hidden><\/div>/);
  assert.match(panel, /<p class="field-live nw-receipt-line" role="status" aria-live="off">/);
  assert.equal((panel.match(/class="panel-foot /g) ?? []).length, 2, 'one footnote per view');
  assert.match(css, /\.graph-legend, \.graph-host, \.graph-note,\s*\.hero-panel\[data-graph\] \.field-legend, \.hero-panel\[data-graph\] \.field-host,\s*\.hero-panel\[data-graph\] \.field-live, \.hero-panel\[data-graph\] \.field-foot \{ display: none; \}/);
  assert.match(panel, /<ol class="graph-bundles nw-mono" aria-label="[^"]+" hidden><\/ol>/);
  assert.match(panel, /<details class="disclosure agents-list"><summary class="nw-quiet">The same agents as a list<\/summary>/);
  assert.match(panel, /<div class="list-pager nw-pager nw-label" hidden>\s*<button type="button" class="nw-quiet" data-step="prev">← previous<\/button>/);
  assert.ok(!/data-reading=/.test(panel), 'no figure inside the frame');
  // The field draws on canvas, with no physics: the graph's d3-force is only in its own bundle.
  const field = readFileSync(new URL('../src/observatory/instruments/agent-field.js', import.meta.url), 'utf8');
  assert.ok(!/from ['"]d3-force|forceSimulation\(/.test(field), 'no physics in the field');
  assert.match(field, /import\(new URL\(GRAPH_BUNDLE, import\.meta\.url\)\.href\)/, 'the graph is fetched on first use');
  // The panel sits on pine-2 with the one radius; no border, no shadow.
  assert.match(css, /\.panel \{[^}]*background: var\(--pine-2\); border-radius: var\(--radius\)/);
});

test('the river under the first screen: a titled strip at 140 px across the content width, newest filament, final sage', () => {
  const after = page.slice(page.indexOf('</header>', page.indexOf('<header class="hero"')));
  const strip = after.match(/<figure class="nw-frame river-strip" aria-labelledby="river-h">[\s\S]*?<\/figure>/)?.[0] ?? '';
  assert.ok(strip, 'the strip follows the hero directly, inside the content frame');
  assert.ok(after.indexOf('river-strip') < after.indexOf('<main>'));
  assert.match(strip, /<h2 class="nw-label" id="river-h">Blocks arriving now<\/h2>/);
  assert.match(strip, /<canvas class="hero-river" role="img" aria-label="[^"]+"><\/canvas>/);
  assert.match(css, /\.hero-river, \.pulse-canvas \{ display: block; width: 100%; height: 140px; \}/);
  // The canvas reads its colours by the names context.js resolves, each an alias of a token: live is filament, settled is sage.
  assert.match(css, /--live: var\(--filament\);/);
  assert.match(css, /--settled: var\(--sage\);/);
  const pulse = readFileSync(new URL('../src/observatory/instruments/pulse.js', import.meta.url), 'utf8');
  assert.ok(!/compact: true/.test(pulse), 'the strip is drawn with its labels, like the full river');
  assert.match(pulse, /FINAL ·/);
});

test('sections: a numbered label, the instrument, then the Readings in a row — the Day Bar over Economy, eight points for Validators, four strips for History, the Rail, the commands as code blocks', () => {
  const sections = [...page.matchAll(/<section id="([a-z]+)" class="section nw-section" data-instrument="([a-z-]+)" data-present-screen data-reveal aria-labelledby="\1-h">([\s\S]*?)<\/section>/g)];
  assert.deepEqual(sections.map((m) => m[1]), ['chain', 'economy', 'validators', 'history', 'upgrades', 'verify']);
  const names = ['Chain', 'Economy', 'Validators', 'History', 'Upgrades', 'Verify'];
  sections.forEach(([, id, , body], i) => {
    assert.match(body, new RegExp(`<h2 class="nw-label section-head" id="${id}-h">0${i + 1} · ${names[i]}</h2>`), `${id}: the number and the name as a label`);
    assert.ok(!/<p class="lede">|class="eyebrow"/.test(body), `${id}: no heading sentence the brief does not give`);
    if (/class="readings/.test(body)) assert.ok(body.indexOf('class="instrument') < body.indexOf('class="readings'), `${id}: the figures follow the instrument`);
  });
  const keys = (id) => [...section(id).matchAll(/data-reading="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys('chain'), ['bestBlock', 'finalizedBlock', 'finalityLag', 'blocksPerMinute']);
  assert.deepEqual(keys('economy'), ['eraCountdown', 'agentPayouts', 'openDisputes']);
  assert.deepEqual(keys('validators'), ['validators', 'nodeHealth']);
  assert.deepEqual(keys('history'), ['blockTime', 'agreementsCumulative', 'emissionCumulative', 'agentsOverTime']);
  assert.deepEqual(keys('upgrades'), ['specVersion', 'lastUpgrade']);
  assert.deepEqual(keys('verify'), ['genesis']);
  // Rows of Readings are the chrome's grid; nothing boxed, nothing bordered.
  assert.match(section('chain'), /<div class="readings nw-row">/);
  assert.match(chromeCss, /\.nw-row \{ display: grid; grid-auto-flow: column; grid-auto-columns: minmax\(0, 1fr\)/);
  // 02 · Economy: the Day Bar (four segments, progressbar in blocks, sticky at 12 px), its labels empty until the browser reads the eras.
  const economy = section('economy');
  assert.match(economy, /<div class="nw-daybar" data-daybar role="progressbar" aria-valuemin="0" aria-valuenow="0" aria-valuemax="3600" aria-label="[^"]+">/);
  assert.equal((economy.match(/nw-daybar-seg/g) ?? []).length, 4);
  assert.equal((economy.match(/nw-daybar-seg is-current/g) ?? []).length, 1);
  for (const [, label] of economy.matchAll(/<span class="nw-label" data-daybar-label>([^<]*)<\/span>/g)) assert.equal(label, '', 'a Day Bar label is the browser’s to fill');
  assert.match(css, /\.nw-daybar \{ position: sticky; top: 12px;/);
  assert.match(css, /\.dial \{ display: none; \}/);
  // 03 · Validators: the ring on a 240 px circle, the list, the ring note, the hosts record.
  const validators = section('validators');
  assert.match(validators, /<svg class="ring" role="img" aria-label="[^"]+"><\/svg>/);
  assert.match(css, /\.ring \{ width: 240px; height: 240px;/);
  assert.match(allCss, /\.ring \.ring-node\.is-authoring \{ fill: var\(--filament\); \}/);
  assert.match(allCss, /\.ring \.ring-node \{ fill: var\(--bone\); \}/);
  assert.ok(validators.indexOf('class="instrument-note ring-note"') < validators.indexOf('status-record'));
  // 04 · History: four strips, each a labelled plot with its figure and receipt line.
  const strips = [...section('history').matchAll(/<figure class="strip reading" data-reading="([^"]+)">([\s\S]*?)<\/figure>/g)];
  assert.equal(strips.length, 4);
  for (const [, key, block] of strips) {
    assert.match(block, /<h3 class="nw-label reading-label">[^<]+<\/h3>/, `${key} has no label`);
    assert.match(block, /<div class="strip-plot" data-plot><\/div>/, `${key} has no plot`);
    assert.match(block, /<span class="nw-receipt-line" data-receipt-line>GET api\.scalarnet\.io\/v1\//, `${key} names no source`);
  }
  assert.match(allCss, /\.strip-plot \.plot-label \{[^}]*fill: var\(--bone-dim\)/);
  const history = readFileSync(new URL('../src/observatory/instruments/history.js', import.meta.url), 'utf8');
  assert.equal((history.match(/'plot-zero'/g) ?? []).length, 4, 'one zero line per strip');
  // 06 · Verify: the commands as the chrome's code blocks with Copy; the posture rows under the record label; no badge.
  const verify = section('verify');
  assert.equal((verify.match(/<figure class="nw-code nw-copyable" data-lang="sh">/g) ?? []).length, 5);
  assert.equal((verify.match(/aria-label="Copy this block">Copy<\/button>/g) ?? []).length, 5);
  assert.match(verify, /<h3 class="nw-label">Security posture · Record, not live<\/h3>/);
  assert.ok(!/badge|shield/i.test(verify), 'no badge');
  for (const [, body] of verify.matchAll(/<div class="posture-row"[^>]*>([\s\S]*?)<\/div>/g)) {
    if (/not yet recorded/.test(body)) continue;
    assert.match(body, /<span class="posture-source nw-mono">/, 'a recorded value names its source document');
    assert.match(body, /as of \d{4}-\d{2}-\d{2}/, 'a recorded value carries its date');
  }
});

test('fonts: the chrome’s two faces only — Instrument Sans and Martian Mono, self-hosted and preloaded; this page declares no face of its own', () => {
  const fonts = readdirSync(join(out, 'fonts')).sort();
  for (const file of ['instrument-sans-latin-wght-normal.woff2', 'martian-mono-latin-wght-normal.woff2']) assert.ok(fonts.includes(file), `${file} is not in dist/fonts`);
  assert.match(page, /<link rel="preload" href="fonts\/instrument-sans-latin-wght-normal\.woff2" as="font" type="font\/woff2" crossorigin>/);
  assert.match(page, /<link rel="preload" href="fonts\/martian-mono-latin-wght-normal\.woff2" as="font" type="font\/woff2" crossorigin>/);
  assert.ok(!/source-serif|inter-latin|jetbrains/.test(page), 'the page preloads none of the old faces');
  assert.ok(!/@font-face/.test(allCss), 'observatory.css declares no face: the chrome does');
  assert.ok(!/Source Serif|Inter|JetBrains|Instrument Serif|IBM Plex/.test(allCss), 'no old family is named');
  assert.ok(!/fonts\.googleapis|cdn\./.test(page), 'no third-party font');
  assert.equal((chromeCss.match(/@font-face/g) ?? []).length, 2);
  for (const family of ['Instrument Sans', 'Martian Mono']) assert.ok(chromeCss.includes(`font-family: "${family}"`), `${family} is self-hosted by the chrome`);
  assert.match(chromeCss, /font-display: swap/);
  // Mono is for figures, labels, receipts, hashes and addresses; the sans for words.
  assert.equal(tokens['--font-mono'], '"Martian Mono", ui-monospace, monospace');
  assert.equal(tokens['--font-sans'], '"Instrument Sans", system-ui, sans-serif');
  assert.match(css, /--font-serif: var\(--font-sans\);/, 'the instruments’ serif name resolves to the sans');
});

test('figures: tabular lining figures from the token; a live figure fills through the chrome’s setFigure path and never ships a digit', () => {
  assert.match(chromeCss, /\.nw-figure \{ font: var\(--figure-m\); font-variant-numeric: tabular-nums lining-nums;/);
  assert.match(css, /\.mono,\ncode,\npre \{[^}]*font-variant-numeric: tabular-nums lining-nums/);
  for (const [, inner] of page.matchAll(/<span class="reading-value[^"]*"[^>]*>([\s\S]*?)<\/span>/g)) assert.ok(!/\d/.test(inner), `a figure ships: ${inner}`);
  assert.ok(!/\.dc\b|dcells/.test(allCss), 'no digit-cell rule is left');
  for (const [file, src] of clientSources()) assert.ok(!/setDigits|dcells/.test(src), `${file} still builds digit cells`);
  // The readout fills the figure, the stub's state and the receipt's lines; an error is "unavailable" plus the reason, never the old value.
  const readout = readFileSync(new URL('../src/observatory/readout.js', import.meta.url), 'utf8');
  assert.match(readout, /markState\(target, live \? 'live' : 'record'\)/);
  assert.match(readout, /setAttribute\('data-state', state\)/);
  assert.match(readout, /\[data-fetched\]/);
  assert.match(readout, /\[data-raw\]/);
  assert.match(readout, /textContent = 'unavailable'/);
  assert.match(bundle, /raw (?:↗|\\u2197)/);
});

test('type scale: every font size in this page’s stylesheets is a token from tokens.css (presenter’s 160 px room figure is the stated exception)', () => {
  const faces = Object.keys(tokens).filter((name) => /^--(display|h2|h3|body|small|figure-(xl|l|m)|label|mono)$/.test(name));
  assert.equal(faces.length, 10, 'the closed scale has ten faces');
  for (const [selector, body] of blocks(allCss)) {
    if (selector.startsWith('html[data-present]') || selector.startsWith(':root')) continue;
    for (const [, value] of body.matchAll(/font-size:\s*([^;]+);/g)) assert.match(value, /^inherit$/, `${selector} sets font-size: ${value}, off the scale`);
    for (const [, value] of body.matchAll(/(?:^|;)\s*font:\s*([^;]+);/g)) {
      const name = value.match(/^var\((--[a-z0-9-]+)\)$/)?.[1];
      assert.ok(name && faces.includes(name), `${selector} sets font: ${value}, off the scale`);
    }
  }
  assert.match(css, /html\[data-present\] \.section \.nw-figure, html\[data-present\] \.hero \.nw-figure--xl \{ font: var\(--figure-xl\); font-size: 160px; \}/);
  // The display, the labels and the figures take their faces from the chrome's classes.
  assert.match(page, /<h1 class="nw-display" id="hero-h">/);
  assert.match(chromeCss, /\.nw-display \{ font: var\(--display\)/);
  assert.match(chromeCss, /\.nw-figure--xl \{ font: var\(--figure-xl\)/);
  assert.match(chromeCss, /\.nw-label \{[^}]*font: var\(--label\)/);
});

test('colour: one theme from the tokens — no hex in this page’s stylesheets, every pair at WCAG AA, filament only on what is live, vermilion and ice with their words, no gradient, no shadow but the glow', () => {
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(allCss.replace(/\/\*[\s\S]*?\*\//g, '')), 'observatory.css names a colour that is not a token');
  assert.ok(!/prefers-color-scheme/.test(allCss), 'one theme');
  const used = new Set([...allCss.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const aliases = new Set([...(css.match(/:root \{([^}]*)\}/)?.[1] ?? '').matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  for (const name of used) assert.ok(name in tokens || aliases.has(name), `${name} is neither a token nor one of the instruments' aliases`);
  for (const name of aliases) {
    const value = css.match(new RegExp(`${name}: var\\((--[a-z0-9-]+)\\);`))?.[1];
    assert.ok(value && value in tokens, `alias ${name} does not resolve to a token`);
  }
  // Contrast, computed from tokens.css.
  for (const ground of ['--pine-0', '--pine-1', '--pine-2']) {
    for (const ink of ['--bone', '--bone-dim']) assert.ok(contrast(tokens[ink], tokens[ground]) >= 4.5, `${ink} on ${ground} is under AA`);
  }
  for (const ground of ['--pine-0', '--pine-1']) {
    assert.ok(contrast(tokens['--sage'], tokens[ground]) >= 3, `sage on ${ground} is under 3:1`);
    for (const ink of ['--filament', '--vermilion', '--ice', '--clay']) assert.ok(contrast(tokens[ink], tokens[ground]) >= 4.5, `${ink} on ${ground} is under AA as text`);
  }
  // State colours sit only where their word does: vermilion on disputes, ice on slashes, clay on operator-run.
  for (const [selector, body] of blocks(css)) {
    if (selector === ':root') continue; // the instruments' aliases, each a token
    if (/var\(--vermilion\)/.test(body)) assert.match(selector, /vermilion|disput|failed/, `vermilion outside a dispute: ${selector}`);
    if (/var\(--ice\)/.test(body)) assert.match(selector, /ice|slash/, `ice outside a slash: ${selector}`);
    if (/var\(--clay\)/.test(body)) assert.match(selector, /ring|hero-sub/, `clay outside operator-run: ${selector}`);
  }
  assert.match(page, /class="nw-reading nw-reading--stack is-loading is-vermilion" data-reading="hourDisputes"[\s\S]*?<span class="nw-label reading-label">Disputes opened/);
  assert.match(page, /class="nw-reading nw-reading--stack is-loading is-ice" data-reading="hourSlashes"[\s\S]*?<span class="nw-label reading-label">Slashes/);
  // No gradient, no shadow but the glow token, no blur, no glass.
  assert.ok(!/gradient\(|text-shadow|backdrop-filter|blur\(/.test(allCss), 'no gradient, blur or glass');
  for (const [, value] of allCss.matchAll(/box-shadow:\s*([^;]+);/g)) assert.equal(value.trim(), 'var(--glow)', `a shadow that is not the glow: ${value}`);
  for (const [file, src] of clientSources()) assert.ok(!/createLinearGradient|createRadialGradient/.test(src), `${file} draws a gradient`);
  // Borders: none on this page but the three the brief allows, which the chrome draws.
  assert.ok(!/border(?:-[a-z]+)?:\s*(?!0|none)/.test(allCss.replace(/border-radius/g, '').replace(/--border:/g, '')), 'observatory.css draws a border');
});

test('components: the chrome’s controls only — every button is a chrome control, every disclosure the one style, the focus ring and the tooltip are the chrome’s', () => {
  const buttons = [...page.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(buttons.length >= 10);
  assert.ok(buttons.every((c) => /\bnw-(?:stub|sources|menu|quiet|copy|button)\b/.test(c)), `a button outside the chrome: ${buttons.filter((c) => !/\bnw-/.test(c)).join(' | ')}`);
  assert.ok(!/\bbtn\b/.test(page), 'the old button class is gone');
  for (const [, cls] of page.matchAll(/<details class="([^"]*)"/g)) assert.match(cls, /\bdisclosure\b/, `a disclosure outside the one style: ${cls}`);
  assert.match(chromeCss, /:focus-visible \{ outline: 1px solid var\(--filament\); outline-offset: 4px; \}/);
  assert.ok(!/:focus-visible/.test(css), 'this page draws no focus ring of its own');
  // The field's and the graph's tips are tags.
  assert.match(page, /<div class="tooltip field-tip nw-tag" role="tooltip" hidden>/);
  assert.match(page, /<div class="tooltip constellation-tip nw-tag" role="tooltip" hidden>/);
  assert.match(css, /\.tooltip \{ position: absolute; pointer-events: none;/);
  // Copy is the chrome's: "Copy" on hover, "Copied" in filament for 1.2 s.
  assert.ok(bundle.includes("'Copied'") || bundle.includes('"Copied"'));
  assert.match(chromeCss, /\.nw-copy\.is-copied \{ color: var\(--filament\)/);
  // Hit targets stay 40 px on touch (requested of the chrome in chrome/requests/phase3.css; carried here meanwhile).
  assert.match(css.slice(css.indexOf('@media (pointer: coarse)')), /\.nw-stub, \.nw-quiet, \.nw-copy, \.nw-sources, \.nw-menu \{ min-height: 40px; \}/);
  assert.match(readFileSync(new URL('../src/chrome/requests/phase3.css', import.meta.url), 'utf8'), /pointer: coarse/);
});

test('provenance: every Reading wears a stub that tears to a receipt — request, fetched · block, raw ↗ — Sources tears them all and is remembered; scripts off is a Band with the build time', () => {
  assert.match(page, /<script>try\{if\(localStorage\.getItem\("observatory:sources"\)==="1"\)document\.documentElement\.setAttribute\("data-sources",""\)\}catch\(e\)\{\}<\/script>/);
  assert.ok(bundle.includes('observatory:sources'), 'the bundle remembers the choice');
  const readings = [...page.matchAll(/<div class="nw-reading[^"]*" data-reading="([^"]+)"[\s\S]*?<div class="nw-receipt" data-receipt>([\s\S]*?)<\/div>\s*<\/div>/g)];
  assert.ok(readings.length >= 20, `every Reading carries a receipt, found ${readings.length}`);
  for (const [, key, receipt] of readings) {
    assert.match(receipt, /^<div data-request>(?:GET api\.scalarnet\.io\/v1\/[^<]+|WS rpc\.scalarnet\.io\/[a-zA-Z_]+)<\/div><div data-fetched>fetched — · —<\/div><div><span data-raw>raw —<\/span>$/, `${key}: the receipt is not the request, the fetch and the raw bytes`);
  }
  for (const [, key] of readings) {
    const sourceOf = Object.entries(SOURCES).find(([, s]) => s.readings?.includes(key))[1];
    if (sourceOf.kind === 'api') assert.ok(page.includes(`GET ${new URL(sourceOf.path, API_ORIGIN).href.replace('https://', '').replace(/&/g, '&amp;')}`), `${key} names an endpoint other than its source`);
  }
  assert.equal((page.match(/class="nw-receipt-line" data-receipt-line/g) ?? []).length, readings.length + 4, 'one inline receipt line per Reading and per strip');
  assert.match(chromeCss, /html\[data-sources\] \.nw-receipt-line \{ display: block; \}/);
  assert.match(chromeCss, /\.nw-reading\.is-torn \.nw-receipt, html\[data-sources\] \.nw-reading:not\(\[data-sealed="true"\]\) \.nw-receipt \{ display: block;/);
  // The records tear nothing: the posture file is sealed and says so; no Reading is drawn from it.
  assert.match(section('verify'), /<div class="posture-record" data-record="true">/);
  // Scripts off: the Band, with the build's time and block from chain-facts.json; no figure in a value slot.
  const band = page.match(/<noscript><div class="nw-frame"><div class="nw-band" role="status">([\s\S]*?)<\/div><\/div><\/noscript>/)?.[1] ?? '';
  const builtAt = facts.provenance.fetchedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  assert.equal(band.replace(/<span class="nw-receipt-line">[\s\S]*$/, ''), `Scripts are off. Every figure on this page is from the build, ${builtAt}, and carries its source. Nothing will move.`);
  assert.ok(band.includes(`block ${facts.provenance.readAtBlock.toLocaleString('en-US')}`), 'the band’s receipt names the build’s block');
  assert.ok(page.indexOf('<noscript>') < page.indexOf('<main>'));
});

test('motion: attack and cool on colour, opacity, translateY and shadow only; the reveal once by IntersectionObserver; nothing loops; reduced motion honoured', () => {
  assert.ok(!/@keyframes|animation:/.test(allCss), 'this page declares no keyframe animation: the chrome’s loading leader is the one loop');
  for (const [selector, body] of blocks(allCss)) {
    for (const [, value] of body.matchAll(/transition:\s*([^;]+);/g)) {
      for (const part of value.split(',')) assert.match(part.trim(), /^(?:none|opacity|transform|color|background(?:-color)?|box-shadow)\b/, `${selector} transitions ${part.trim()}`);
    }
    for (const [, value] of body.matchAll(/transform:\s*([^;]+);/g)) assert.match(value, /^(?:none|translateY\()/, `${selector} transforms with ${value}`);
  }
  assert.match(css, /html\.reveal-ready \[data-reveal\]:not\(\.is-in\) \{ opacity: 0; transform: translateY\(12px\); \}/);
  assert.match(css, /\[data-reveal\] \{ transition: opacity var\(--t-ui\) var\(--ease-ui\), transform var\(--t-ui\) var\(--ease-ui\); \}/);
  assert.ok(bundle.includes('IntersectionObserver'));
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\[data-reveal\] \{ opacity: 1; transform: none; transition: none; \}/);
  // The chrome's warm/cool: the timings are tokens, honoured under reduced motion.
  assert.match(chromeCss, /var\(--t-attack\)/);
  assert.match(chromeCss, /var\(--t-cool\)/);
  assert.match(chromeCss.slice(chromeCss.indexOf('@media (prefers-reduced-motion: reduce)')), /transition: none/);
  // The spine and the lamp move on the head bus only; the hidden tab adds nothing.
  const spine = readFileSync(new URL('../src/observatory/spine.js', import.meta.url), 'utf8');
  assert.match(spine, /doc\.hidden\) return/);
  const main = readFileSync(new URL('../src/observatory/main.js', import.meta.url), 'utf8');
  assert.match(main, /ctx\.bus\.on\('head', \(\{ number \}\) => handle\.update/);
  assert.match(main, /ctx\.bus\.on\('socket'/);
  assert.equal((main.match(/setInterval\(/g) ?? []).length, 1, 'main.js holds the one interval, for the river’s stall check');
  const pulse = readFileSync(new URL('../src/observatory/instruments/pulse.js', import.meta.url), 'utf8');
  assert.match(pulse, /animateArrival/);
});

test('presenter mode: the Present button and P, the first screen then the six sections, figures at 160 px, the Spine and receipts hidden', () => {
  assert.ok(!page.includes('data-present=""') && !/present=1/.test(page), 'nothing in the page turns it on from the URL');
  const screens = [...page.matchAll(/<(header|section)(?: id="([a-z]+)")?[^>]*data-present-screen/g)].map((m) => m[2] ?? 'hero');
  assert.deepEqual(screens, ['hero', 'chain', 'economy', 'validators', 'history', 'upgrades', 'verify']);
  for (const selector of ['html[data-present] .nw-nav', 'html[data-present] .nw-receipt-line', 'html[data-present] .nw-foot', 'html[data-present] [data-present-screen][data-present-active]', 'html[data-present] .river-strip']) {
    assert.ok(css.includes(selector), `observatory.css has no rule for ${selector}`);
  }
  assert.match(css, /font-size: 160px/);
  const presenter = readFileSync(new URL('../src/observatory/presenter.js', import.meta.url), 'utf8');
  assert.match(presenter, /querySelector\('\.nw-present, \.sb-present'\)/);
  for (const key of ['Escape', 'aria-pressed']) assert.ok(bundle.includes(key), `the bundle does not handle ${key}`);
  assert.ok(!/<script/i.test(index), 'index.html stays script-free');
});

test('identity: the chrome’s wordmark in the bar, the chrome’s footer with the build’s facts and the disclaimer; no favicon; no second wordmark', () => {
  assert.match(barHtml(), /<a class="nw-wordmark" href="\.\/">Scalar Commons<\/a>/);
  assert.equal((page.match(/Scalar Commons<\/a>/g) ?? []).length, 1, 'one wordmark');
  const footer = page.match(/<footer class="nw-foot" data-footer>[\s\S]*?<\/footer>/)?.[0] ?? '';
  assert.ok(footer, 'the footer is the chrome’s');
  assert.match(footer, /<span class="nw-label">Chain<\/span>[\s\S]*<span class="nw-label">Build<\/span>[\s\S]*<span class="nw-label">Govern<\/span>/);
  const short = `${facts.provenance.genesisHash.slice(0, 6)}…${facts.provenance.genesisHash.slice(-4)}`;
  assert.ok(footer.includes(`<span>genesis ${short}</span>`), 'the genesis hash comes from chain-facts.json');
  assert.ok(footer.includes(`<span>spec ${facts.provenance.specVersion} · node ${facts.provenance.nodeVersion ?? '—'}</span>`), 'spec and node come from the record, a missing node version printed as a dash');
  assert.ok(footer.includes(`against block ${facts.provenance.readAtBlock.toLocaleString('en-US')}`), 'the build’s block');
  assert.match(footer, /<p class="nw-foot-line">Testnet — the token has no value and the chain may be reset\.<\/p>/);
  assert.ok(!/rel="icon"/.test(page) && !/rel="icon"/.test(index));
  assert.ok(!readdirSync(out).includes('favicon.svg'));
  assert.ok(!/class="merge"|howto|wordmark-text|<svg class="mark"/.test(page), 'the old footer is gone');
});
