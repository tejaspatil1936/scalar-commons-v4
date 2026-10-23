// The operator-written status record: who runs the validators, and where.
//
// Nothing in public/status.json can be read from the chain, so it is held to
// the posture record's rule — every value written once, with the date it was
// true and the repository document it was taken from — and to one more: a host
// or an operator's name may appear on a page only inside the element rendered
// from this record, and in the docs only as a verbatim quotation of it. The
// record is therefore typed in one file, and the page, the docs and the source
// document can never say three different things about who runs what.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from '../src/render.mjs';
import { formatDate } from '../src/chrome/templates.mjs';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = new URL('../../', import.meta.url);
const readRepoFile = (rel) => readFileSync(new URL(rel, repoRoot), 'utf8');
const statusText = readFileSync(new URL('../public/status.json', import.meta.url), 'utf8');
const status = JSON.parse(statusText);
const hosts = status.fields.hosts;

function build() {
  const out = mkdtempSync(join(tmpdir(), 'landing-status-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: landingDir,
    env: { ...process.env, LANDING_OUT_DIR: out },
    stdio: 'pipe',
  });
  return out;
}

const out = build();
const pages = Object.fromEntries(
  ['index.html', 'network.html', 'observatory.html', 'pulse.html'].map((name) => [name, readFileSync(join(out, name), 'utf8')]),
);
const names = Object.values(status.fields).flatMap((entry) => entry.names);
const count = (text, name) => (text.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;

test('every status value carries the date it was true, the document it came from, and the names it uses', () => {
  assert.match(status.updated, /^\d{4}-\d{2}-\d{2}$/);
  const fields = Object.entries(status.fields);
  assert.ok(fields.length >= 1, 'the record is empty');
  assert.ok(hosts, 'the record has no hosts entry');
  for (const [key, entry] of fields) {
    assert.ok(typeof entry.value === 'string' && entry.value.length > 20, `${key} has no value`);
    assert.match(entry.asOf, /^\d{4}-\d{2}-\d{2}$/, `${key} has no asOf date`);
    assert.ok(entry.asOf <= status.updated, `${key} is dated after the record's own update`);
    assert.ok(typeof entry.source === 'string' && entry.source.length > 20, `${key} names no source`);
    assert.ok(Array.isArray(entry.names) && entry.names.length > 0, `${key} lists no names`);
    for (const name of entry.names) assert.ok(count(entry.value, name) > 0, `${key} lists "${name}" but its value never says it`);
    // No count the chain can report is written here: the set and the seats are readings.
    assert.ok(!/\d/.test(entry.value), `${key} types a figure into its value: ${entry.value}`);
    // The source begins with a document in this repository, and that document carries the value word for word.
    const doc = entry.source.match(/^([\w./-]+\.md)/)?.[1];
    assert.ok(doc && existsSync(new URL(doc, repoRoot)), `${key}: the source must begin with the path of a document in this repository`);
    // Markdown hard-wraps, so whitespace is compared loosely; every word, in order, is not.
    const unwrap = (text) => text.replace(/\s+/g, ' ');
    assert.ok(unwrap(readRepoFile(doc)).includes(unwrap(entry.value)), `${key}: ${doc} does not carry the value word for word`);
  }
});

test('the Network page links the record for download from its sources table, dated, and ships the file byte for byte', () => {
  const page = pages['network.html'];
  const sources = page.match(/<section class="sc-section" id="sources"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.ok(sources, 'the page has a sources section');
  assert.match(sources, /<td>Validator hosts<\/td><td><a href="status\.json" download="status\.json">status\.json \(download\)<\/a><\/td>/, 'the record is linked with the download attribute');
  assert.ok(sources.includes(`Operator record, updated ${escapeHtml(formatDate(`${status.updated}T00:00:00Z`))}`), 'the record’s date is printed');
  assert.ok(!page.includes(escapeHtml(hosts.value)), 'the value itself is not printed on the page: the file is the record');
  assert.equal(readFileSync(join(out, 'status.json'), 'utf8'), statusText, 'dist/status.json is the record byte for byte');
});

test('no page prints a host or operator name outside the record', () => {
  for (const [file, html] of Object.entries(pages)) {
    const records = [...html.matchAll(/<p class="instrument-note status-record"[\s\S]*?<\/p>/g)].map((m) => m[0]).join('\n');
    for (const name of names) {
      const outside = count(html, name) - count(records, name);
      assert.equal(outside, 0, `${file} prints "${name}" ${outside} time(s) outside the status record`);
    }
  }
});

test('the docs quote the record verbatim with its date, in one guide only, and the landing source never names a host', () => {
  const guide = readRepoFile('docs/guide/run-a-node.md');
  assert.ok(guide.includes(`${hosts.value} (as of ${hosts.asOf}`), 'docs/guide/run-a-node.md must quote the hosts record followed by its date');
  for (const name of hosts.names) {
    assert.equal(count(guide, name), count(hosts.value, name), `run-a-node.md says "${name}" outside the quoted record`);
  }
  const docsDir = fileURLToPath(new URL('docs/', repoRoot));
  const docPages = ['index.md', ...readdirSync(join(docsDir, 'guide')).map((f) => `guide/${f}`), ...readdirSync(join(docsDir, 'reference')).map((f) => `reference/${f}`)]
    .filter((f) => f.endsWith('.md') && f !== 'guide/run-a-node.md');
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const landingText = ['README.md', ...readdirSync(srcDir).filter((f) => f.endsWith('.mjs')).map((f) => `src/${f}`)];
  for (const rel of docPages) {
    const text = readFileSync(join(docsDir, rel), 'utf8');
    for (const name of names) assert.equal(count(text, name), 0, `docs/${rel} names "${name}"; only the record and run-a-node.md's quotation of it may`);
  }
  for (const rel of landingText) {
    const text = readFileSync(join(landingDir, rel), 'utf8');
    for (const name of names) assert.equal(count(text, name), 0, `landing/${rel} names "${name}"; the name belongs in public/status.json alone`);
  }
});
