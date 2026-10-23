// /pulse as built, in the Nightwatch chrome: the page, its one script, its
// stylesheet, and the rules the observatory's modules are held to, applied
// to the pulse's modules the same way. The build runs once into a temporary
// directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS, KINDS } from '../src/pulse/model.js';
import { DISCLAIMER, FIGURES, LEGEND, SCRIPTS_OFF, STRIP } from '../src/pulse.mjs';
import { KEYS } from '../src/pulse/strip.js';
import { FEED_LINES, ANNOUNCE_MS } from '../src/pulse/ticker.js';
import { SOURCES, API_ORIGIN, blockEventsSource } from '../src/observatory/data.js';
import { DISCLAIMER as CHROME_DISCLAIMER } from '../src/chrome/templates.mjs';

const landingDir = fileURLToPath(new URL('..', import.meta.url));
const readRepoFile = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));

function pulseSources() {
  const dir = fileURLToPath(new URL('../src/pulse/', import.meta.url));
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js') && statSync(join(dir, name)).isFile())
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')]);
}

function build() {
  const out = mkdtempSync(join(tmpdir(), 'landing-pulse-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: landingDir, env: { ...process.env, LANDING_OUT_DIR: out }, stdio: 'pipe' });
  return out;
}

const out = build();
const page = readFileSync(join(out, 'pulse.html'), 'utf8');
const observatory = readFileSync(join(out, 'observatory.html'), 'utf8');
const index = readFileSync(join(out, 'index.html'), 'utf8');
const bundle = readFileSync(join(out, 'pulse.js'), 'utf8');
const observatoryBundle = readFileSync(join(out, 'observatory.js'), 'utf8');
const css = readFileSync(new URL('../src/pulse.css', import.meta.url), 'utf8');

test('the build emits the pulse page, its one script and its stylesheet, free of force-graph and gsap, and the observatory keeps its own', () => {
  const files = readdirSync(out);
  for (const name of ['pulse.html', 'pulse.js', 'pulse.css']) assert.ok(files.includes(name), `build produced no ${name}`);
  assert.deepEqual([...page.matchAll(/<script[^>]* src="([^"]+)"/g)].map((m) => m[1]), ['pulse.js'], 'the page loads one script');
  assert.ok(!page.includes('observatory.js') && !page.includes('observatory-graph'), 'and never the observatory’s');
  assert.deepEqual([...observatory.matchAll(/<script[^>]* src="([^"]+)"/g)].map((m) => m[1]), ['observatory.js']);
  assert.ok(!observatory.includes('pulse.js'));
  // The Waterfall is Canvas 2D: no force-graph, no gsap, no WebGL, in this bundle or the observatory's.
  for (const text of [bundle, observatoryBundle]) {
    assert.ok(!/force-graph|kapsule|ForceGraph|linkDirectionalParticles|nodeCanvasObject/.test(text), 'force-graph is gone');
    assert.ok(!/gsap|globalTimeline/i.test(text), 'gsap is gone');
    assert.ok(!/WebGLRenderer|getContext\(["']webgl/.test(text), 'no WebGL');
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const dep of ['force-graph', 'gsap']) assert.ok(!(dep in (pkg.dependencies ?? {})) && !(dep in (pkg.devDependencies ?? {})), `${dep} is still a dependency`);
  assert.ok(page.includes('<style>') && !page.includes('<link rel="stylesheet"'), 'the stylesheet is inlined');
  assert.ok(page.includes('--paper:') && page.includes('.nw-bar'), 'the chrome is inlined ahead of the page’s rules');
  for (const face of ['fonts/source-serif-4-latin-opsz-normal.woff2', 'fonts/ibm-plex-mono-latin-400-normal.woff2']) assert.ok(page.includes(`<link rel="preload" href="${face}"`), `${face} is preloaded`);
  assert.ok(!/fonts\.googleapis|cdn\./.test(page), 'no third party');
});

test('Pulse is the current page in the chrome’s top bar, with the lamp; the landing page is untouched', () => {
  assert.match(page, /<header class="nw-bar" data-bar>/);
  assert.match(page, /<a href="pulse" aria-current="page">Pulse<\/a>/);
  assert.match(page, /<a href="observatory">Observatory<\/a>/);
  assert.match(page, /<span class="nw-lamp" data-lamp data-state="connecting" data-lit="false"/, 'the lamp ships unlit and connecting');
  assert.match(index, /<a href="pulse">Pulse<\/a>/, 'the landing page’s nav names Pulse, as the chrome’s nav does on every page');
});

test('three Readings with the brief’s labels and the bottom strip’s three, every one live, sourced from data.js, and empty of digits at build time', () => {
  const keys = [...page.matchAll(/data-reading="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, [...FIGURES.map(([key]) => key), ...STRIP.map(([key]) => key)]);
  assert.deepEqual(KEYS, FIGURES.map(([key]) => key));
  assert.deepEqual(FIGURES.map(([, label]) => label), ['Agents active in the last ten minutes', 'Events in the last minute', 'Messages in the last hour']);
  assert.deepEqual(STRIP.map(([, label]) => label), ['Height', 'Finalized', 'Era']);
  for (const [, label] of [...FIGURES, ...STRIP]) assert.ok(page.includes(`<span class="nw-label">${label}</span>`), `no Reading labelled "${label}"`);
  for (const [, , source] of [...FIGURES, ...STRIP]) assert.ok(SOURCES[source]?.kind === 'api', `"${source}" is not an api source in data.js`);
  const slots = [...page.matchAll(/data-reading-value[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.equal(slots.length, 6);
  for (const slot of slots) assert.ok(!/\d/.test(slot), `a figure slot carries a digit at build time: "${slot}"`);
  assert.equal((page.match(/<div data-request>GET api\.scalarnet\.io\/v1\//g) ?? []).length, 6, 'every Reading’s receipt names its request');
  assert.ok(page.includes('GET api.scalarnet.io/v1/status') && page.includes('GET api.scalarnet.io/v1/eras/current'));
  assert.ok(!/is-loading[^>]*>[\s\S]{0,400}?<span class="nw-figure[^"]*"[^>]*>\d/.test(page));
});

test('the stage: the canvas, the band, the feed as a live list with no sample lines, the legend of six, the counted operators, F, no footer', () => {
  assert.match(page, /<canvas class="pulse-canvas" data-waterfall aria-hidden="true"><\/canvas>/, 'the canvas is the picture; the feed is its accessible version');
  assert.match(page, /<div class="pulse-band" data-band hidden><div class="nw-band" role="status"><\/div><\/div>/, 'the index-behind Band ships hidden and empty');
  assert.match(page, /<h2 class="pulse-feed-head nw-label" id="feed-h"><span class="nw-lamp-dot" data-feed-dot aria-hidden="true"><\/span>LIVE<\/h2>/);
  assert.match(page, /<ol class="pulse-feed-lines nw-small" data-feed-lines aria-live="polite"><\/ol>/, 'the feed ships empty: no sample lines');
  assert.equal(FEED_LINES, 8);
  assert.equal(ANNOUNCE_MS, 30_000);
  assert.equal(LEGEND.length, 6);
  assert.equal((page.match(/<canvas class="pulse-legend-glyph" data-legend="/g) ?? []).length, 6);
  for (const [kind, name] of LEGEND) {
    assert.ok(page.includes(`data-legend="${kind}" width="24" height="12" aria-hidden="true"></canvas>${name}</li>`), `the legend names ${kind} "${name}"`);
    assert.ok(EVENTS.some((row) => row.kind === kind && row.describe === name), `"${name}" is model.js’s word for ${kind}`);
  }
  assert.equal(KINDS.filter((kind) => kind !== 'resolved').length, 6);
  assert.match(page, /<li class="pulse-operators" data-operators><\/li>/, 'n/m operator-run is counted in the browser, never typed');
  assert.match(page, /class="nw-quiet pulse-fullscreen" aria-pressed="false" aria-keyshortcuts="F">F fullscreen</);
  assert.ok(!page.includes('<footer class="nw-foot"') && !page.includes('data-footer'), 'no footer on this page');
  assert.equal(DISCLAIMER, CHROME_DISCLAIMER);
  assert.match(page, /<p class="nw-small pulse-disclaimer">Testnet — the token has no value and the chain may be reset\.<\/p>/, 'the disclaimer is in the strip at --small');
  assert.match(page, /<p class="sr-status nw-visually-hidden" aria-live="polite">/);
  assert.ok(page.includes(`<noscript><div class="nw-band" role="status">${SCRIPTS_OFF(facts.provenance.fetchedAt)}</div></noscript>`), 'scripts off: the Band with the build’s UTC');
  assert.match(SCRIPTS_OFF(facts.provenance.fetchedAt), /^Scripts are off\. Every figure on this page is from the build, \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC, and carries its source\. Nothing will move\.$/);
});

test('every light is an event the runtime declares (chain-events.json), and the per-block read is a route the indexer serves', () => {
  const metadata = JSON.parse(readFileSync(new URL('../chain-events.json', import.meta.url), 'utf8'));
  assert.ok(metadata.provenance.specVersion >= 309, 'the record is from a runtime with the messages pallet');
  for (const row of EVENTS) {
    assert.ok(metadata.pallets[row.section]?.includes(row.method), `${row.section}.${row.method} is not an event the runtime declares`);
  }
  const api = readRepoFile('indexer/src/api.ts');
  const toPattern = (route) => new RegExp(`^${route.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
  const routes = [...api.matchAll(/path: '(\/v1\/[^']+)'/g)].map((m) => m[1]);
  const source = blockEventsSource(919900);
  const path = new URL(source.path, API_ORIGIN).pathname;
  assert.ok(routes.some((route) => toPattern(route).test(path)), `${path} is not a route in indexer/src/api.ts`);
  assert.equal(new URL(source.path, API_ORIGIN).searchParams.get('limit'), '200');
  for (const name of ['agents', 'escrows', 'finalizedHeads', 'status', 'messagesSent', 'deliveriesConfirmed', 'agreementsCreated', 'disputesOpened', 'oracleAnswers', 'oracleBatches', 'registrations']) {
    assert.ok(SOURCES[name], `the feed reads source "${name}", which data.js does not define`);
  }
});

test('the pulse’s modules keep the observatory’s rules: one timer, in main.js; the chain’s hosts only; no pasted keys; no URL flags', () => {
  const allowed = new Set(['api.scalarnet.io', 'rpc.scalarnet.io', 'explorer.scalarnet.io', 'scalarnet.io']);
  const files = pulseSources();
  assert.ok(files.length >= 5, `expected the pulse modules, found ${files.map(([f]) => f).join(', ')}`);
  for (const [file, src] of files) {
    assert.ok(!/setInterval\(|setTimeout\(/.test(src) || file === 'main.js', `${file} holds a timer; use ctx.watch so it pauses when hidden`);
    assert.ok(!/animation-iteration-count|infinite/.test(src), `${file} declares an infinite animation`);
    assert.ok(!/0x[0-9a-f]{64}/i.test(src), `${file} contains a 32-byte hex literal`);
    assert.ok(!/location\.search|URLSearchParams/.test(src), `${file} reads a URL flag`);
    assert.ok(!/eslint-disable/.test(src), `${file} disables lint`);
    assert.ok(!/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(src), `${file} has an empty catch`);
    for (const m of src.matchAll(/(?:https|wss):\/\/([a-z0-9.-]+)/g)) assert.ok(allowed.has(m[1]), `${file} references ${m[1]}`);
  }
  assert.equal((readFileSync(new URL('../src/pulse/main.js', import.meta.url), 'utf8').match(/setInterval\(/g) ?? []).length, 1, 'main.js holds exactly one timer');
  assert.ok(!files.some(([file]) => file === 'graph.js'), 'the constellation is gone');
  assert.ok(files.some(([file]) => file === 'waterfall.js'), 'the Waterfall is here');
  const waterfall = files.find(([file]) => file === 'waterfall.js')[1];
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(waterfall), 'the canvas names no colour of its own: it reads the tokens at draw time');
  assert.match(waterfall, /getComputedStyle/);
  assert.ok(!/['"](?:pine-\d|bone|bone-dim|sage|leader|filament|vermilion|clay|ice)['"]|shadowBlur|shadowColor/.test(waterfall), 'the canvas reads the Ledger’s inks by name and draws no glow');
  assert.ok(!/from ['"](?:force-graph|gsap|three)/.test(waterfall));
});

test('pulse.css draws in the Ledger: tokens only, no hue, the eleven fonts, rules as lines never frames, no gradient, no shadow, no glow, no italics, one scheme, no loop', () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.test(body), 'a colour literal outside tokens.css');
  // Only the Ledger's eight: paper, paper-2, paper-3, ink, ink-2, ink-3, rule, rule-2; the Nightwatch names are gone.
  for (const [, name] of body.matchAll(/var\(--([a-z0-9-]+)\)/g)) {
    if (/^(?:s-\d+|gutter|bar|content|radius|t-|ease-|pulse-)/.test(name)) continue;
    if (['display', 'h2', 'h3', 'body', 'small', 'figure-xl', 'figure-l', 'figure-m', 'figure-s', 'label', 'mono'].includes(name)) continue;
    assert.ok(['paper', 'paper-2', 'paper-3', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-2'].includes(name), `--${name} is not a Ledger token`);
  }
  assert.ok(!/filament|vermilion|--ice|--clay|--pine|--bone|--sage|--leader\b|--glow/.test(body), 'a Nightwatch token survives');
  for (const [, value] of body.matchAll(/(?:^|[;{\s])font:\s*([^;]+);/g)) assert.match(value.trim(), /^var\(--(?:display|h2|h3|body|small|figure-(?:xl|l|m|s)|label|mono)\)$/, `a font outside the eleven: ${value}`);
  assert.ok(!/font-size\s*:/.test(body), 'nothing sets a font-size');
  // A rule is a line, never a frame: a border is one side, 1 px, solid, in --rule or --rule-2.
  for (const [, prop, value] of body.matchAll(/(border(?!-radius)[a-z-]*)\s*:\s*([^;]+);/g)) {
    assert.match(prop, /^border-(?:top|bottom)$/, `a border that is not a top or bottom rule: ${prop}`);
    assert.match(value.trim(), /^1px solid var\(--rule(?:-2)?\)$/, `a rule that is not a 1 px hairline: ${value}`);
  }
  assert.ok(!/gradient\(/.test(body), 'a gradient');
  assert.ok(!/box-shadow|text-shadow|filter\s*:/.test(body), 'a shadow or a glow');
  assert.ok(!/italic/.test(body), 'an italic');
  assert.ok(!/prefers-color-scheme/.test(body), 'a second colour scheme');
  assert.ok(!/infinite/.test(body), 'pulse.css declares an infinite animation');
  assert.match(body, /@media \(prefers-reduced-motion: reduce\)/);
  // The Waterfall is a paper field between two hairlines; the feed's lamp dot is the chrome's, not restated here.
  assert.match(body, /\.pulse-waterfall \{[^}]*background: var\(--paper\);[^}]*border-top: 1px solid var\(--rule\);[^}]*border-bottom: 1px solid var\(--rule\);/);
  assert.ok(!/\.nw-lamp-dot\[data-lit/.test(body), 'the lit dot is the chrome’s rule, not a page override');
  const chromeCss = readFileSync(new URL('../src/chrome/chrome.css', import.meta.url), 'utf8');
  assert.match(chromeCss, /\.nw-lamp-dot\[data-lit="true"\] \{ background: var\(--ink\); border-color: var\(--ink\); \}/, 'the chrome lights a lamp dot outside the lamp in ink');
  assert.ok(!existsSync(fileURLToPath(new URL('../src/chrome/requests/phase4.css', import.meta.url))), 'the phase-4 request was merged and is gone');
  assert.match(body, /--pulse-feed: 320px;/, 'the feed is 320 px');
  assert.match(body, /grid-template-columns: minmax\(0, 1fr\) var\(--pulse-feed\);/);
});
