// Nightwatch tokens (src/chrome/tokens.css): the one theme, held to the
// brief. The palette is exact, every text pair the brief allows passes WCAG AA
// (sage, used only at label size beside a word, passes 3:1), the type scale is
// closed, the faces are the two self-hosted families, and there is no second
// colour scheme — print is the only other face, and it is a separate sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, rootTokens } from './lib/contrast.mjs';

const css = readFileSync(new URL('../src/chrome/tokens.css', import.meta.url), 'utf8');
const tokens = rootTokens(css);

const PALETTE = {
  '--pine-0': '#0f1f18',
  '--pine-1': '#15291f',
  '--pine-2': '#1c3328',
  '--pine-3': '#234030',
  '--bone': '#efe9d8',
  '--bone-dim': '#b9b3a3',
  '--sage': '#7f8a80',
  '--leader': '#3b5546',
  '--filament': '#ffe3a3',
  '--vermilion': '#ff5a36',
  '--ice': '#bfe6ff',
  '--clay': '#c98f6a',
};

const TYPE = {
  '--display': '600 5rem/1 var(--font-sans)',
  '--h2': '600 2.5rem/1.1 var(--font-sans)',
  '--h3': '500 1.375rem/1.3 var(--font-sans)',
  '--body': '400 1.0625rem/1.6 var(--font-sans)',
  '--small': '400 0.875rem/1.5 var(--font-sans)',
  '--figure-xl': '300 4.5rem/1 var(--font-mono)',
  '--figure-l': '300 3rem/1 var(--font-mono)',
  '--figure-m': '300 1.75rem/1 var(--font-mono)',
  '--label': '400 0.6875rem/1 var(--font-mono)',
  '--mono': '400 0.8125rem/1.5 var(--font-mono)',
};

test('the palette is the brief’s, to the hex', () => {
  for (const [name, hex] of Object.entries(PALETTE)) assert.equal(tokens[name], hex, name);
  assert.equal(tokens['--glow'], '0 0 24px rgba(255, 227, 163, 0.18)');
});

test('every text pair passes WCAG AA; sage passes 3:1 where it may be used; state colours read as text on the two dark pines', () => {
  const aa = (ink, ground, floor = 4.5) => {
    const ratio = contrast(tokens[ink], tokens[ground]);
    assert.ok(ratio >= floor, `${ink} on ${ground} is ${ratio.toFixed(2)}:1, under ${floor}:1`);
  };
  for (const ground of ['--pine-0', '--pine-1', '--pine-2']) {
    aa('--bone', ground);
    aa('--bone-dim', ground);
  }
  for (const ground of ['--pine-0', '--pine-1']) {
    aa('--sage', ground, 3);
    for (const state of ['--filament', '--vermilion', '--ice', '--clay']) aa(state, ground);
  }
});

test('the type scale is closed: ten styles, two self-hosted faces, and nothing else sets a size', () => {
  for (const [name, value] of Object.entries(TYPE)) assert.equal(tokens[name], value, name);
  assert.equal(tokens['--font-sans'], '"Instrument Sans", system-ui, sans-serif');
  assert.equal(tokens['--font-mono'], '"Martian Mono", ui-monospace, monospace');
  const styles = Object.entries(tokens).filter(([, v]) => /rem\//.test(v)).map(([k]) => k);
  assert.deepEqual(styles.sort(), Object.keys(TYPE).sort(), 'a type style outside the ten');
});

test('geometry and motion as briefed; one theme, no second scheme, no loop', () => {
  assert.equal(tokens['--radius'], '4px');
  assert.equal(tokens['--bar'], '72px');
  assert.equal(tokens['--content'], '1200px');
  assert.equal(tokens['--gutter'], '24px');
  for (const [name, ms] of [['--t-attack', '120ms'], ['--t-cool', '1800ms'], ['--t-ui', '240ms'], ['--t-shift', '240ms']]) assert.equal(tokens[name], ms, name);
  assert.equal(tokens['--ease-attack'], 'cubic-bezier(0.1, 0.9, 0.2, 1)');
  assert.equal(tokens['--ease-cool'], 'cubic-bezier(0.2, 0.6, 0.4, 1)');
  assert.equal(tokens['--ease-ui'], 'cubic-bezier(0.2, 0, 0, 1)');
  assert.equal((css.match(/:root\s*\{/g) ?? []).length, 1, 'one :root block: one theme');
  assert.ok(!/prefers-color-scheme/.test(css), 'no second colour scheme');
  assert.ok(!/infinite|@keyframes/.test(css), 'no loop');
});

// ── the chrome proper ────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drift, syncPairs } from '../scripts/sync-chrome.mjs';
import { reading, topBar, footer, DISCLAIMER } from '../src/chrome/templates.mjs';

const chrome = readFileSync(new URL('../src/chrome/chrome.css', import.meta.url), 'utf8');
const print = readFileSync(new URL('../src/chrome/print.css', import.meta.url), 'utf8');
const blocks = (source) => [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);

test('the chrome copies in docs/ and explorer/ are byte-identical to the source, fonts included', () => {
  assert.ok(syncPairs().length >= 10);
  const bad = drift();
  assert.deepEqual(bad.map(([, d]) => d), [], 'run `node scripts/sync-chrome.mjs`');
});

test('chrome.css draws only with tokens: no hex colour, every font and size from the scale, borders only where the brief allows, one loop', () => {
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(chrome.replace(/url\([^)]*\)/g, '')), 'a hex colour outside tokens.css');
  for (const [selector, body] of blocks(chrome)) {
    if (selector.startsWith('@font-face') || selector.startsWith(':root')) continue;
    for (const [, value] of body.matchAll(/font-size:\s*([^;]+);/g)) {
      assert.match(value, /^(?:var\(--|inherit|[0-9.]+rem$)/, `${selector} sets font-size: ${value}`);
      if (/rem$/.test(value)) assert.ok(['2.5rem', '3rem'].includes(value.trim()), `${selector}: ${value} is off the scale (only the 390 px step-downs may restate a scale size)`);
    }
    for (const [, value] of body.matchAll(/(?:^|;)\s*font:\s*([^;]+);/g)) {
      assert.match(value, /var\(--(?:display|h2|h3|body|small|figure-(?:xl|l|m)|label|mono)\)|var\(--font-(?:sans|mono)\)|^inherit$/, `${selector} sets font: ${value}`);
    }
    if (/(^|;)\s*border(?!-radius|-collapse|-spacing)[a-z-]*:/.test(body.replace(/border:\s*0;/g, ''))) {
      assert.match(selector, /focus-visible|nw-stub|nw-code/, `${selector} draws a border`);
    }
  }
  const loops = [...chrome.matchAll(/animation:[^;]*infinite/g)];
  assert.equal(loops.length, 1, 'exactly one loop, the loading leader');
  assert.match(chrome, /\.nw-reading\.is-loading \.nw-leader::before \{[^}]*nw-travel 1200ms linear infinite/);
  assert.match(chrome, /@media \(prefers-reduced-motion: reduce\)[\s\S]*content: "loading"/);
  assert.ok(!/gradient\(/.test(chrome.replace(/radial-gradient\(circle, (?:currentColor|var\(--leader\)|var\(--vermilion\)) [0-9.]+px, transparent [0-9.]+px\)/g, '')), 'the only gradients are the leader dots');
  assert.ok(!/text-shadow|backdrop-filter|blur\(/.test(chrome), 'no glass');
  for (const [, value] of chrome.matchAll(/box-shadow:\s*([^;]+);/g)) {
    assert.match(value, /var\(--glow\)|rgba\(255, 227, 163|var\(--pine-1\)|var\(--clay\)|var\(--filament\)|var\(--vermilion\)|none/, `box-shadow outside the lamp rule: ${value}`);
  }
  assert.ok(!/font-style:\s*italic/.test(chrome + print), 'no italics');
  assert.match(print, /@media print/);
  assert.match(print, /\.nw-receipt, \.nw-receipt-line \{ display: block !important; \}/);
});

test('a Reading without a source throws; with one it carries its label, leader, figure, stub and receipt', () => {
  assert.throws(() => reading({ key: 'x', label: 'Height', figure: '1' }), /no source/);
  const source = { method: 'GET', url: 'https://api.scalarnet.io/v1/status', fetchedAt: '2026-10-23T05:48:45.503Z', block: 1157819, raw: 'chain-facts.json' };
  const html = reading({ key: 'height', label: 'Height', figure: '1,157,819', size: 'm', state: 'record', source });
  for (const part of ['class="nw-label">Height<', 'class="nw-leader"', 'nw-figure nw-figure--m', '1,157,819', 'class="nw-stub"', 'data-state="record"', 'GET api.scalarnet.io/v1/status', 'fetched 2026-10-23 05:48:45 UTC · block 1,157,819', 'raw ↗']) {
    assert.ok(html.includes(part), `reading lacks ${part}`);
  }
  const sealed = reading({ key: 'p', label: 'Posture', figure: 'x', source: { ...source, method: 'FILE', url: 'posture.json' }, sealed: true });
  assert.match(sealed, /data-sealed="true"/);
  assert.match(sealed, /<span class="nw-stub"/, 'a sealed stub is not a button: it does not tear');
});

test('the bar and the footer are the brief’s: the six nav words, the lamp, Sources, ⌘K; three footer columns, the facts and the disclaimer', () => {
  const bar = topBar({ current: 'observatory' });
  assert.deepEqual([...bar.matchAll(/<a href="[^"]+"(?: aria-current="page")?>([^<]+)<\/a>/g)].map((m) => m[1]).slice(0, 6), ['Observatory', 'Pulse', 'Explorer', 'Docs', 'Oversight', 'Faucet']);
  assert.match(bar, /<a href="observatory" aria-current="page">Observatory<\/a>/);
  assert.match(bar, /data-lamp data-state="connecting"/);
  assert.match(bar, /data-sources-switch/);
  assert.match(bar, /⌘K/);
  assert.ok(!bar.includes('Present'), 'Present is the Observatory’s alone');
  assert.match(topBar({ current: 'observatory', present: true }), /aria-keyshortcuts="P">Present/);
  const foot = footer({ facts: { genesisHash: '0xff6882b49ad61dd3128a6e834b4f81704a3824ce358f2f69fe765ca07cf803d1', specVersion: 309, nodeVersion: '4.0.0-5f5e3c9439f', builtAt: '2026-10-23T05:48:45.503Z', block: 1157819 } });
  for (const word of ['Chain', 'Build', 'Govern', 'Observatory', 'Pulse', 'Explorer', 'Status', 'Docs', 'SDK', 'Faucet', 'GitHub', 'Constitution', 'Evidence', 'Changelog', 'Disclosures', 'genesis 0xff68…03d1', 'spec 309 · node 4.0.0-5f5e3c9439f', 'site built 2026-10-23 05:48:45 UTC against block 1,157,819', DISCLAIMER]) {
    assert.ok(foot.includes(word), `footer lacks ${word}`);
  }
  assert.ok(!/©|copyright/i.test(foot), 'no copyright line');
});

// Design-prompt specimens that must never reach a built page (brief §6.2).
export const FORBIDDEN_SPECIMENS = [/1,115,263/, /6,054,836,317/, /\bera 141\b/, /\bagents? 214\b/, /214 agents/, /5GbFZC[^<\s]*8pcj/, /swarm-\d{4}\b/, /fonts\.googleapis/, /cdn\./];

test('no built page carries a design specimen, a Google font or a CDN', () => {
  const out = mkdtempSync(join(tmpdir(), 'landing-specimens-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, LANDING_OUT_DIR: out }, stdio: 'pipe' });
  // index.html joins this check with the Nightwatch home (phase 2): the page it still
  // carries prints total issuance read from chain-facts.json, which today truncates to
  // the very figure the brief lists as a specimen.
  const pages = readdirSync(out).filter((f) => f.endsWith('.html') && f !== 'index.html');
  assert.ok(pages.length >= 2);
  for (const page of pages) {
    const html = readFileSync(join(out, page), 'utf8');
    for (const pattern of FORBIDDEN_SPECIMENS) assert.ok(!pattern.test(html), `${page} matches ${pattern}`);
  }
  const fonts = readdirSync(join(out, 'fonts'));
  for (const face of ['instrument-sans-latin-wght-normal.woff2', 'martian-mono-latin-wght-normal.woff2']) assert.ok(fonts.includes(face), `dist/fonts lacks ${face}`);
});
