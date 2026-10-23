// The /oversight page frame, on the plain chrome (SITE-REDESIGN.md §4 row
// "/oversight", §10 item 7, Appendix A items 23–24).
//
// What is held here is what the page must not quietly lose: the head through
// the chrome, the lead and the three paragraphs, the record's provenance, the
// five figures, the "how to read this" rows, a table of contents, every row of
// the sample rendered exactly once in a collapsible group with the first open,
// the full list as its own group, the honest explorer caveat, the in-browser
// check claimed only once it has run — and the rule that a private endpoint is
// never offered to a visitor's browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ALL_GROUP,
  CHECK,
  DISAGREE_WORD,
  EXPLANATION,
  FIGURES,
  GROUPS,
  HOW_TO_READ,
  RECHECK,
  RECORDED_ONLY,
  STANDFIRST,
  STATUS,
  THREAD_GROUP,
  TITLE,
  isPublicEndpoint,
  kindWord,
  renderOversight,
} from '../src/oversight.mjs';
import { escapeHtml, formatInt, formatUtc } from '../src/chrome/templates.mjs';

const readJson = (relative) => JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
const sample = readJson('../public/oversight-sample.json');
const facts = readJson('../chain-facts.json');
const builtAt = facts.provenance.fetchedAt;
const render = (s = sample, extra = {}) => renderOversight({ sample: s, facts, builtAt, css: '/* css */', ...extra });
const html = render();

/** The sample with a public endpoint in its record, for the re-check path. */
const publicSample = {
  ...sample,
  provenance: { ...sample.provenance, endpoint: 'wss://rpc.scalarnet.io', httpEndpoint: 'https://rpc.scalarnet.io' },
};
const publicHtml = render(publicSample);

const detailsOf = (doc, id) => {
  const m = doc.match(new RegExp(`<details class="ov-group" id="${id}"[^>]*>[\\s\\S]*?<\\/details>`));
  return m ? m[0] : null;
};

test('the head goes through the chrome: title, description, canonical, Open Graph, favicon; the page is one h1 inside main', () => {
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
  assert.match(html, /<title>What an operator can and cannot read — Scalar Commons<\/title>/);
  assert.match(html, /<meta name="description" content="A sample of real agent-to-agent messages/);
  assert.match(html, /<link rel="canonical" href="https:\/\/scalarnet\.io\/oversight">/);
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) assert.match(html, new RegExp(`property="${p}"`));
  assert.match(html, /<link rel="icon" href="\/favicon\.svg"/);
  assert.match(html, /<script type="module" src="oversight\.js"><\/script>/);
  assert.match(html, /<style>\/\* css \*\/<\/style>/, 'the stylesheet is inlined');
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<main id="main">[\s\S]*<h1 class="sc-h1">What an operator can and cannot read<\/h1>/);
  assert.match(html, /<a class="sc-skip" href="#main">Skip to content<\/a>/);
});

test('the header and footer are the shared chrome: the page is in neither nav, and the footer links it as the privacy demo', () => {
  const header = html.match(/<header class="sc-header">[\s\S]*?<\/header>/)[0];
  assert.deepEqual([...header.matchAll(/<nav class="sc-nav"[^>]*>([\s\S]*?)<\/nav>/g)].length, 1);
  assert.ok(!/aria-current="page"/.test(header), 'no nav item is current on this page');
  assert.ok(!/Oversight|Privacy demo/.test(header), 'the page is not in the primary nav');
  for (const gone of ['AS BUILT', 'data-sources-switch', 'data-lamp', '⌘K', 'Present', 'nw-', 'Reading the chain', 'connecting', 'CONNECTING']) {
    assert.ok(!html.includes(gone), `the page carries ${gone}`);
  }
  const footer = html.match(/<footer class="sc-footer">[\s\S]*?<\/footer>/)[0];
  assert.match(footer, /href="\/oversight">Privacy demo</);
  assert.ok(footer.includes(`Runtime ${facts.provenance.specName} ${facts.provenance.specVersion}. Page built ${formatUtc(builtAt)} from block ${formatInt(facts.provenance.readAtBlock)}.`));
});

test('the lead and the three paragraphs are there, in order, in the reading column, before everything else', () => {
  assert.ok(html.includes(`<p class="sc-lead">${escapeHtml(STANDFIRST)}</p>`));
  assert.equal(EXPLANATION.length, 3, 'the brief asked for three sentences');
  const prose = html.match(/<div class="sc-reading sc-prose">([\s\S]*?)<\/div>/)[1];
  let at = -1;
  for (const sentence of EXPLANATION) {
    const found = prose.indexOf(`<p>${sentence}</p>`);
    assert.ok(found > at, `missing or out of order: ${sentence.slice(0, 40)}…`);
    at = found;
  }
  assert.ok(html.indexOf('sc-reading sc-prose') < html.indexOf('<section'), 'the prose comes before the sections');
});

test('the record: the devnet note as an info callout, and a key/value table with every figure from the record', () => {
  const p = sample.provenance;
  assert.match(html, new RegExp(`<div class="sc-callout sc-callout-info" role="note">[\\s\\S]*?<strong>${escapeHtml(p.chainName)}</strong><div>${escapeHtml(p.networkNote)}</div>`));
  const record = html.match(/<section class="sc-section" id="record"[\s\S]*?<\/section>/)[0];
  assert.match(record, /<table class="sc-table sc-kv"><caption class="sc-sr">The record<\/caption>/);
  for (const [label, value] of [
    ['Chain', escapeHtml(p.chainName)],
    ['Read from', `<code class="sc-mono">${escapeHtml(p.endpoint)}</code>`],
    ['At block', formatInt(p.generatedAtBlock)],
    ['Generated', formatUtc(p.generatedAt)],
    ['Blocks scanned', `${formatInt(p.scannedToBlock)} to ${formatInt(p.scannedFromBlock)}`],
    ['Genesis hash', p.genesisHash],
    ['Runtime version', formatInt(p.specVersion)],
    ['Tool', escapeHtml(p.tool)],
    ['Operator key check', escapeHtml(sample.summary.selfCheck)],
    ['Messages in those blocks', formatInt(p.messagesSeenInWindow)],
    ['Explorer', escapeHtml(p.explorer.note)],
  ]) {
    assert.match(record, new RegExp(`<th scope="row">${label}</th><td>[\\s\\S]*?${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${label}: ${value}`);
  }
  assert.ok(record.includes(escapeHtml(`${sample.summary.selfCheckDetail.method}.`)), 'the self-check method, verbatim');
  assert.ok(record.includes(escapeHtml(p.scanStoppedBecause)), 'why the scan stopped, verbatim');
  assert.match(record, /href="\/oversight-sample\.json" download="oversight-sample\.json">oversight-sample\.json \(download\)/);
  assert.ok(!/ISO|T\d\d:\d\d:\d\d\.\d+Z<\//.test(record), 'no raw ISO timestamp is shown as text');
});

test('a private endpoint (the record’s) gets the one sentence and no re-check: no status line, no per-row provenance, no attempt', () => {
  assert.equal(isPublicEndpoint(sample.provenance.httpEndpoint), false, 'the record names a loopback node');
  assert.ok(html.includes(`<div class="sc-callout sc-callout-info" role="note">`) && html.includes(`<div>${escapeHtml(RECORDED_ONLY)}</div>`), 'the sentence, in a plain info callout');
  assert.ok(!html.includes('data-ov-status'), 'no status line');
  assert.ok(!html.includes('data-prov="row"'), 'no per-row provenance line');
  assert.ok(!html.includes(STATUS.reading) && !html.includes('Offline'), 'no connecting or offline state');
  // The private address appears only as data in the record table, never as a URL the page would fetch.
  assert.ok(!/(?:src|href|action)="[^"]*127\.0\.0\.1/.test(html));
});

test('isPublicEndpoint: public https and wss only; http, loopback, private ranges and bare hosts are not', () => {
  for (const ok of ['https://rpc.scalarnet.io', 'wss://rpc.scalarnet.io', 'https://node.example.org:9944/path', 'wss://1.2.3.4']) assert.equal(isPublicEndpoint(ok), true, ok);
  for (const no of [
    'http://127.0.0.1:9966',
    'ws://127.0.0.1:9966',
    'http://rpc.scalarnet.io',
    'https://127.0.0.1',
    'https://localhost',
    'https://10.0.0.1',
    'https://192.168.1.2',
    'https://172.16.0.1',
    'https://node',
    'wss://[::1]:9944',
    '',
    null,
    'not a url',
  ]) {
    assert.equal(isPublicEndpoint(no), false, String(no));
  }
});

test('a public endpoint in the record keeps the re-check path: a status line and a provenance line per message, and no "not public" sentence', () => {
  assert.ok(publicHtml.includes('data-ov-status'), 'the status line exists');
  assert.ok(publicHtml.includes(`<span data-status-text>${escapeHtml(STATUS.reading)}</span>`));
  assert.equal((publicHtml.match(/data-prov="row"/g) ?? []).length, sample.rows.length, 'one provenance line per message');
  assert.ok(!publicHtml.includes(RECORDED_ONLY));
});

test('the five figures go through stats(): four from the record, the fifth a skeleton the browser fills', () => {
  const stats = html.match(/<div class="sc-stats"[^>]*>[\s\S]*?<\/div><\/div><\/section>/)[0];
  assert.equal((stats.match(/class="sc-stat"/g) ?? []).length, 5);
  assert.deepEqual(FIGURES.map(([key]) => key), ['selfCheck', 'decryptedCount', 'noKeyHeldCount', 'signaturesVerified']);
  const d = sample.summary.selfCheckDetail;
  assert.match(stats, new RegExp(`data-stat="selfCheck">[\\s\\S]*?data-value>${d.keysMatched} of ${d.keysPublishedOnChain}<`));
  for (const key of ['decryptedCount', 'noKeyHeldCount', 'signaturesVerified']) {
    assert.match(stats, new RegExp(`data-stat="${key}">[\\s\\S]*?data-value>${sample.summary[key]} of ${sample.summary.rows}<`), key);
  }
  for (const [, label] of FIGURES) assert.ok(stats.includes(`<span class="sc-stat-label">${escapeHtml(label)}</span>`), label);
  assert.match(stats, new RegExp(`data-stat="${RECHECK[0]}">[\\s\\S]*?<span class="sc-stat-value" data-value><span class="sc-skeleton"`), 'the reader’s own figure starts as a skeleton, not a number');
  assert.ok(stats.includes(`<span class="sc-stat-label">${escapeHtml(RECHECK[1])}</span>`));
});

test('"How to read this" is a key/value table with the five rows, verbatim', () => {
  const section = html.match(/<section class="sc-section" id="how-to-read"[\s\S]*?<\/section>/)[0];
  assert.match(section, /<h2 class="sc-h2" id="how-to-read-h">How to read this<\/h2>/);
  assert.equal(HOW_TO_READ.length, 5);
  for (const [term, text] of HOW_TO_READ) {
    assert.ok(section.includes(`<th scope="row">${escapeHtml(term)}</th><td>${escapeHtml(text)}</td>`), term);
  }
});

test('the table of contents is a plain list of links to every group and to the full list, with counts from the record', () => {
  const toc = html.match(/<nav class="ov-toc sc-prose" aria-labelledby="toc-h">[\s\S]*?<\/nav>/)[0];
  assert.match(toc, /<h3 class="sc-h3" id="toc-h">Contents<\/h3>/);
  const links = [...toc.matchAll(/<a href="#([^"]+)">([^<]+)<\/a> <span class="sc-muted">\((\d+)\)<\/span>/g)].map((m) => [m[1], m[2], Number(m[3])]);
  assert.ok(links.length >= 3, 'the thread, at least one more group, and the full list');
  assert.deepEqual(links[0], [THREAD_GROUP.id, THREAD_GROUP.title, sample.summary.thread.rowIds.length]);
  assert.deepEqual(links.at(-1), [ALL_GROUP.id, ALL_GROUP.title, sample.rows.length]);
  for (const [id] of links) assert.ok(html.includes(`<details class="ov-group" id="${id}"`), `${id} is a group on the page`);
  assert.equal(links.slice(0, -1).reduce((n, [, , c]) => n + c, 0), sample.rows.length, 'the groups add up to the record');
  // The contents come after the record, the figures and how-to-read, and before the first group.
  assert.ok(html.indexOf('id="how-to-read"') < html.indexOf('ov-toc') && html.indexOf('ov-toc') < html.indexOf('<details class="ov-group"'));
});

test('the groups are native <details>, the first open and the rest shut, each holding the shared table', () => {
  const groups = [...html.matchAll(/<details class="ov-group" id="([^"]+)"( open)?>/g)].map((m) => [m[1], Boolean(m[2])]);
  assert.equal(groups[0][0], THREAD_GROUP.id);
  assert.deepEqual(groups.map(([, open]) => open), groups.map((_, i) => i === 0), 'only the first is open');
  assert.equal(groups.at(-1)[0], ALL_GROUP.id);
  for (const [id] of groups) {
    const d = detailsOf(html, id);
    assert.match(d, /<summary><h3 class="sc-h3">[^<]+<\/h3><span class="sc-caption">\d+ messages?<\/span><svg class="sc-icon sc-icon-chevron-right[\s\S]*?<svg class="sc-icon sc-icon-chevron-down/, `${id}: a summary with the chrome’s chevrons`);
    assert.match(d, /<div class="sc-table-wrap"><table class="sc-table ov-table[^"]*"><caption class="sc-sr">/, `${id}: the shared table`);
  }
  assert.deepEqual([...detailsOf(html, THREAD_GROUP.id).matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]), ['Block', 'Kind', 'From and to', 'Message', 'Checks']);
  assert.deepEqual([...detailsOf(html, ALL_GROUP.id).matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]), ['Block', 'Kind', 'From', 'To', 'Body', 'Shown in']);
});

test('every message is rendered exactly once in a group, and the thread holds its three in order', () => {
  const ids = [...html.matchAll(/id="msg-([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, sample.rows.length, 'no row may be dropped or repeated');
  assert.deepEqual(new Set(ids), new Set(sample.rows.map((r) => r.id)));
  const thread = detailsOf(html, THREAD_GROUP.id);
  const threadIds = [...thread.matchAll(/id="msg-([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(threadIds, sample.summary.thread.rowIds);
  assert.deepEqual(threadIds.map((id) => sample.rows.find((r) => r.id === id).kind), ['Offer', 'Accept', 'DeliveryNotice']);
  assert.ok(thread.includes(escapeHtml(sample.summary.thread.agreement)), 'the agreement tag is named');
  // Each remaining message sits in the group its body state names.
  for (const g of GROUPS) {
    const d = detailsOf(html, g.id);
    const expected = sample.rows.filter((r) => !sample.summary.thread.rowIds.includes(r.id) && g.holds(r)).map((r) => r.id);
    if (!expected.length) {
      assert.equal(d, null, `${g.id} is left out when empty`);
      continue;
    }
    assert.deepEqual([...d.matchAll(/id="msg-([^"]+)"/g)].map((m) => m[1]), expected, g.id);
  }
});

test('every message row carries its block, time, kind in plain words, parties, commitment and reason', () => {
  for (const row of sample.rows) {
    const cell = html.match(new RegExp(`<span class="sc-num" id="msg-${row.id}" data-block="${row.block}" data-extrinsic-index="${row.extrinsicIndex}" data-extrinsic-hash="${row.extrinsicHash}">${formatInt(row.block)}</span><span class="sc-caption" title="${row.timestamp}">${formatUtc(row.timestamp)}</span>`));
    assert.ok(cell, `row ${row.id}: block and time`);
    assert.ok(html.includes(`<span data-field="kind" data-for="${row.id}" data-kind="${row.kind}">${escapeHtml(kindWord(row.kind))}</span>`), `row ${row.id}: kind`);
    if (row.payloadHashOnChain) assert.ok(html.includes(`<span data-field="payloadHash" data-for="${row.id}"><span class="sc-addr"><span title="${row.payloadHashOnChain}">`), `row ${row.id}: commitment`);
    assert.ok(html.includes(escapeHtml(row.reason)), `row ${row.id}: its reason, verbatim`);
    for (const addr of [row.from, row.to]) assert.ok(html.includes(`title="${addr}"`), `row ${row.id}: ${addr}`);
  }
  assert.equal(kindWord('DeliveryNotice'), 'Delivery notice');
  assert.equal(kindWord('DisputeNote'), 'Dispute note');
  assert.equal(kindWord('Offer'), 'Offer');
  assert.ok(!html.includes('>DeliveryNotice<'), 'no kind is shown as an identifier');
});

test('the full list indexes every message in block order and links each to where it is shown', () => {
  const all = detailsOf(html, ALL_GROUP.id);
  const links = [...all.matchAll(/<a href="#msg-([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.equal(links.length, sample.rows.length);
  const blocks = links.map(([id]) => sample.rows.find((r) => r.id === id).block);
  assert.deepEqual(blocks, [...blocks].sort((a, b) => a - b), 'in block order');
  for (const [id, where] of links) {
    assert.ok(html.includes(`id="msg-${id}"`), `${id} is on the page`);
    const group = [THREAD_GROUP, ...GROUPS].find((g) => g.title === where);
    assert.ok(group, `${where} is a group`);
  }
  assert.ok(!all.includes('sc-copy'), 'the index carries no copy buttons; the message rows do');
});

test('rows the operator could not open are rendered with their reason, and a decrypted plaintext is shown as text', () => {
  const shut = sample.rows.filter((r) => r.plaintext === null);
  assert.ok(shut.length > 0, 'the sample must contain some');
  for (const row of shut) assert.ok(html.includes(escapeHtml(row.reason)), `row ${row.id}: its reason must be on the page`);
  assert.ok(html.includes('Sealed — no key held'), 'the no-key label the brief asked for, verbatim');
  assert.ok(!html.includes('"plaintext":'), 'no raw JSON row is dumped into the markup');
  const open = sample.rows.find((r) => r.decrypted);
  assert.ok(html.includes(`<code class="sc-mono ov-plaintext">${escapeHtml(open.plaintext)}</code>`), 'the plaintext, as text');
  const sealedOpen = sample.rows.find((r) => r.decrypted);
  const plain = sample.rows.find((r) => r.bodyType === 'Plain');
  assert.match(sealedOpen.reason, /opened with the operator\u2019s escrowed key/);
  assert.match(plain.reason, /Plain \u2014 public on chain/);
  for (const r of sample.rows.filter((x) => x.bodyType === 'Sealed' && !x.decrypted)) {
    assert.ok(html.includes(`Encrypted payload, ${formatInt(r.payloadLen)} bytes; not opened.`), `row ${r.id}: the payload size, from the record`);
  }
});

test('the in-browser check is claimed only once it has run; the signature is attributed to the operator’s tool', () => {
  const withText = sample.rows.filter((r) => r.plaintext !== null).length;
  assert.equal((html.match(new RegExp(`data-check="commitment" data-for="[^"]+" data-state="pending">${escapeHtml(CHECK.pending)}<`, 'g')) ?? []).length, withText);
  assert.equal((html.match(new RegExp(`data-state="na" title="[^"]*">${escapeHtml(CHECK.none)}<`, 'g')) ?? []).length, sample.rows.length - withText);
  assert.ok(!html.includes(CHECK.recorded) && !html.includes(CHECK.live), 'no pre-baked tick for a check the browser has not done yet');
  assert.equal((html.match(/data-check="signature" data-state="ok"/g) ?? []).length, sample.rows.filter((r) => r.signatureVerified).length);
  assert.ok(html.includes('Signature verified by the operator’s tool'));
  assert.equal((html.match(new RegExp(`data-disagree data-for="[^"]+" hidden>${DISAGREE_WORD}<`, 'g')) ?? []).length, sample.rows.length, 'the disagreement word is on every row, hidden until it is true');
  assert.ok(!/DISAGREES|VERIFIED|SEALED|RECORD<\//.test(html), 'sentence case: no shouted words');
});

test('the explorer link is honest about which chain the explorer indexes', () => {
  assert.equal(sample.provenance.explorer.indexesThisChain, false, 'this sample is a devnet');
  assert.ok(html.includes(escapeHtml(sample.provenance.explorer.note)), 'so the record table says why there is no link');
  assert.ok(!html.includes('explorer.scalarnet.io/activity?agent='), 'and no such href may be emitted');
  const indexed = { ...sample, provenance: { ...sample.provenance, explorer: { ...sample.provenance.explorer, indexesThisChain: true } } };
  const indexedHtml = render(indexed);
  assert.ok(indexedHtml.includes(`href="${sample.provenance.explorer.base}?agent=${sample.rows[0].from}"`), 'on the public chain each party links to its activity');
});

test('no secret and no private path reaches the markup', () => {
  for (const forbidden of ['.mnemonic', 'master.seed', '/home/dev', 'secretKey', 'suri', 'SURI']) {
    assert.ok(!html.includes(forbidden), `the page must not contain ${forbidden}`);
  }
  // A mnemonic is twelve or more lowercase words in a row; nothing on this page
  // should look like one.
  assert.ok(!/\b([a-z]{3,8}\s){11}[a-z]{3,8}\b/.test(html.replace(/<[^>]+>/g, ' ')), 'no mnemonic-shaped run of words');
});

test('a record missing the provenance the page depends on fails the build, and so does a render without the facts', () => {
  for (const key of ['explorer', 'httpEndpoint', 'callIndex']) {
    const broken = { ...sample, provenance: { ...sample.provenance, [key]: undefined } };
    assert.throws(() => render(broken), new RegExp(`provenance\\.${key} is missing`));
  }
  const noThread = { ...sample, summary: { ...sample.summary, thread: null } };
  assert.throws(() => render(noThread), /no complete thread/);
  assert.throws(() => renderOversight({ sample, css: '' }), /facts/);
});

test('a plaintext that looks like markup is escaped, so a row cannot break out of its cell', () => {
  const nasty = { ...sample, rows: sample.rows.map((r, i) => (i === 0 ? { ...r, plaintext: '</td></table><script>alert(1)</script>' } : r)) };
  const out = render(nasty);
  assert.ok(!out.includes('<script>alert(1)</script>'));
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('oversight.css is written to the tokens: no legacy token, no colour of its own, no animation, no dimming by opacity', () => {
  const css = readFileSync(fileURLToPath(new URL('../src/oversight.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.test(css), 'a colour literal');
  assert.ok(!/--(?:ink|paper|rule|sage|t-ui|ease-ui|figure-|label)\b/.test(css), 'a Ledger token');
  assert.ok(!/nw-|opacity|@keyframes|animation|transform|radial-gradient|uppercase|letter-spacing/.test(css));
  for (const [, name] of css.matchAll(/var\(--([a-z0-9-]+)\)/g)) {
    assert.ok(/^(?:s-\d|bg|bg-2|border|control|text|text-2|text-3|accent|accent-2|ok|warn|bad|caption|small|body|mono|radius|radius-sm)$/.test(name), `--${name} is not a chrome token`);
  }
});
