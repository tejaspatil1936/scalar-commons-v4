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
  for (const face of ['instrument-serif', 'ibm-plex-mono', 'ibm-plex-sans']) {
    assert.ok(fonts.some((f) => f.startsWith(face) && f.endsWith('.woff2')), `no ${face} woff2 in dist/fonts`);
  }
  assert.ok(!fonts.some((f) => f.startsWith('source-sans')), 'the body face is IBM Plex Sans now; Source Sans is not shipped');
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
    assert.match(block, /class="reading-label"/, `${key} has no label`);
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
  // Markers sit in order, left to right, equally spaced, with the scheduled one last;
  // the block number is printed under each applied one.
  const xs = [...page.matchAll(/rail-marker rail-\w+" style="--x:([0-9.]+)%/g)].map((m) => Number(m[1]));
  assert.deepEqual([...xs].sort((a, b) => a - b), xs);
  assert.deepEqual(xs, railPositions(history.upgrades.length).map((x) => Number(x.toFixed(2))));
  for (const upgrade of history.upgrades.filter((u) => u.status === 'applied')) {
    assert.ok(page.includes(`<span class="rail-meta mono">#${upgrade.appliedAtBlock.toLocaleString('en-US')}</span>`), `${upgrade.specVersion} has no block under its marker`);
  }
  // The dashed future begins past the last applied marker.
  const future = Number(page.match(/class="rail"[^>]*style="--future:([0-9.]+)%"/)[1]);
  assert.ok(future > xs[2] && future < xs[3]);
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

const css = readFileSync(new URL('../src/observatory.css', import.meta.url), 'utf8');
const allCss = css + readdirSync(new URL('../src/observatory/instruments/', import.meta.url))
  .filter((name) => name.endsWith('.css'))
  .map((name) => readFileSync(new URL(`../src/observatory/instruments/${name}`, import.meta.url), 'utf8'))
  .join('\n');
/** The declarations of the first rule whose selector is exactly `selector`. */
const rule = (selector, source = css) =>
  source.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
const section = (id) => page.match(new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`))?.[0] ?? '';

test('renderSection renders each section on its own for the harness', () => {
  for (const name of ['chain', 'economy', 'validators', 'history', 'upgrades', 'verify']) {
    const html = renderSection(name, { history, posture });
    assert.match(html, new RegExp(`<section id="${name}"`));
  }
  assert.throws(() => renderSection('nope', { history, posture }), /no section named/);
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
  const scripts = readdirSync(out).filter((name) => name.endsWith('.js'));
  assert.deepEqual(scripts, ['observatory.js'], 'one script, no chunks');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const dep of ['three', 'gsap']) assert.ok(!(dep in (pkg.dependencies ?? {})), `${dep} is still a dependency`);
  assert.ok(!page.includes('data-reading="sky"') && !css.includes('.sky'), 'no sky slot or rule is left behind');
});

test('the first screen: the status bar, then the hero — wordmark over “Observatory”, one sentence, three live figures, the live line — beside the constellation in its own frame, the river along the foot', () => {
  const bar = page.indexOf('class="statusbar reading" data-reading="networkStatus"');
  const heroAt = page.indexOf('<header class="hero"');
  assert.ok(bar > 0 && bar < heroAt, 'the status bar comes first');
  const hero = page.match(/<header class="hero"[\s\S]*?<\/header>/)[0];
  assert.match(hero, /<header class="hero" data-instrument="hero" data-present-screen aria-labelledby="hero-h">/);
  // Left column: the wordmark in small caps above the title in the serif, then one sentence.
  const text = hero.match(/<div class="hero-text">[\s\S]*?<p class="live-line"[\s\S]*?<\/p>\s*<\/div>/)?.[0] ?? '';
  assert.ok(text, 'the hero’s left column is one block ending in the live line');
  assert.match(text, /<p class="eyebrow">[\s\S]*Scalar Commons[\s\S]*?<\/p>\s*<h1 id="hero-h">Observatory<\/h1>/);
  assert.match(text, /<p class="dek">A public test network where AI agents contract, escrow and settle work — read live from the chain\.<\/p>/);
  // Three figures in a row, in order, each with a one-word caption under it, each shipped empty.
  const figures = [...text.matchAll(/<div class="reading hero-figure" data-reading="([^"]+)">([\s\S]*?)<\/div>/g)];
  assert.deepEqual(figures.map((m) => m[1]), ['heroHeight', 'agents', 'activeAgreements']);
  for (const [, key, block] of figures) {
    const caption = block.match(/<p class="reading-label">([\s\S]*?)<\/p>/)?.[1] ?? '';
    const visible = caption.replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, '').trim();
    assert.match(visible, /^[A-Z][a-z]+$/, `${key}'s caption is not one word: "${visible}"`);
    assert.ok(block.indexOf('reading-value') < block.indexOf('reading-label'), `${key}: the caption sits under the figure`);
    assert.ok(!/\d/.test(block.match(/<p class="reading-value[^>]*>([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '')), `${key} ships a figure`);
  }
  assert.match(text, /<p class="live-line" data-state="connecting"><span class="pulse-dot" aria-hidden="true"><\/span> <span class="ll-state">Connecting<\/span> <span class="ll-finality">finality —<\/span><\/p>/);
  // Right column: the constellation, framed, with nothing of the text inside it.
  const panel = hero.match(/<figure class="panel hero-panel instrument"[\s\S]*?<\/figure>/)?.[0] ?? '';
  assert.match(panel, /<figcaption class="panel-head">/);
  assert.match(panel, /<canvas class="constellation-canvas"/);
  assert.ok(!/data-reading=/.test(panel), 'no figure is drawn inside the frame');
  assert.ok(hero.indexOf('hero-text') < hero.indexOf('hero-panel'));
  // The river strip along the foot of the first screen.
  assert.match(hero, /<canvas class="hero-river" aria-hidden="true"><\/canvas>\s*<\/header>/);
  // The geometry: 5/12 and 7/12, a 120 px strip, ~96 px title, 56–64 px figures, never under 32 px.
  assert.match(rule('.hero-text'), /grid-column: 1 \/ span 5/);
  assert.match(rule('.hero-panel'), /grid-column: 6 \/ span 7/);
  assert.match(rule('.hero-river'), /height: 120px/);
  assert.match(rule('.hero h1'), /font-size: clamp\(3\.5rem, [^)]+, 6rem\)/);
  assert.match(rule('.hero-figure .reading-value'), /font-size: clamp\(2\.75rem, [^)]+, 4rem\)/);
  assert.match(css, /\.hero \{[^}]*min-height: calc\(100svh - var\(--bar-height\)\)/);
  // The canvas is contained: the frame clips it, and no canvas covers the page.
  assert.match(rule('.panel'), /border: 1px solid var\(--border\)/);
  assert.match(rule('.panel'), /overflow: hidden/);
  assert.ok(!/position: fixed[^}]*z-index: -1/.test(css), 'no full-page layer behind the text');
});

test('sections 01–06: each has one H2 in the serif, one plain sentence, and its instrument', () => {
  const sections = [...page.matchAll(/<section id="([a-z]+)" class="section" data-instrument="([a-z-]+)" data-present-screen data-reveal aria-labelledby="\1-h">([\s\S]*?)<\/section>/g)];
  assert.deepEqual(sections.map((m) => [m[1], m[2]]), [
    ['chain', 'pulse'],
    ['economy', 'era'],
    ['validators', 'validators'],
    ['history', 'history'],
    ['upgrades', 'upgrades'],
    ['verify', 'verify'],
  ]);
  const titles = ['Chain', 'Economy', 'Validators', 'History', 'Upgrades', 'Verify'];
  sections.forEach(([, id, , body], i) => {
    assert.equal((body.match(/<h2 /g) ?? []).length, 1, `${id} has one heading`);
    assert.match(body, new RegExp(`<p class="section-number">0${i + 1}</p>\\s*<h2 id="${id}-h">${titles[i]}</h2>\\s*<p class="lede">`));
    const lede = body.match(/<p class="lede">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
    assert.ok(lede.length <= 110, `${id}'s sentence is ${lede.length} characters: two lines at most`);
    assert.ok(!/[.!?] [A-Z]/.test(lede), `${id} says more than one sentence`);
    assert.ok(body.indexOf('class="lede"') < body.indexOf('class="instrument'), `${id}: the sentence precedes the instrument`);
    assert.ok(!body.includes('class="means"'), `${id}: no explanatory paragraphs`);
  });
  const keys = (id) => [...section(id).matchAll(/data-reading="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys('chain'), ['bestBlock', 'finalizedBlock', 'finalityLag', 'blocksPerMinute']);
  assert.match(section('chain'), /<canvas class="pulse-canvas"/);
  assert.deepEqual(keys('economy'), ['eraCountdown', 'agentPayouts', 'openDisputes']);
  assert.match(section('economy'), /<div class="dial" data-role="dial"/);
  assert.deepEqual(keys('validators'), ['validators', 'nodeHealth']);
  assert.match(section('validators'), /<svg class="ring"/);
  assert.deepEqual(keys('history'), ['blockTime', 'agreementsCumulative', 'emissionCumulative', 'agentsOverTime']);
  assert.deepEqual(keys('upgrades'), ['specVersion', 'lastUpgrade']);
  assert.match(section('upgrades'), /<div class="rail"/);
  // Verify is collapsed by default.
  assert.match(section('verify'), /<details class="verify">/);
  assert.ok(!/<details class="verify" open/.test(section('verify')));
  // The section heads are the display serif.
  assert.match(rule('h1,\nh2'), /font-family: var\(--font-serif\)/);
});

test('data presentation: figures large, labels short, units small and grey; every chart has a title, a one-line caption and a zero line', () => {
  for (const [, label] of page.matchAll(/<(?:h3|p) class="reading-label">([\s\S]*?)<\/(?:h3|p)>/g)) {
    const visible = label.replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').trim();
    assert.ok(visible.length <= 26, `a label runs long: "${visible}"`);
  }
  assert.match(rule('.reading-value'), /font-family: var\(--font-serif\)/);
  assert.match(rule('.reading-value'), /font-size: clamp\(2\.5rem, [^)]+, 3\.5rem\)/);
  assert.match(rule('.reading-value .unit'), /color: var\(--text-dim\)/);
  assert.match(rule('.reading-value .unit'), /font-size: var\(--text-small\)/);
  for (const [, key, block] of page.matchAll(/<figure class="strip reading" data-reading="([^"]+)">([\s\S]*?)<\/figure>/g)) {
    assert.match(block, /<h3 class="reading-label">[^<]+<\/h3>/, `${key} has no title`);
    const caption = block.match(/<p class="strip-caption">([^<]+)<\/p>/)?.[1] ?? '';
    assert.ok(caption.length > 10 && caption.length <= 80, `${key}'s caption is not one line: "${caption}"`);
  }
  const strips = readFileSync(new URL('../src/observatory/instruments/history.js', import.meta.url), 'utf8');
  assert.ok((strips.match(/'plot-zero'/g) ?? []).length >= 4, 'every strip draws its zero line');
  assert.match(rule('.strip-plot .plot-zero', allCss), /stroke: var\(--text-dim\)/);
});

test('provenance: hidden by default; Sources shows every line in place and is remembered; hovering a figure shows its source as a tooltip', () => {
  const statusbar = page.match(/<div class="statusbar reading"[\s\S]*?<\/div>\n/)[0];
  assert.match(statusbar, /<button type="button" class="sb-sources" role="switch" aria-checked="false">Sources<\/button>/);
  assert.match(page, /<script>try\{if\(localStorage\.getItem\("observatory:sources"\)==="1"\)document\.documentElement\.setAttribute\("data-sources",""\)\}catch\(e\)\{\}<\/script>/);
  assert.match(rule('.reading-prov'), /display: none/);
  assert.match(css, /html\[data-sources\] \.reading-prov \{\s*display: block;\s*position: static;/);
  assert.match(css, /html:not\(\[data-sources\]\) \[data-reading\]:hover > \.reading-prov,\s*html:not\(\[data-sources\]\) \[data-reading\]:focus-within > \.reading-prov \{[^}]*display: block;[^}]*position: absolute;[^}]*border: 1px solid var\(--border\)/);
  assert.ok((page.match(/class="reading-prov"/g) ?? []).length >= 18, 'every figure still carries its line');
  assert.ok(bundle.includes('observatory:sources'), 'the bundle remembers the choice');
});

test('typography: Instrument Serif figures in digit cells, IBM Plex Sans body at 17 px / 1.6 within 60ch, Plex Mono at 12 px for sources, hashes and addresses; a strict spacing scale; 1280 px', () => {
  assert.match(css, /--font-sans: "IBM Plex Sans"/);
  assert.match(css, /--font-serif: "Instrument Serif"/);
  assert.match(rule('body'), /font: 400 1\.0625rem \/ 1\.6 var\(--font-sans\)/);
  assert.match(css, /--measure: 60ch/);
  assert.match(rule('.dc'), /width: 1ch/);
  assert.match(css, /--text-mono: 0\.75rem/);
  for (const selector of ['.reading-prov', '.hash', '.agent-list', '.validator-list']) {
    assert.match(rule(selector, allCss), /font-family: var\(--font-mono\)/, `${selector} is not mono`);
    assert.match(rule(selector, allCss), /font-size: var\(--text-mono\)/, `${selector} is not 12 px`);
  }
  assert.match(rule('.fact .reading-value'), /font-family: var\(--font-mono\)/, 'a hash stays mono');
  // The spacing scale, and nothing else, for every margin, padding and gap in the design system.
  const scale = { 1: '4px', 2: '8px', 3: '16px', 4: '24px', 5: '40px', 6: '64px', 7: '104px' };
  for (const [n, px] of Object.entries(scale)) assert.match(css, new RegExp(`--space-${n}: ${px};`));
  for (const [, prop, value] of css.matchAll(/\n\s+((?:margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)*): ([^;]+);/g)) {
    for (const token of value.split(/\s+/)) {
      assert.match(token, /^(?:0|auto|-?var\(--(?:space-[1-7]|gutter|bar-height)\))$/, `${prop}: ${value} is off the spacing scale`);
    }
  }
  assert.match(css, /--content: 1280px/);
  assert.match(rule('.frame'), /max-width: calc\(var\(--content\) \+ 2 \* var\(--gutter\)\)/);
  const fonts = readdirSync(join(out, 'fonts'));
  assert.ok(fonts.includes('ibm-plex-sans-latin-400-normal.woff2') && fonts.includes('ibm-plex-sans-latin-600-normal.woff2'));
});

test('colour: near-black and paper plates, one teal for live state, amber only for disputes; no gradients, glow or glass', () => {
  const tokens = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => Object.fromEntries([...m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()])));
  const [dark, light] = tokens;
  assert.equal(dark['--bg'], '#0b0e12');
  assert.equal(dark['--text'], '#e8eaed');
  assert.equal(dark['--text-dim'], '#9aa3ad');
  assert.equal(light['--bg'], '#f7f6f2');
  for (const scheme of [dark, light]) {
    for (const name of ['--accent', '--live', '--disputed', '--settled', '--border', '--grid']) assert.ok(scheme[name], `${name} is not defined`);
    assert.equal(scheme['--live'], 'var(--accent)', 'live state is the one accent');
    assert.equal(scheme['--active'], 'var(--accent)');
  }
  // Amber appears only where a dispute is drawn.
  for (const [, selector] of allCss.matchAll(/([^{}]+)\{[^}]*var\(--disputed\)[^}]*\}/g)) {
    assert.match(selector, /disput/, `amber used outside a dispute: ${selector.trim()}`);
  }
  assert.ok(!/gradient\(|box-shadow|text-shadow|backdrop-filter|blur\(/.test(allCss), 'no gradients, glow or glass in the stylesheet');
  for (const [file, src] of clientSources()) {
    assert.ok(!/shadowBlur|live-glow|createLinearGradient|createRadialGradient/.test(src), `${file} draws a glow or gradient`);
  }
});

test('motion: figures tween, sections fade up 12 px once by IntersectionObserver, the new block slides into the river; nothing loops; reduced motion turns it off', () => {
  assert.match(css, /html\.reveal-ready \[data-reveal\]:not\(\.is-in\) \{\s*opacity: 0;\s*transform: translateY\(12px\);/);
  assert.ok(!/@keyframes|animation:/.test(allCss), 'no keyframe animation at all');
  assert.ok(bundle.includes('IntersectionObserver'), 'the reveal is the browser’s observer, no library');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\[data-reveal\] \{\s*opacity: 1;\s*transform: none;\s*transition: none;/);
  const pulse = readFileSync(new URL('../src/observatory/instruments/pulse.js', import.meta.url), 'utf8');
  assert.match(pulse, /animateArrival/, 'the river slides each new block in');
  assert.ok(!/class="[^"]*beat/.test(page) && !bundle.includes('"beat"'), 'no beat: a dot that pulses every block is a loop');
});

test('presenter mode: a small Present button and the P key, the hero first, then the six sections, figures for a room', () => {
  const statusbar = page.match(/<div class="statusbar reading"[\s\S]*?<\/div>\n/)[0];
  assert.match(statusbar, /<button type="button" class="sb-present" aria-pressed="false" aria-keyshortcuts="P">Present<\/button>/);
  assert.ok(!page.includes('data-present=""') && !/present=1/.test(page), 'nothing in the page turns it on from the URL');
  const screens = [...page.matchAll(/<(header|section)(?: id="([a-z]+)")?[^>]*data-present-screen/g)].map((m) => m[2] ?? 'hero');
  assert.deepEqual(screens, ['hero', 'chain', 'economy', 'validators', 'history', 'upgrades', 'verify']);
  for (const selector of ['html[data-present] .site-nav', 'html[data-present] .reading-prov', 'html[data-present] footer', 'html[data-present] [data-present-screen][data-present-active]']) {
    assert.ok(css.includes(selector), `observatory.css has no rule for ${selector}`);
  }
  assert.match(css, /html\[data-present\] \.section \.reading-value \{\s*font-size: clamp\(3rem, 8\.5vw, 160px\)/);
  for (const key of ['Escape', 'aria-pressed']) assert.ok(bundle.includes(key), `the bundle does not handle ${key}`);
  assert.ok(!/<script/i.test(index), 'index.html stays script-free');
});

test('identity: the wordmark with the reticle mark in the status bar and the footer; the favicon is the mark', () => {
  const statusbar = page.match(/<div class="statusbar reading"[\s\S]*?<\/div>\n/)[0];
  assert.match(statusbar, /<a class="wordmark" href="observatory"><svg class="mark"/);
  const footer = page.slice(page.indexOf('<footer'));
  assert.match(footer, /<a class="wordmark" href="observatory"><svg class="mark"/);
  const mark = page.match(/<svg class="mark"[^>]*>([\s\S]*?)<\/svg>/)[1];
  assert.equal((mark.match(/<circle/g) ?? []).length, 2);
  assert.equal((mark.match(/<path/g) ?? []).length, 1);
  assert.match(page, /<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/);
  const favicon = readFileSync(join(out, 'favicon.svg'), 'utf8');
  assert.match(favicon, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24">/);
  const footerText = page.slice(page.indexOf('<footer'));
  assert.match(footerText, /class="merge" data-reading="lastMerge"/, 'the merge line lives in the footer');
  assert.match(footerText, /<details class="howto">/);
});
