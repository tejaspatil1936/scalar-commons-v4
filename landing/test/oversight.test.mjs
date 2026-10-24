// The /oversight page frame, on the plain chrome (SITE-REDESIGN.md §4, §10.7).
//
// What is held here: the URL, the data and the claims are unchanged (the three
// sentences, the devnet caveat in the open, every row of the sample, the
// thread grouped, the honest explorer caveat, no secret anywhere); the page is
// drawn with the shared chrome and nothing legacy; it has a table of contents
// and collapsible groups with only the first open; it contacts no node; and no
// count, date or hash in it is typed by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { EXPLANATION, HOW_TO_READ, TITLE, figuresOf, groupsOf, renderOversight, standfirst } from '../src/oversight.mjs';
import { formatInt } from '../src/chrome/templates.mjs';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const sample = JSON.parse(read('../public/oversight-sample.json'));
const facts = JSON.parse(read('../chain-facts.json'));
const html = renderOversight({ sample, facts, css: '/* css */' });
const doc = new JSDOM(html).window.document;
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

test('the page keeps its title and names the chain it read', () => {
  assert.match(html, /<title>What an operator can and cannot read — Scalar Commons<\/title>/);
  assert.equal(text(doc.querySelector('h1')), TITLE);
  assert.ok(html.includes(sample.provenance.chainName), 'the chain’s own name must appear');
  assert.ok(html.includes(sample.provenance.genesisHash), 'and its genesis hash (in a title)');
  assert.ok(html.includes(sample.provenance.endpoint), 'and where it was read from');
  assert.match(html, /<link rel="canonical" href="https:\/\/scalarnet\.io\/oversight">/);
});

test('it is drawn with the new chrome: one banner, one main, one footer, and no legacy import', () => {
  assert.equal(doc.querySelectorAll('header.sc-header').length, 1);
  assert.equal(doc.querySelectorAll('header, [role="banner"]').length, 1, 'one banner landmark');
  assert.equal(doc.querySelectorAll('main#main').length, 1);
  assert.equal(doc.querySelectorAll('footer.sc-footer').length, 1);
  for (const file of ['../src/oversight.mjs', '../src/oversight/main.js', '../src/oversight-assets.mjs', '../scripts/pages/oversight.mjs', '../scripts/build-oversight-standalone.mjs']) {
    assert.ok(!read(file).includes('chrome-legacy'), `${file} must not import chrome-legacy`);
  }
  assert.ok(!/class="nw-|class="ov-badge|nw-label|nw-tag/.test(html), 'no Ledger classes left');
});

test('it is not in the primary nav, and the footer links it as "Privacy demo"', () => {
  const nav = doc.querySelector('nav.sc-nav');
  assert.ok(![...nav.querySelectorAll('a')].some((a) => /oversight/i.test(a.href)), 'not in the nav');
  assert.equal(nav.querySelector('[aria-current]'), null, 'no nav item claims to be this page');
  const link = [...doc.querySelectorAll('footer a')].find((a) => text(a) === 'Privacy demo');
  assert.equal(link?.getAttribute('href'), '/oversight');
});

test('all content sits inside landmarks, and every <li> is inside a list', () => {
  for (const child of doc.body.children) {
    assert.ok(['HEADER', 'MAIN', 'FOOTER', 'SCRIPT', 'NOSCRIPT'].includes(child.tagName) || child.classList.contains('sc-skip'), `outside a landmark: <${child.tagName.toLowerCase()} class="${child.className}">`);
  }
  for (const li of doc.querySelectorAll('li')) assert.ok(['OL', 'UL'].includes(li.parentElement.tagName), 'an <li> outside a list');
  const ids = [...doc.querySelectorAll('[id]')].map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('a table of contents at the top links every section and every group, and each link lands', () => {
  const toc = doc.querySelector('nav.ov-toc');
  assert.ok(toc, 'there is a table of contents');
  const main = doc.querySelector('main');
  assert.ok(main.innerHTML.indexOf('ov-toc') < main.innerHTML.indexOf('class="ov-section"'), 'it comes before the sections');
  const targets = [...toc.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  for (const id of ['#about', '#thread', '#messages', '#record']) assert.ok(targets.includes(id), `the table of contents misses ${id}`);
  for (const href of targets) assert.ok(doc.getElementById(href.slice(1)), `${href} goes nowhere`);
  for (const g of groupsOf(sample.rows.filter((r) => !sample.summary.thread.rowIds.includes(r.id)))) assert.ok(targets.includes(`#${g.id}`), `the group ${g.title} is not in the table of contents`);
});

test('messages sit in collapsible groups: the first open, the rest collapsed', () => {
  const groups = [...doc.querySelectorAll('details.ov-group')];
  assert.ok(groups.length >= 2);
  assert.equal(groups[0].open, true, 'the first group is open');
  for (const g of groups.slice(1)) assert.equal(g.open, false, `${g.id} should start collapsed`);
  for (const g of groups) assert.ok(g.querySelector('summary h3'), 'each group is titled');
});

test('every row of the sample is rendered once, with its block, kind and commitment', () => {
  const rows = [...doc.querySelectorAll('[data-row]')];
  assert.equal(rows.length, sample.rows.length);
  assert.equal(new Set(rows.map((r) => r.dataset.row)).size, sample.rows.length, 'no row repeated');
  for (const r of sample.rows) {
    const el = doc.querySelector(`[data-row="${r.id}"]`);
    assert.equal(el.dataset.block, String(r.block));
    assert.equal(el.dataset.kind, r.kind);
    if (r.payloadHashOnChain) assert.ok(el.innerHTML.includes(r.payloadHashOnChain), `row ${r.id} lost its commitment`);
    if (r.reason) assert.ok(text(el).includes(r.reason), `row ${r.id} lost its reason`);
    if (r.plaintext) assert.ok(el.querySelector('.sc-code code').textContent === r.plaintext, `row ${r.id} lost its plaintext`);
  }
  const thread = [...doc.querySelectorAll('#thread-messages [data-row]')].map((e) => e.dataset.row);
  assert.deepEqual(thread, sample.summary.thread.rowIds, 'the thread is grouped, in order');
});

test('each message is headed by its kind in words, not the wire name', () => {
  for (const h of doc.querySelectorAll('.ov-kind')) {
    assert.doesNotMatch(text(h), /^[A-Z][a-z]+[A-Z]/, `"${text(h)}" shows a wire name such as DeliveryNotice`);
  }
  const notice = sample.rows.find((r) => r.kind === 'DeliveryNotice');
  if (notice) assert.match(text(doc.querySelector(`[data-row="${notice.id}"] .ov-kind`)), /^Delivery notice, block /);
});

test('message text in a code block keeps the mono face instead of the browser default', () => {
  assert.match(read('../src/oversight.css'), /\.sc-code code \{ font: var\(--mono\); \}/);
});

test('the claims are unchanged: three sentences, how to read this, the devnet caveat, the explorer caveat', () => {
  assert.equal(EXPLANATION.length, 3);
  let at = -1;
  for (const sentence of EXPLANATION) {
    const found = html.indexOf(sentence.replace(/’/g, '’'));
    assert.ok(found > 0, `missing: ${sentence.slice(0, 40)}…`);
    assert.ok(found > at, 'in order');
    at = found;
  }
  for (const [term] of HOW_TO_READ) assert.ok(html.includes(term), `missing: ${term}`);
  assert.ok(html.includes(sample.provenance.networkNote.replace(/’/g, '’')), 'the devnet caveat is in the open');
  assert.ok(text(doc.body).includes(sample.provenance.explorer.note), 'the explorer caveat is said');
  assert.ok(!html.includes('href="https://explorer.scalarnet.io/activity?agent='), 'no link to an explorer that does not index this chain');
});

test('it contacts no node: no localhost, no RPC endpoint, no connecting or offline header text', () => {
  for (const file of ['../src/oversight.mjs', '../src/oversight/main.js']) {
    const src = read(file);
    assert.ok(!/createRpc|from '\.\/rpc\.js'|httpEndpoint/.test(src.replace(/^\s*\/\/.*$/gm, '')), `${file} still reaches for a node`);
  }
  assert.ok(!/127\.0\.0\.1:\d+\/?"|localhost:\d+/.test(html.replace(new RegExp(sample.provenance.endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')), 'no localhost URL in the markup except the recorded read-from address');
  assert.ok(!/href="(?:https?|wss?):\/\/127\.0\.0\.1/.test(html), 'and never as a link');
  assert.ok(!/CONNECTING|OFFLINE|showing recorded values/i.test(html));
  const note = [...doc.querySelectorAll('.sc-callout')].find((c) => /contacts no node/.test(text(c)));
  assert.ok(note, 'the live state is said in a plain callout in the page');
});

test('the figures come from the record, and nothing on the page is a hand-typed count', () => {
  const values = [...doc.querySelectorAll('.sc-stat-value')].map(text);
  assert.deepEqual(values, figuresOf(sample.summary).map((f) => f.value));
  assert.equal(values[1], `${formatInt(sample.summary.decryptedCount)} of ${formatInt(sample.summary.rows)}`);
  assert.ok(text(doc.querySelector('.sc-lead')) === standfirst(sample.rows.length));
  const src = read('../src/oversight.mjs').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const strings = [...src.matchAll(/'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g)].map((m) => m[0].replace(/\$\{[^}]*\}/g, ''));
  for (const s of strings) {
    assert.ok(!/\b\d{2,}\b/.test(s.replace(/blake2b-256|blake2_256|repeat\(\d|minmax\(0, 1fr\)/g, '')), `a literal number in ${s.slice(0, 60)}`);
    assert.ok(!/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|forty)\s+(messages|rows|keys|agents|validators|blocks)\b/i.test(s), `a number in words: ${s.slice(0, 60)}`);
  }
});

test('sentence case: no uppercase labels and no buzzwords on the page', () => {
  const words = text(doc.querySelector('main'));
  assert.ok(!/\b[A-Z]{4,}\b(?<!NaCl)/.test(words.replace(/\b(CMN|RPC|JSON|UTC|HTTP|WSS|NACL|SCALE)\b/g, '')), 'no all-caps labels');
  assert.ok(!/[!]/.test(words.replace(/<!--[\s\S]*?-->/g, '')), 'no exclamation marks');
  for (const w of ['seamless', 'cutting-edge', 'revolutionary', 'unlock', 'empower', 'supercharge', 'next-gen', 'blazing']) assert.ok(!words.toLowerCase().includes(w));
});

test('no secret and no private path reaches the markup', () => {
  for (const forbidden of ['.mnemonic', 'master.seed', '/home/dev', 'secretKey', 'suri', 'SURI']) {
    assert.ok(!html.includes(forbidden), `the page must not contain ${forbidden}`);
  }
  assert.ok(!/\b([a-z]{3,8}\s){11}[a-z]{3,8}\b/.test(html.replace(/<[^>]+>/g, ' ')), 'no mnemonic-shaped run of words');
});

test('the standalone copy inlines its data and its script, and the hosted one does not', () => {
  const standalone = renderOversight({ sample, facts, css: '', inlineData: true, standalone: true, inlineScript: 'console.log(1)' });
  assert.ok(standalone.includes('id="oversight-sample"'), 'the sample rides inside the file');
  assert.ok(standalone.includes('console.log(1)'), 'and so does the script');
  assert.ok(!standalone.includes('src="/oversight.js"'), 'with nothing left to fetch');
  assert.ok(html.includes('src="/oversight.js"'), 'the hosted page loads its script by URL');
  assert.ok(!html.includes('id="oversight-sample"'), 'and carries no second copy of the data');
});

test('a record missing the provenance the page depends on fails the build', () => {
  for (const key of ['explorer', 'callIndex', 'genesisHash']) {
    const broken = { ...sample, provenance: { ...sample.provenance, [key]: undefined } };
    assert.throws(() => renderOversight({ sample: broken, facts }), new RegExp(`provenance\\.${key} is missing`));
  }
  const noThread = { ...sample, summary: { ...sample.summary, thread: null } };
  assert.throws(() => renderOversight({ sample: noThread, facts }), /no complete thread/);
  assert.throws(() => renderOversight({ sample }), /chain-facts\.json/);
});

test('a closing tag inside the inlined data cannot break out of the markup', () => {
  const nasty = { ...sample, rows: [{ ...sample.rows[0], plaintext: '</script><script>alert(1)</script>' }] };
  const standalone = renderOversight({ sample: nasty, facts, css: '', inlineData: true, inlineScript: '' });
  const json = standalone.slice(standalone.indexOf('id="oversight-sample"'));
  assert.ok(!json.slice(0, json.indexOf('</script>')).includes('<script>'), 'no raw script tag survives in the data block');
  assert.ok(!standalone.includes('<script>alert(1)</script>'), 'and none in the rendered row either');
});

test('oversight.css is page-scoped and draws only with tokens', () => {
  const css = read('../src/oversight.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css), 'no colour literal');
  assert.ok(!/text-transform|letter-spacing|animation|box-shadow|gradient|dotted|double/.test(css));
  for (const [, prop, value] of css.matchAll(/(margin[a-z-]*|padding[a-z-]*|gap)\s*:\s*([^;}]+)/g)) {
    assert.ok(/^(0|auto|var\(--s-[1-9]\)|calc\([^)]*\)|\s)+$/.test(value.replace(/var\(--s-[1-9]\)/g, 'var(--s-1)').trim()) || /^[\s0]*$/.test(value), `${prop}: ${value} is off the spacing scale`);
  }
  for (const [, value] of css.matchAll(/font\s*:\s*([^;}]+)/g)) assert.match(value.trim(), /^var\(--(display|h1|h2|h3|lead|body|small|caption|stat|mono)\)$/);
  assert.ok(!/^\s*\.(?!ov)[a-z]/m.test(css.replace(/^\s*\.ov[^{]*\{[^}]*\}/gm, '')), 'every rule is scoped to the page (.ov…)');
});
