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
import { renderSection } from '../src/observatory.mjs';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = new URL('../../', import.meta.url);
const readRepoFile = (relPath) => readFileSync(new URL(relPath, repoRoot), 'utf8');
const history = JSON.parse(readFileSync(new URL('../runtime-history.json', import.meta.url), 'utf8'));
const posture = JSON.parse(readFileSync(new URL('../public/posture.json', import.meta.url), 'utf8'));

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
  for (const name of ['observatory.html', 'observatory.js', 'observatory.css', 'runtime-history.json', 'posture.json', 'fonts']) {
    assert.ok(files.includes(name), `build produced no ${name} (got: ${files.join(', ')})`);
  }
  const fonts = readdirSync(join(out, 'fonts'));
  for (const face of ['instrument-serif', 'ibm-plex-mono', 'source-sans-3']) {
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

test('every instrument opens with a plain sentence before any figure', () => {
  const sections = [...page.matchAll(/<section id="([a-z]+)" class="grid instrument-section"[\s\S]*?<\/section>/g)];
  assert.deepEqual(
    sections.map((m) => m[1]),
    ['pulse', 'era', 'constellation', 'validators', 'history', 'upgrades', 'posture', 'verify'],
  );
  for (const [block, id] of sections) {
    const lede = block.match(/<p class="lede">([\s\S]*?)<\/p>/)?.[1] ?? '';
    assert.ok(lede.length > 40, `${id} has no explanatory sentence`);
    assert.ok(block.indexOf('class="lede"') < block.indexOf('class="instrument"'), `${id}: the sentence must precede the instrument`);
  }
});

test('no reading ships with a value: every figure on the page is fetched, not built in', () => {
  const values = [...page.matchAll(/<(?:p|span) class="reading-value[^"]*"[^>]*>([\s\S]*?)<\/(?:p|span)>/g)].map((m) => m[1]);
  assert.ok(values.length >= 20, `expected every reading to have a value slot, found ${values.length}`);
  for (const value of values) {
    assert.ok(!/\d/.test(value.replace(/<[^>]+>/g, '')), `a reading ships a built-in figure: ${value}`);
  }
  const readings = [...page.matchAll(/<(?:div|figure) class="[^"]*reading[^"]*" data-reading="([^"]+)"[\s\S]*?<p class="reading-prov">/g)];
  assert.ok(readings.length >= 20);
  for (const [block, key] of readings) {
    assert.match(block, /class="reading-label"/, `${key} has no label`);
    assert.match(block, /class="reading-note"/, `${key} has no explanatory sub-line`);
  }
});

test('every reading in the page is fed by a source the data layer knows', () => {
  const keys = new Set([...page.matchAll(/data-reading="([^"]+)"/g)].map((m) => m[1]));
  const fed = new Set(Object.values(SOURCES).flatMap((source) => source.readings));
  for (const key of keys) {
    assert.ok(fed.has(key), `reading "${key}" has no source in data.js`);
  }
});

test('the two records on the page are labelled as records, and the posture record invents nothing', () => {
  assert.match(page, /<section id="posture"[^>]*data-record="true"/);
  assert.match(page, /Record, not live/);
  assert.match(page, /checked-in record, not a live reading/);
  for (const [key, entry] of Object.entries(posture.fields)) {
    assert.ok('value' in entry && 'asOf' in entry && 'todo' in entry, `posture field ${key} is missing value/asOf/todo`);
    if (entry.value === null) {
      assert.match(entry.todo, /^TODO\(owner\)/, `posture field ${key} has no value and no TODO for the owner`);
      assert.match(page, new RegExp(`data-posture="${key}" data-recorded="false"[\\s\\S]*?not yet recorded`));
    }
  }
  // A posture value slot carries no digits unless a value was recorded.
  const strip = page.match(/<dl class="posture">[\s\S]*?<\/dl>/)[0];
  for (const [, value] of strip.matchAll(/<dd class="mono">([\s\S]*?)<\/dd>/g)) {
    const text = value.replace(/<[^>]+>/g, '');
    if (text.includes('not yet recorded')) assert.ok(!/\d/.test(text), `posture shows a number with nothing recorded: ${text}`);
  }
});

test('the upgrade record: 305, 306, 307 applied, 309 scheduled, each agreeing with its file', () => {
  assert.deepEqual(
    history.upgrades.map((u) => [u.specVersion, u.status]),
    [
      [305, 'applied'],
      [306, 'applied'],
      [307, 'applied'],
      [309, 'scheduled'],
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
  for (const upgrade of history.upgrades) {
    assert.match(page, new RegExp(`<li class="rail-marker rail-${upgrade.status}[^"]*" style="--x:[0-9.]+%" data-spec="${upgrade.specVersion}"`));
    assert.match(page, new RegExp(`<li class="upgrade" data-spec="${upgrade.specVersion}" data-status="${upgrade.status}"`));
    if (upgrade.wasm) {
      assert.ok(page.includes(upgrade.wasm.sha256), `sha256 for ${upgrade.specVersion} not rendered in full`);
      assert.ok(page.includes(`data-copy="${upgrade.wasm.sha256}"`), `sha256 for ${upgrade.specVersion} has no copy control`);
      assert.ok(page.includes(`data-confirm-block="${upgrade.appliedAtBlock}"`), `${upgrade.specVersion} has no chain-confirmation slot`);
    }
  }
  // Markers sit in block order, left to right, with the scheduled one last.
  const xs = [...page.matchAll(/rail-marker rail-\w+" style="--x:([0-9.]+)%/g)].map((m) => Number(m[1]));
  assert.deepEqual([...xs].sort((a, b) => a - b), xs);
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
  assert.match(css, /@media \(prefers-color-scheme: light\)/);
});

test('observatory.css shares the landing palette for text, rules and accent', () => {
  const tokens = (css) => {
    const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
    return blocks.map((body) => Object.fromEntries([...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])));
  };
  const site = tokens(readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'));
  const obs = tokens(readFileSync(new URL('../src/observatory.css', import.meta.url), 'utf8'));
  // Dark block first, light (prefers-color-scheme) block second, in both files.
  // The plate is the site's dark background; the light plate is paper rather
  // than the landing page's white, by design.
  assert.equal(obs[0]['--bg'], site[0]['--bg'], 'dark --bg differs from styles.css');
  for (const [i, scheme] of [[0, 'dark'], [1, 'light']]) {
    for (const name of ['--text', '--text-dim', '--border', '--accent']) {
      assert.equal(obs[i]?.[name], site[i]?.[name], `${scheme} ${name} differs from styles.css`);
    }
    for (const name of ['--live', '--settled', '--active', '--disputed', '--slashed', '--grid']) {
      assert.ok(obs[i]?.[name], `${scheme} ${name} is not defined`);
    }
  }
  assert.equal(obs[1]['--bg'], '#f6f4ee');
});

test('renderSection renders each section on its own for the harness', () => {
  for (const name of ['pulse', 'era', 'constellation', 'validators', 'history', 'upgrades', 'posture', 'verify']) {
    const html = renderSection(name, { history, posture });
    assert.match(html, new RegExp(`<section id="${name}"`));
  }
  assert.throws(() => renderSection('nope', { history, posture }), /no section named/);
});
