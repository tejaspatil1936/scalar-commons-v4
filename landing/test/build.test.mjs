// The gate for issue #74 is `npm ci && npm run build`, so the build script
// itself is under test: it must emit a self-contained static site into the
// output directory and must refuse to emit a page with unresolved content.
//
// The home page (SITE-REDESIGN.md §5.1) is held to the brief here: its eight
// sections in order, the hero's two buttons and nothing else, four live stats
// refreshed by one plain script of at most 6 KB, under 450 words outside the
// tables, every link going somewhere, and no figure that is not chain data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { content } from '../src/content.mjs';
import { proseOf, placeholdersIn, resolve, storageKey } from '../src/render.mjs';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));

const out = mkdtempSync(join(tmpdir(), 'landing-build-'));
execFileSync(process.execPath, ['scripts/build.mjs'], {
  cwd: landingDir,
  env: { ...process.env, LANDING_OUT_DIR: out },
  stdio: 'pipe',
});
const indexHtml = readFileSync(join(out, 'index.html'), 'utf8');
const doc = new JSDOM(indexHtml).window.document;
const main = doc.querySelector('main');
const words = (text) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const textOf = (el, skip = 'table, svg, code, [hidden], .sc-sr, template') => {
  const clone = el.cloneNode(true);
  for (const x of clone.querySelectorAll(skip)) x.remove();
  return clone.textContent.replace(/\s+/g, ' ').trim();
};
const sentences = (text) => text.trim().split(/(?<=\.)\s+/).length;

test('npm run build emits a self-contained static site', () => {
  const files = readdirSync(out);
  for (const f of ['index.html', 'styles.css', 'home.js', 'favicon.svg', 'og.png']) assert.ok(files.includes(f), `build produced no ${f} (got: ${files.join(', ')})`);
  assert.ok(readdirSync(join(out, 'fonts')).includes('inter-latin-wght-normal.woff2'));
  assert.match(indexHtml, /^<!doctype html>/i);
  assert.match(indexHtml, /<link rel="stylesheet" href="\/styles\.css">/);
  const css = readFileSync(join(out, 'styles.css'), 'utf8');
  assert.ok(/--accent:\s*#1457d6/.test(css) && css.includes('.sc-header') && css.includes('.home-hero'), 'styles.css is the plain chrome plus the home rules');
  assert.ok(!/\.nw-|Source Serif|IBM Plex/.test(css), 'styles.css carries nothing of the Ledger chrome');
});

test('one plain script, at most 6 KB, not bundled: the home page’s only script', () => {
  const scripts = [...doc.querySelectorAll('script')];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].getAttribute('src'), '/home.js');
  const js = readFileSync(join(out, 'home.js'), 'utf8');
  assert.ok(js.length <= 6 * 1024, `home.js is ${js.length} bytes; the budget is 6 KB`);
  assert.ok(!/(?:^|[;}\s])import\s*[({"'\w]|(?:^|[;}\s])export\s/.test(js), 'home.js imports nothing: a plain script, no bundle');
  for (const route of ['/status', '/eras/current', '/agents?limit=1']) assert.ok(js.includes(route), `home.js reads ${route}`);
  // Every route it reads is one the indexer serves (indexer/src/api.ts), never an invented one.
  const api = readFileSync(join(repoRoot, 'indexer/src/api.ts'), 'utf8');
  for (const route of ['/v1/status', '/v1/eras/current', '/v1/agents']) assert.ok(api.includes(`path: '${route}'`), `${route} is not an indexer route`);
  const source = readFileSync(new URL('../src/home/refresh.js', import.meta.url), 'utf8');
  assert.match(source, /setInterval\(poll, 12_000\)/, 'polls every 12 s');
  assert.match(source, /visibilityState !== 'visible'\) return/, 'only while the tab is visible');
  assert.ok(!/requestAnimationFrame|animate\(|transition/.test(source), 'values replace their text in place, never animated');
  // The genesis read never leaves a skeleton for good: a socket that closes
  // without an error, or a node that never answers, ends in the plain cause.
  assert.match(source, /ws\.onclose = fail/, 'a socket closed before the answer shows the cause');
  assert.match(source, /setTimeout\(\(\) => \{[^}]*fail\(\)/, 'a node that never answers shows the cause');
});

test('head: title, description, canonical, Open Graph, favicon, lang; one h1; the landmarks and the skip link', () => {
  assert.equal(doc.title, 'Coordination infrastructure for autonomous AI agents — Scalar Commons');
  assert.equal(doc.documentElement.lang, 'en');
  assert.ok(doc.querySelector('meta[name="description"]').content.length > 40);
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://scalarnet.io/');
  assert.ok(doc.querySelector('meta[property="og:image"]'));
  assert.ok(doc.querySelector('link[rel="icon"]'));
  assert.equal(doc.querySelectorAll('h1').length, 1);
  assert.equal(doc.querySelectorAll('main').length, 1);
  assert.equal(doc.querySelectorAll('header.sc-header').length, 1);
  assert.equal(doc.querySelectorAll('footer.sc-footer').length, 1);
  assert.ok(doc.querySelector('a.sc-skip[href="#main"]'));
});

test('the eight sections of §5.1, in order: hero, then six sections with an h2 each, then the footer', () => {
  const sections = [...main.querySelectorAll(':scope > .home > section')];
  assert.equal(sections.length, 7);
  assert.ok(sections[0].classList.contains('home-hero') && !sections[0].querySelector('h2'));
  assert.deepEqual(
    sections.slice(1).map((s) => s.querySelector('h2').textContent),
    ['Network right now', 'How it works', 'What’s on chain', 'Token', 'Status and known issues', 'Build on it'],
  );
  assert.ok(main.nextElementSibling.matches('footer.sc-footer'));
});

test('hero: a display headline of at most eight words, the lead sentence, Get started and View the network, one caption with the Testnet badge; nothing else', () => {
  const hero = main.querySelector('.home-hero .sc-container');
  assert.deepEqual([...hero.children].map((c) => c.tagName.toLowerCase()), ['h1', 'p', 'div', 'p']);
  const h1 = hero.querySelector('h1');
  assert.ok(h1.classList.contains('sc-display'));
  assert.ok(words(h1.textContent) <= 8);
  assert.equal(hero.querySelector('.sc-lead').textContent, 'A sovereign blockchain where AI agents register, agree on work, hold funds in escrow and get paid for what they deliver.');
  const buttons = [...hero.querySelectorAll('.sc-actions a')].map((a) => [a.className, a.textContent, a.getAttribute('href')]);
  assert.deepEqual(buttons, [
    ['sc-btn sc-btn-primary', 'Get started', '/docs/guide/run-an-agent'],
    ['sc-btn sc-btn-secondary', 'View the network', '/network'],
  ]);
  const caption = hero.lastElementChild;
  assert.equal(caption.querySelector('.sc-badge').textContent, 'Testnet');
  assert.equal(
    caption.querySelector('span:not(.sc-badge)').textContent,
    // A figure and its unit never part at a line break: no-break spaces join them.
    `Public testnet · runtime ${facts.provenance.specName}\u00a0${facts.provenance.specVersion} · ${facts.state.validators}\u00a0validators`,
  );
});

test('network right now: four stats from the build record, the caption, a hidden Stale badge and warning, one text button', () => {
  const now = main.querySelector('#network-now');
  assert.equal(now.dataset.api, 'https://api.scalarnet.io/v1');
  assert.equal(now.dataset.readAt, facts.provenance.fetchedAt);
  const stats = [...now.querySelectorAll('.sc-stat')];
  assert.deepEqual(stats.map((s) => s.dataset.stat), ['height', 'finalized', 'agents', 'era']);
  assert.deepEqual(stats.map((s) => s.querySelector('.sc-stat-label').textContent), ['Block height', 'Finalized', 'Registered agents', 'Era progress']);
  const fmt = (n) => Number(n).toLocaleString('en-US');
  assert.deepEqual(stats.map((s) => s.querySelector('.sc-stat-value').textContent), [
    fmt(facts.provenance.readAtBlock),
    fmt(facts.provenance.finalizedAtRead),
    fmt(facts.state.registeredAgents),
    fmt(facts.state.eraElapsedBlocks),
  ]);
  assert.equal(stats[3].querySelector('.sc-stat-caption').textContent, `of ${fmt(facts.constants.emissions.eraDuration)} blocks`);
  assert.ok(now.querySelector('[data-stale]').hidden && now.querySelector('[data-stale] .sc-badge').textContent === 'Stale');
  assert.ok(now.querySelector('[data-notice]').hidden && now.querySelector('[data-notice] .sc-callout-warning'));
  assert.match(now.querySelector('[data-updated]').textContent, /^From the build record, \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/);
  const button = now.querySelector('.sc-btn-text');
  assert.deepEqual([button.textContent, button.getAttribute('href')], ['See the network', '/network']);
  assert.match(textOf(main.querySelector('#now .sc-section-head')), /An era is a reward period of about \d+ hours\./, 'era is defined at its first use');
});

test('how it works: three numbered steps of an h3 and two sentences, and one static diagram of three boxes and two arrows', () => {
  const steps = [...main.querySelectorAll('#how ol.home-steps > li')];
  assert.deepEqual(steps.map((s) => s.querySelector('h3').textContent), ['Register', 'Agree and escrow', 'Get paid']);
  for (const s of steps) assert.equal(sentences(s.querySelector('p').textContent), 2, `${s.querySelector('h3').textContent}: two sentences`);
  const svgs = main.querySelectorAll('#how svg');
  assert.equal(svgs.length, 1);
  assert.equal(svgs[0].querySelectorAll('rect').length, 3);
  assert.equal(svgs[0].querySelectorAll('path.home-arrow').length, 2);
  assert.deepEqual([...svgs[0].querySelectorAll('text')].map((t) => t.textContent), ['Register', 'Agree and escrow', 'Get paid']);
  assert.ok(!/fill="|stroke="|style=/.test(svgs[0].outerHTML), 'the diagram takes its colours from the tokens, in home.css');
  assert.ok(svgs[0].getAttribute('aria-label'));
});

test('what’s on chain: the seven modules in plain English, no pallet names, then Read the reference', () => {
  const rows = [...main.querySelectorAll('#chain tbody tr')];
  assert.deepEqual(rows.map((r) => r.cells[0].textContent), ['Agents', 'Escrow', 'Oracle', 'Orchestrator', 'Emissions', 'Messages', 'Parameters & constitution']);
  assert.ok(!/pallet|autoParams|auto-params/i.test(main.querySelector('#chain').textContent), 'no runtime jargon');
  const button = main.querySelector('#chain .sc-btn-text');
  assert.equal(button.textContent, 'Read the reference');
  assert.match(button.getAttribute('href'), /^\/docs\/reference\//);
});

test('token: the eight rows from the chain facts, the thesis, the oracle caveat in text-2', () => {
  const rows = [...main.querySelectorAll('#token .sc-kv tr')].map((r) => [r.querySelector('th').textContent, r.querySelector('td')]);
  assert.deepEqual(rows.map(([k]) => k), ['Symbol', 'Decimals', 'Supply cap', 'Genesis mint', 'Era length', 'Minimum agent stake', 'Registration fee', 'Unstake cooldown']);
  assert.equal(rows[0][1].textContent, facts.token.symbol);
  assert.equal(rows[1][1].textContent, String(facts.token.decimals));
  assert.equal(rows[2][1].textContent, `${(BigInt(facts.constants.emissions.supplyCap) / 10n ** BigInt(facts.token.decimals)).toLocaleString('en-US')} CMN`);
  // The genesis mint comes from the build record when it carries it, else from the node at block 0 — never typed.
  const genesis = rows[3][1];
  if (facts.state.genesisIssuancePlancks) assert.match(genesis.textContent, /^[\d,]+(\.\d{1,2})? CMN$/);
  else {
    const slot = genesis.querySelector('[data-genesis]');
    assert.equal(slot.dataset.key, storageKey('Balances', 'TotalIssuance'));
    assert.equal(slot.dataset.rpc, 'wss://rpc.scalarnet.io');
    assert.ok(slot.querySelector('.sc-skeleton'), 'a skeleton, not a zero, until it is read');
  }
  const prose = [...main.querySelectorAll('#token .home-prose p')];
  assert.equal(prose[0].textContent, 'Emissions reward verified work. Stake sets the floor for participation; it does not earn by itself.');
  assert.ok(prose[1].classList.contains('sc-muted') && prose[1].dataset.caveat === 'oracle-score-provider');
  assert.equal(sentences(prose[1].textContent), 1, 'the caveat is one sentence');
});

test('status and known issues: a warning callout, then the economic gate in three sentences ending with a link to the Network page', () => {
  const callout = main.querySelector('#status .sc-callout-warning');
  assert.match(callout.textContent, /testnet/i);
  assert.match(callout.textContent, /no value/);
  assert.match(callout.textContent, /reset/);
  const gate = main.querySelector('#status [data-caveat="economic-gate"]');
  assert.equal(sentences(gate.textContent), 3);
  const last = gate.lastElementChild;
  assert.deepEqual([last.tagName, last.getAttribute('href'), last.textContent], ['A', '/network', 'Network page']);
  assert.ok(gate.textContent.endsWith('Network page.'));
});

test('build on it: three cards of the same shape with a text button each, then the two endpoints', () => {
  const cards = [...main.querySelectorAll('#build .sc-card')];
  assert.deepEqual(cards.map((c) => c.querySelector('h3').textContent), ['Run an agent', 'Run a validator', 'Use the SDK']);
  assert.deepEqual(cards.map((c) => c.querySelector('.sc-btn-text').getAttribute('href')), ['/docs/guide/run-an-agent', '/docs/guide/run-a-validator', '/docs/guide/sdk']);
  for (const c of cards) {
    assert.deepEqual([...c.children].map((x) => x.tagName), ['H3', 'P', 'DIV']);
    assert.equal(sentences(c.querySelector('p').textContent), 1, 'one sentence');
  }
  assert.deepEqual([...main.querySelectorAll('.home-endpoints li')].map((li) => `${li.querySelector('.sc-caption').textContent} ${li.querySelector('code').textContent}`), [
    'Public RPC wss://rpc.scalarnet.io',
    'REST API https://api.scalarnet.io/v1',
  ]);
});

test('under 450 words on the page, tables excluded', () => {
  const inMain = words(textOf(main));
  const withFooter = inMain + words(textOf(doc.querySelector('footer'), 'svg, [hidden], .sc-sr'));
  console.log(`# home: ${inMain} words in <main> outside tables; ${withFooter} with the footer`);
  assert.ok(inMain < 450, `${inMain} words`);
});

test('every link goes somewhere: a page on this site, a docs page that exists, or an https URL', () => {
  const docsPage = (href) => {
    const rel = href.replace(/^\/docs\//, '').replace(/\/$/, '/index').replace(/\.html$/, '');
    return existsSync(join(repoRoot, 'docs', `${rel || 'index'}.md`));
  };
  const SITE = new Set(['/', '/network', '/faucet', '/oversight', '#main']);
  for (const a of doc.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    assert.ok(href && href !== '#', `a link with no target: ${a.outerHTML.slice(0, 80)}`);
    assert.ok(a.textContent.trim() || a.getAttribute('aria-label'), `a link with no words: ${href}`);
    if (/^https:\/\//.test(href)) continue;
    if (href.startsWith('/docs/')) {
      // The footer's constitution page and chain spec download are the docs phase's to build.
      if (a.closest('footer') && /constitution|chainspec/.test(href)) continue;
      assert.ok(docsPage(href), `${href} is not a docs page`);
      continue;
    }
    assert.ok(SITE.has(href), `${href} is not a page on this site`);
  }
});

test('no hand-typed figures: every number in the page’s text is a value read from chain-facts.json', () => {
  const allowed = new Set();
  const add = (v) => String(v).match(/\d[\d,.]*/g)?.forEach((n) => allowed.add(n.replace(/[.,]+$/, '')));
  for (const [, str] of proseOf(content)) for (const t of placeholdersIn(str)) add(resolve(facts, t));
  add(main.querySelector('[data-updated]').textContent); // the build record's own read time
  if (facts.state.genesisIssuancePlancks) add(main.querySelector('#token tr:nth-child(4) td').textContent);
  const numbers = textOf(main, 'svg, code, [hidden], .sc-sr, template').match(/\d[\d,.]*/g) ?? [];
  assert.ok(numbers.length > 10, 'the page shows the chain’s figures');
  for (const n of numbers) assert.ok(allowed.has(n.replace(/[.,]+$/, '')), `"${n}" on the page is not a chain figure`);
});
