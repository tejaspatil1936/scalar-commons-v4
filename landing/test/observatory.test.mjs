// Tests for /observatory — the one page on this site that reads the chain live.
//
// The landing page's rule is "no figure written by hand". The observatory keeps
// it the other way round: its figures are fetched in the browser, so the build
// must ship no figure at all in a reading slot, every endpoint and field the
// script reads must exist in the indexer it reads them from, and the only
// numbers the build does carry — the runtime upgrade table — must agree with
// the upgrade records checked into the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  API_ORIGIN,
  RPC_URL,
  GITHUB_COMMITS_URL,
  SOURCES,
  decodeCompactLength,
  formatInteger,
  relativeTime,
  countSince,
  field,
} from '../src/observatory.js';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = new URL('../../', import.meta.url);
const readRepoFile = (relPath) => readFileSync(new URL(relPath, repoRoot), 'utf8');
const history = JSON.parse(readFileSync(new URL('../runtime-history.json', import.meta.url), 'utf8'));
const clientSource = readFileSync(new URL('../src/observatory.js', import.meta.url), 'utf8');

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

test('the build emits the observatory page with its script and stylesheet', () => {
  const files = readdirSync(out);
  for (const name of ['observatory.html', 'observatory.js', 'observatory.css']) {
    assert.ok(files.includes(name), `build produced no ${name} (got: ${files.join(', ')})`);
  }
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /<script type="module" src="observatory\.js"><\/script>/);
  assert.match(page, /<link rel="stylesheet" href="observatory\.css">/);
  // Served as /observatory by nginx `try_files $uri.html` and by GitHub Pages,
  // so every asset reference is relative to the site root.
  assert.ok(!/(?:src|href)="\/(?!\/)/.test(page), 'observatory.html must not use root-absolute paths');
});

test('the site nav links the observatory, and the landing page stays script-free', () => {
  assert.match(index, /<nav[^>]*>[\s\S]*<a href="observatory">Observatory<\/a>[\s\S]*<\/nav>/);
  assert.match(page, /<nav[^>]*>[\s\S]*<a href="observatory" aria-current="page">Observatory<\/a>[\s\S]*<\/nav>/);
  assert.ok(!/<script/i.test(index), 'index.html must stay script-free');
});

test('no reading ships with a value: every figure on the page is fetched, not built in', () => {
  const values = [...page.matchAll(/<p class="reading-value[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  assert.ok(values.length >= 12, `expected every reading to have a value slot, found ${values.length}`);
  for (const value of values) {
    assert.ok(!/\d/.test(value.replace(/<[^>]+>/g, '')), `a reading ships a built-in figure: ${value}`);
  }
  // Every reading carries a plain-language label, a one-line explanation and a
  // provenance slot the script fills with the endpoint and fetch time.
  const readings = [...page.matchAll(/<div class="reading[^"]*" data-reading="([^"]+)"[\s\S]*?<\/div>/g)];
  for (const [block, key] of readings) {
    assert.match(block, /class="reading-label"/, `${key} has no label`);
    assert.match(block, /class="reading-note"/, `${key} has no explanatory sub-line`);
    assert.match(block, /class="reading-prov"/, `${key} has no provenance line`);
  }
});

test('every reading in the page is fed by a source the script knows', () => {
  const keys = [...page.matchAll(/data-reading="([^"]+)"/g)].map((m) => m[1]);
  const fed = new Set(Object.values(SOURCES).flatMap((source) => source.readings));
  for (const key of keys) {
    assert.ok(fed.has(key), `reading "${key}" has no source in observatory.js`);
  }
});

test('the upgrade table is the checked-in record: 305, 306, 307 applied, 309 scheduled', () => {
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
  const scheduled = history.upgrades.find((u) => u.status === 'scheduled');
  assert.equal(scheduled.wasm, null, 'a scheduled upgrade has no applied wasm to hash');
  assert.equal(scheduled.appliedAtBlock, null);
});

test('each upgrade row agrees with the upgrade record checked into the repo', () => {
  for (const upgrade of history.upgrades.filter((u) => u.recordFile)) {
    const record = readRepoFile(upgrade.recordFile);
    assert.ok(record.includes(`spec ${upgrade.specVersion}`), `${upgrade.recordFile} is not about spec ${upgrade.specVersion}`);
    assert.ok(record.includes(`#${upgrade.appliedAtBlock}`), `${upgrade.recordFile} never names block #${upgrade.appliedAtBlock}`);
    assert.ok(record.includes(upgrade.blockHash), `${upgrade.recordFile} never names block hash ${upgrade.blockHash}`);
    assert.ok(record.includes(upgrade.wasm.blake2_256), `${upgrade.recordFile} never names blake2-256 ${upgrade.wasm.blake2_256}`);
    assert.ok(
      record.includes(upgrade.wasm.bytes.toLocaleString('en-US').replace(/,/g, ' ')),
      `${upgrade.recordFile} never names the ${upgrade.wasm.bytes}-byte blob size`,
    );
  }
  // 307 has no UPGRADE-307.md: its block and sha256 are the operator's record,
  // matched against on-chain :code when the row was written.
  const spec307 = history.upgrades.find((u) => u.specVersion === 307);
  assert.equal(spec307.appliedAtBlock, 813625);
  assert.equal(spec307.wasm.sha256, '0b515ea41bb3b1134072dc696b95d2ce85cf671bf89fc460d8fb20b7cd196d6c');
  for (const upgrade of history.upgrades.filter((u) => u.summarySource)) {
    readRepoFile(upgrade.summarySource); // throws if the cited source is gone
  }
});

test('the upgrade table renders every row, with each applied hash in full and copyable', () => {
  for (const upgrade of history.upgrades) {
    assert.match(page, new RegExp(`<tr[^>]*data-spec="${upgrade.specVersion}"`));
    if (upgrade.wasm) {
      assert.ok(page.includes(upgrade.wasm.sha256), `sha256 for ${upgrade.specVersion} not rendered in full`);
      assert.ok(page.includes(`data-copy="${upgrade.wasm.sha256}"`), `sha256 for ${upgrade.specVersion} has no copy control`);
    }
  }
  assert.match(page, /<tr[^>]*data-spec="309"[^>]*data-status="scheduled"/);
});

test('the script reads only indexer endpoints that exist', () => {
  const api = readRepoFile('indexer/src/api.ts');
  const routes = [...api.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  const toPattern = (route) => new RegExp(`^${route.replace(/:[a-z]+/g, '[^/]+')}$`);
  const indexerSources = Object.entries(SOURCES).filter(([, source]) => source.kind === 'api');
  assert.ok(indexerSources.length >= 6);
  for (const [name, source] of indexerSources) {
    const path = new URL(source.path, API_ORIGIN).pathname;
    assert.ok(
      routes.some((route) => toPattern(route).test(path)),
      `source "${name}" reads ${path}, which indexer/src/api.ts does not serve`,
    );
  }
});

test('every field the script reads from the indexer is one the indexer emits', () => {
  const indexer = readRepoFile('indexer/src/api.ts') + readRepoFile('indexer/src/chainState.ts');
  const paths = [...clientSource.matchAll(/field\([^,]+, '([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(paths.length >= 10, `expected the script to read fields through field(), found ${paths.length}`);
  for (const path of new Set(paths)) {
    for (const segment of path.split('.').filter((s) => !/^\d+$/.test(s))) {
      // JSON-RPC and GitHub envelopes are not the indexer's; their keys are
      // checked where they are read.
      if (['result', 'commit', 'committer', 'date', 'sha', 'html_url'].includes(segment)) continue;
      assert.ok(new RegExp(`\\b${segment}\\b`).test(indexer), `field "${path}" — "${segment}" is not in the indexer source`);
    }
  }
});

test('the script contacts only the chain API, the chain RPC and GitHub', () => {
  assert.equal(API_ORIGIN, 'https://api.scalarnet.io');
  // WebSocket, not HTTPS POST: JSON-RPC over HTTP from a browser needs CORS,
  // and rpc.scalarnet.io answers POSTs with Access-Control-Allow-Origin twice
  // (node --rpc-cors plus nginx), which every browser rejects. A WebSocket
  // handshake is not subject to CORS.
  assert.equal(RPC_URL, 'wss://rpc.scalarnet.io');
  assert.equal(new URL(GITHUB_COMMITS_URL).origin, 'https://api.github.com');
  assert.match(GITHUB_COMMITS_URL, /\/repos\/tejaspatil1936\/scalar-commons-v4\/commits\?sha=master/);
  const hosts = new Set([...clientSource.matchAll(/(?:https|wss):\/\/([a-z0-9.-]+)/g)].map((m) => m[1]));
  const allowed = new Set(['api.scalarnet.io', 'rpc.scalarnet.io', 'api.github.com', 'github.com', 'explorer.scalarnet.io']);
  for (const host of hosts) assert.ok(allowed.has(host), `observatory.js references ${host}`);
});

test('field() refuses to guess at a missing field', () => {
  assert.equal(field({ chain: { bestBlock: 7 } }, 'chain.bestBlock'), 7);
  assert.equal(field({ items: [{ blockNumber: 3 }] }, 'items.0.blockNumber'), 3);
  assert.throws(() => field({ chain: {} }, 'chain.bestBlock'), /chain\.bestBlock/);
  assert.throws(() => field(null, 'chain'), /chain/);
});

test('decodeCompactLength reads the SCALE length prefix of a storage vector', () => {
  assert.equal(decodeCompactLength('0x00'), 0);
  assert.equal(decodeCompactLength('0x14aabb'), 5); // single-byte mode: 5 << 2
  assert.equal(decodeCompactLength('0x0101'), 64); // two-byte mode: (64 << 2) | 1
  assert.equal(decodeCompactLength('0x02000100'), 16384); // four-byte mode
  assert.throws(() => decodeCompactLength(null), /empty/);
  assert.throws(() => decodeCompactLength('0x'), /empty/);
});

test('formatting helpers', () => {
  assert.equal(formatInteger(819086), '819,086');
  assert.equal(formatInteger(0), '0');
  const now = Date.parse('2026-09-29T14:00:00Z');
  assert.equal(relativeTime(now - 30_000, now), 'less than a minute ago');
  assert.equal(relativeTime(now - 60_000, now), '1 minute ago');
  assert.equal(relativeTime(now - 45 * 60_000, now), '45 minutes ago');
  assert.equal(relativeTime(now - 60 * 60_000, now), '1 hour ago');
  assert.equal(relativeTime(now - 5 * 3600_000, now), '5 hours ago');
  assert.equal(relativeTime(now - 72 * 3600_000, now), '3 days ago');
});

test('countSince counts newest-first events at or after a block, and says when the page ran out', () => {
  const items = [{ blockNumber: 30 }, { blockNumber: 20 }, { blockNumber: 10 }];
  assert.deepEqual(countSince(items, 20), { count: 2, reachedStart: true });
  assert.deepEqual(countSince(items, 5), { count: 3, reachedStart: false });
  assert.deepEqual(countSince([], 5), { count: 0, reachedStart: false });
});

test('observatory.css shares the landing palette rather than inventing one', () => {
  const tokens = (css) => {
    const blocks = [...css.matchAll(/(:root(?:[^{]*)?)\{([^}]*)\}/g)].map((m) => m[2]);
    return blocks.map((body) => Object.fromEntries([...body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])));
  };
  const site = tokens(readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'));
  const obs = tokens(readFileSync(new URL('../src/observatory.css', import.meta.url), 'utf8'));
  // Dark block first, light (prefers-color-scheme) block second, in both files.
  for (const [i, scheme] of [
    [0, 'dark'],
    [1, 'light'],
  ]) {
    for (const name of ['--bg', '--text', '--text-dim', '--border', '--accent']) {
      assert.equal(obs[i]?.[name], site[i]?.[name], `${scheme} ${name} differs from styles.css`);
    }
  }
});
