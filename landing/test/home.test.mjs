// The home page (SITE-REDESIGN.md §5.1): the eight parts in order on the
// shared chrome, every figure from chain-facts.json, the live row's hooks,
// one static diagram, under 450 words outside the tables, and nothing of the
// page it replaces. refresh.js is exercised in test/home-refresh.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { content } from '../src/content.mjs';
import { sourceClaims } from '../src/source-claims.mjs';
import { renderPage, LABELS, SECTION_IDS } from '../src/render.mjs';
import { API_V1, RPC_WSS, formatInt, formatUtc } from '../src/chrome/templates.mjs';
import { homeCss, REFRESH_SCRIPT } from '../src/home/assets.mjs';

const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));
const builtAt = '2026-10-23T20:00:00.000Z';
const html = renderPage({ facts, content, sourceClaims, builtAt });
const dom = new JSDOM(html);
const { document } = dom.window;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim();

test('the page: one h1 on the display style, the landmarks, the six titled sections in order, the title and description', () => {
  assert.equal($$('h1').length, 1);
  assert.equal(textOf($('h1')), content.hero.headline);
  assert.ok($('h1').classList.contains('sc-display'));
  for (const sel of ['a.sc-skip[href="#main"]', 'header.sc-header', 'main#main', 'footer.sc-footer']) assert.ok($(sel), `the page has ${sel}`);
  assert.equal($$('main > section').length, 1 + SECTION_IDS.length, 'the hero and six sections');
  assert.deepEqual($$('main > section[id]').map((s) => s.id), SECTION_IDS);
  assert.deepEqual($$('main > section h2').map(textOf), ['Network right now', 'How it works', "What's on chain", 'Token', 'Status and known issues', 'Build on it']);
  for (const s of $$('main > section[id]')) {
    assert.equal(s.getAttribute('aria-labelledby'), `${s.id}-h`);
    assert.equal(s.querySelector('h2').id, `${s.id}-h`);
  }
  assert.equal($('title').textContent, 'Coordination infrastructure for autonomous AI agents — Scalar Commons');
  assert.match($('meta[name="description"]').content, /^Scalar Commons is a sovereign blockchain .* CMN for what they deliver\.$/);
  assert.equal($('link[rel="canonical"]').href, 'https://scalarnet.io/');
  assert.equal($$('nav.sc-nav a[aria-current]').length, 0, 'home is not a nav item, so nothing is current');
  assert.equal($$('style').length, 1, "the page's own rules are inlined once");
  assert.equal($('style').textContent, homeCss());
  assert.ok(!$('[data-copy]'), 'no copy buttons: the page ships no behaviour for them');
});

test('hero: the headline, one lead sentence, Get started and View the network, one caption with the Testnet badge', () => {
  const hero = $('main > section:first-child');
  assert.equal(hero.querySelector('h2'), null, 'the hero has no h2');
  assert.equal(textOf(hero.querySelector('.sc-lead')), content.hero.lead);
  const buttons = [...hero.querySelectorAll('.sc-btn')];
  assert.deepEqual(buttons.map((b) => [textOf(b), b.getAttribute('href'), b.className]), [
    ['Get started', '/docs/guide/run-an-agent', 'sc-btn sc-btn-primary'],
    ['View the network', '/network', 'sc-btn sc-btn-secondary'],
  ]);
  const caption = hero.querySelector('.home-hero-caption');
  assert.equal(textOf(caption.querySelector('.sc-badge')), LABELS.testnet);
  assert.equal(textOf(caption.querySelector('span:not(.sc-badge)')), `Public testnet · runtime ${facts.provenance.specName} ${facts.provenance.specVersion} · ${facts.state.validators} validators`);
  assert.equal(hero.querySelectorAll('svg, img, canvas').length, 0, 'no image, no readings, no block strip');
  assert.equal([...hero.querySelectorAll('p, h1, a')].length, 5, 'headline, lead, two buttons, caption — nothing else');
});

test('network right now: four stats keyed for the refresh, their build-time figures, the hooks, one text button', () => {
  const sec = $('#network-now');
  const statEls = [...sec.querySelectorAll('.sc-stat')];
  assert.deepEqual(statEls.map((s) => s.getAttribute('data-stat')), ['height', 'finalized', 'agents', 'era']);
  assert.deepEqual(statEls.map((s) => textOf(s.querySelector('.sc-stat-label'))), ['Block height', 'Finalized', 'Registered agents', 'Era progress']);
  assert.deepEqual(statEls.map((s) => textOf(s.querySelector('[data-value]'))), [
    formatInt(facts.provenance.readAtBlock),
    formatInt(facts.provenance.finalizedAtRead),
    formatInt(facts.state.registeredAgents),
    formatInt(facts.state.eraElapsedBlocks),
  ]);
  assert.equal(textOf(statEls[3].querySelector('[data-caption]')), `of ${formatInt(facts.constants.emissions.eraDuration)} blocks in era ${formatInt(facts.state.eraNumber)}`);
  assert.equal(sec.querySelector('.sc-stats').getAttribute('aria-label'), 'Network right now');
  const live = sec.querySelector('[data-live]');
  assert.equal(live.getAttribute('data-live'), API_V1);
  assert.ok(live.querySelector('[data-live-warning]').hidden && live.querySelector('[data-live-warning] .sc-callout-warning[role="alert"] [data-live-reason]'));
  assert.ok(live.querySelector('[data-live-stale]').hidden && textOf(live.querySelector('[data-live-stale] .sc-badge-warn')) === LABELS.stale);
  assert.equal(textOf(live.querySelector('.sc-stats-foot [data-live-updated]')), `Read from block ${formatInt(facts.provenance.readAtBlock)} at ${formatUtc(facts.provenance.fetchedAt)}.`);
  const actions = [...sec.querySelectorAll('a.sc-btn')];
  assert.deepEqual(actions.map((a) => [textOf(a), a.getAttribute('href'), a.classList.contains('sc-btn-text')]), [['See the network', '/network', true]]);
});

test('how it works: three numbered steps, two sentences each, then one static SVG of three boxes and two arrows in token colours', () => {
  const sec = $('#how-it-works');
  const steps = [...sec.querySelectorAll('ol.sc-cols-3 > li.home-step')];
  assert.deepEqual(steps.map((s) => textOf(s.querySelector('h3.sc-h3'))), LABELS.flow.map((w, i) => `${i + 1}. ${w}`));
  for (const step of steps) {
    const sentences = textOf(step.querySelector('p')).split(/(?<=\.)\s+/).filter(Boolean);
    assert.equal(sentences.length, 2, `${textOf(step.querySelector('h3'))}: two sentences`);
  }
  const svgs = sec.querySelectorAll('svg');
  assert.equal(svgs.length, 1, 'one diagram');
  const svg = svgs[0];
  assert.equal(svg.getAttribute('role'), 'img');
  assert.match(svg.getAttribute('aria-label'), /^Register, then agree and escrow, then get paid$/);
  assert.equal(svg.hasAttribute('viewBox'), false, 'drawn in CSS pixels so the words never shrink');
  for (const g of ['.home-flow-row', '.home-flow-column']) {
    const group = svg.querySelector(g);
    assert.equal(group.querySelectorAll('rect').length, 3, `${g}: three boxes`);
    assert.equal(group.querySelectorAll('path').length, 2, `${g}: two arrows`);
    assert.deepEqual([...group.querySelectorAll('text')].map(textOf), LABELS.flow, `${g}: the same words`);
  }
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb/i.test(svg.outerHTML), 'colours only from currentColor and the tokens');
  assert.ok(!/<animate|<script|<image|<filter|gradient/i.test(svg.outerHTML));
});

test("what's on chain: the seven modules in plain words, every figure a placeholder, one reference link, no pallet jargon", () => {
  const sec = $('#on-chain');
  assert.deepEqual([...sec.querySelectorAll('thead th')].map(textOf), ['Module', 'What it does']);
  const rows = [...sec.querySelectorAll('tbody tr')];
  assert.deepEqual(rows.map((r) => textOf(r.children[0])), ['Agents', 'Escrow', 'Oracle', 'Orchestrator', 'Emissions', 'Messages', 'Parameters & constitution']);
  for (const r of rows) assert.ok(textOf(r.children[1]).length > 40 && textOf(r.children[1]).endsWith('.'), 'one full sentence each');
  assert.ok(!/\bpallets?\b|autoParams|auto-params/i.test(textOf(sec)), 'the visitor is not shown module internals');
  assert.deepEqual([...sec.querySelectorAll('a.sc-btn-text')].map((a) => [textOf(a), a.getAttribute('href')]), [['Read the reference', '/docs/reference/rpc']]);
  assert.ok(!/\d+ calls/.test(textOf(sec)), 'no call counts');
});

test('token: the key/value table of placeholders, the thesis, the oracle caveat in text-2, the token-model link', () => {
  const sec = $('#token');
  const rows = [...sec.querySelectorAll('table.sc-kv tr')];
  assert.deepEqual(rows.map((r) => textOf(r.querySelector('th'))), ['Symbol', 'Decimals', 'Supply cap', 'Era length', 'Minimum agent stake', 'Registration fee', 'Unstake cooldown']);
  const values = Object.fromEntries(rows.map((r) => [textOf(r.querySelector('th')), textOf(r.querySelector('td'))]));
  assert.equal(values.Symbol, facts.token.symbol);
  assert.equal(values['Supply cap'], '100,000,000,000 CMN');
  assert.equal(values['Era length'], '3,600 blocks, about 6 h');
  assert.equal(values['Minimum agent stake'], '1,000 CMN');
  assert.equal(values['Registration fee'], '50 CMN');
  assert.equal(values['Unstake cooldown'], '7 days (100,800 blocks)');
  assert.equal(textOf(sec.querySelector('p.sc-body:not(.sc-muted)')), content.token.thesis);
  const caveat = sec.querySelector('[data-caveat="oracle-score-provider"]');
  assert.ok(caveat.classList.contains('sc-muted') && caveat.classList.contains('sc-body'));
  assert.match(textOf(caveat), /^Oracle accuracy can add up to 20 % /);
  assert.deepEqual([...sec.querySelectorAll('a.sc-btn-text')].map((a) => a.getAttribute('href')), ['/docs/reference/token-model']);
});

test('status and known issues: a warning callout, the economic gate in three sentences, a text link to the network page', () => {
  const sec = $('#status');
  const callout = sec.querySelector('.sc-callout-warning[role="alert"]');
  assert.equal(textOf(callout), content.status.notice);
  assert.match(textOf(callout), /testnet.*no value.*reset/);
  const gate = sec.querySelector('[data-caveat="economic-gate"]');
  const sentences = textOf(gate).split(/(?<=\.)\s+/).filter(Boolean);
  assert.equal(sentences.length, 3, `three sentences, got ${sentences.length}`);
  assert.match(textOf(gate), new RegExp(`Runtime ${facts.provenance.specName} ${facts.provenance.specVersion} caps`));
  assert.ok(!/FAILED/.test(textOf(gate)), 'sentence case');
  const last = [...sec.querySelectorAll('a')].pop();
  assert.deepEqual([textOf(last), last.getAttribute('href')], ['See the live figures', '/network']);
});

test('build on it: three cards of the same structure with guide links, and the two endpoints from the chrome constants', () => {
  const sec = $('#build');
  const cards = [...sec.querySelectorAll('.sc-cols-3 > article.sc-card')];
  assert.deepEqual(cards.map((c) => [textOf(c.querySelector('h3')), c.querySelector('a.sc-btn-text')?.getAttribute('href')]), [
    ['Run an agent', '/docs/guide/run-an-agent'],
    ['Run a validator', '/docs/guide/run-a-validator'],
    ['Use the SDK', '/docs/guide/sdk'],
  ]);
  for (const c of cards) {
    assert.deepEqual([...c.children].map((e) => e.tagName.toLowerCase()), ['h3', 'p', 'div'], 'every card: title, one sentence, one text button');
    assert.equal(textOf(c.querySelector('a')), 'Read the guide');
    assert.equal(c.querySelectorAll('svg.sc-icon-arrow-right').length, 1);
  }
  const endpoints = [...sec.querySelectorAll('.home-endpoints li')].map((li) => [textOf(li.querySelector('span')), textOf(li.querySelector('code'))]);
  assert.deepEqual(endpoints, [
    ['Public RPC', RPC_WSS],
    ['REST API', API_V1],
  ]);
  assert.equal(sec.querySelectorAll('a.sc-btn-primary').length, 0, 'the one primary button on the page is in the hero');
});

test('one primary button per section, every link goes somewhere, external links are marked', () => {
  for (const sec of $$('main > section')) assert.ok(sec.querySelectorAll('.sc-btn-primary').length <= 1, `${sec.id || 'hero'}: at most one primary button`);
  for (const a of $$('a')) {
    const href = a.getAttribute('href');
    assert.ok(href && href !== '#' && !/^javascript:/.test(href), `a link that goes nowhere: ${a.outerHTML.slice(0, 80)}`);
    if (/^https?:\/\//.test(href) && !/^https:\/\/(?:[a-z]+\.)?scalarnet\.io\//.test(href)) assert.equal(a.getAttribute('rel'), 'noopener', href);
  }
  assert.equal($$('button').length, 0, 'the page has no buttons that need a script');
});

test('nothing of the page this replaces remains: no readings, block strip, curve, manifesto, call counts, formula, Rust, bare URL list', () => {
  for (const gone of [
    'nw-',
    'Stake alone earns nothing',
    'Blocks arriving now',
    'calls ›',
    'weight = ',
    '√stake',
    'How to check any of this',
    'Where to go next',
    'pub const',
    'LAYER 1',
    'AS BUILT',
    'nw-river',
    'nw-manifesto',
    'nw-curve',
    'data-receipt',
    'github.com/tejaspatil1936/scalar-commons-v4</',
    'scalarnet.io/docs</',
    'FAILED',
  ]) {
    assert.ok(!html.includes(gone), `the page still carries "${gone}"`);
  }
  assert.equal($$('pre, canvas, img, details:not(.sc-menu), [data-reading], .nw-reading').length, 0);
  assert.ok(!/text-transform|letter-spacing|@keyframes|animation|transition:(?!\s*(?:color|background-color|border-color))/.test(homeCss()), 'no uppercase, tracking or motion in the page sheet');
});

test('words: under 450 on the page outside the tables', () => {
  const clone = document.body.cloneNode(true);
  for (const el of clone.querySelectorAll('table, [hidden], .home-flow-column, script, style')) el.remove();
  const words = clone.textContent.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  assert.ok(words.length < 450, `${words.length} words outside the tables; the budget is 450`);
  assert.ok(words.length > 250, `${words.length} words is thinner than a home page can be`);
});

test('refresh.js: one plain script under 6 KB, no imports, reads status first and the two routes status lacks, every 12 s while visible', () => {
  const src = readFileSync(REFRESH_SCRIPT, 'utf8');
  assert.ok(statSync(REFRESH_SCRIPT).size <= 6 * 1024);
  assert.ok(!/^\s*(?:import|export)\b/m.test(src), 'served as written: nothing to bundle');
  for (const needle of ["get('/status')", "get('/eras/current')", "get('/agents?limit=1')", '12_000', 'visibilitychange', 'data-live-stale', 'data-live-warning', 'data-live-reason', 'data-live-updated', 'Updated ${s} s ago', 'cache: \'no-store\'']) {
    assert.ok(src.includes(needle), `refresh.js lacks ${needle}`);
  }
  assert.ok(!/\banimate\b|requestAnimationFrame|\btransition\b|innerHTML|\beval\(/.test(src), 'no animation, no markup injection');
  assert.ok(!/https?:\/\//.test(src), 'the API base comes from the page (data-live), not the script');
});
