// The Ledger tokens (src/chrome/tokens.css): black ink on paper, held to the
// round-2 brief (SITE-ROUND2.md §1.1). The palette is exact and has seven
// values and no hue; the five ink/paper pairs meet the contrast the brief
// states; the type scale is closed at eleven styles in two self-hosted faces;
// the spacing scale is closed at ten steps; and no colour literal, bare pixel
// spacing value or off-scale font lives anywhere outside tokens.css — not in
// the chrome, the page stylesheets, the instruments, or the docs and explorer
// copies. Print is the same page without the bar, in a separate sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync as listDir, statSync } from 'node:fs';
import { contrast, rootTokens } from './lib/contrast.mjs';

const css = readFileSync(new URL('../src/chrome/tokens.css', import.meta.url), 'utf8');
const tokens = rootTokens(css);

const PALETTE = {
  '--paper': '#0b0b0b',
  '--paper-2': '#141414',
  '--paper-3': '#1d1d1d',
  '--ink': '#f2f2f2',
  '--ink-2': '#bdbdbd',
  '--ink-3': '#8f8f8f',
  '--rule': '#2a2a2a',
  '--rule-2': '#3d3d3d',
};
// Round 2's light values: print.css turns the page back to these, and nowhere else may they appear.
export const PRINT_PALETTE = {
  '--paper': '#fcfcfc',
  '--paper-2': '#f4f4f4',
  '--paper-3': '#ebebeb',
  '--ink': '#111111',
  '--ink-2': '#4d4d4d',
  '--ink-3': '#6f6f6f',
  '--rule': '#d6d6d6',
  '--rule-2': '#b0b0b0',
};
// The seven colours a computed style may resolve to (rule and rule-2 are lines
// and marks; the check-layout script holds computed colours to this set).
export const LEDGER_COLOURS = Object.values(PALETTE);

// Round 3: one size up — 96 px display, 20 px body, 80 px figures.
const TYPE = {
  '--display': '600 6rem/1.0 var(--font-serif)',
  '--h2': '600 3rem/1.1 var(--font-serif)',
  '--h3': '600 1.75rem/1.25 var(--font-serif)',
  '--body': '400 1.25rem/1.55 var(--font-serif)',
  '--small': '400 1.0625rem/1.5 var(--font-serif)',
  '--figure-xl': '400 5rem/1 var(--font-mono)',
  '--figure-l': '400 3.5rem/1 var(--font-mono)',
  '--figure-m': '400 2.25rem/1 var(--font-mono)',
  '--figure-s': '400 1.5rem/1 var(--font-mono)',
  '--label': '500 0.75rem/1 var(--font-mono)',
  '--mono': '400 0.9375rem/1.5 var(--font-mono)',
};
export const TYPE_TOKENS = Object.keys(TYPE).map((k) => k.slice(2));

export const SPACING = { '--s-1': '4px', '--s-2': '8px', '--s-3': '12px', '--s-4': '16px', '--s-5': '24px', '--s-6': '32px', '--s-7': '48px', '--s-8': '64px', '--s-9': '96px', '--s-10': '160px' };

test('the palette is the Ledger’s, to the hex: paper, ink and rules, and no hue', () => {
  for (const [name, hex] of Object.entries(PALETTE)) assert.equal(tokens[name], hex, name);
  const colours = Object.entries(tokens).filter(([, v]) => /^#|rgb|hsl/.test(v));
  assert.deepEqual(colours.map(([k]) => k).sort(), Object.keys(PALETTE).sort(), 'a colour token outside the Ledger');
  for (const gone of ['--pine-0', '--pine-1', '--pine-2', '--pine-3', '--bone', '--bone-dim', '--sage', '--leader', '--filament', '--glow', '--vermilion', '--ice', '--clay', '--font-sans']) {
    assert.ok(!(gone in tokens), `${gone} is Nightwatch’s, deleted not aliased`);
  }
  for (const hex of Object.values(PALETTE)) {
    const [r, g, b] = [1, 3, 5].map((i) => hex.slice(i, i + 2));
    assert.ok(r === g && g === b, `${hex} is not a grey`);
  }
});

test('the ink/paper pairs meet the contrast the brief states (round 3: dark)', () => {
  const pairs = [
    ['--ink', '--paper', 17.6],
    ['--ink', '--paper-3', 15.1],
    ['--ink-2', '--paper', 10.5],
    ['--ink-2', '--paper-3', 9.0],
    ['--ink-3', '--paper', 6.1],
    ['--ink-3', '--paper-3', 5.2],
  ];
  for (const [ink, ground, stated] of pairs) {
    const ratio = contrast(tokens[ink], tokens[ground]);
    assert.ok(ratio >= stated - 0.05, `${ink} on ${ground} is ${ratio.toFixed(2)}:1, under the stated ${stated}:1`);
    assert.ok(ratio >= 4.5, `${ink} on ${ground} is under WCAG AA`);
  }
  // Printed, the light values keep round 2's pairs.
  for (const [ink, ground, stated] of [['--ink', '--paper', 18.4], ['--ink-2', '--paper', 8.2], ['--ink-3', '--paper', 4.9]]) {
    const ratio = contrast(PRINT_PALETTE[ink], PRINT_PALETTE[ground]);
    assert.ok(ratio >= stated - 0.05, `printed ${ink} on ${ground} is ${ratio.toFixed(2)}:1`);
  }
});

test('dark by default and only; print is light and is the one place the light values survive', () => {
  const chromeCss = readFileSync(new URL('../src/chrome/chrome.css', import.meta.url), 'utf8');
  const printCss = readFileSync(new URL('../src/chrome/print.css', import.meta.url), 'utf8');
  assert.match(chromeCss, /:root \{ color-scheme: dark; \}/);
  const printRoot = printCss.match(/@media print \{\s*:root \{([^}]*)\}/)?.[1] ?? '';
  assert.match(printRoot, /color-scheme: light;/);
  for (const [name, hex] of Object.entries(PRINT_PALETTE)) assert.ok(printRoot.includes(`${name}: ${hex};`), `print sets ${name} to ${hex}`);
  // Outside that block, print.css carries no colour at all.
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(printCss.replace(/@media print \{\s*:root \{[^}]*\}/, '')), 'a colour in print.css outside its :root');
});

test('the type scale is closed: eleven styles, two self-hosted faces, and nothing else sets a size', () => {
  for (const [name, value] of Object.entries(TYPE)) assert.equal(tokens[name], value, name);
  assert.equal(tokens['--font-serif'], '"Source Serif 4", Georgia, serif');
  assert.equal(tokens['--font-mono'], '"IBM Plex Mono", ui-monospace, monospace');
  const styles = Object.entries(tokens).filter(([, v]) => /rem\//.test(v)).map(([k]) => k);
  assert.deepEqual(styles.sort(), Object.keys(TYPE).sort(), 'a type style outside the eleven');
});

test('geometry, the spacing scale and motion as briefed; one theme, light; no loop', () => {
  assert.equal(tokens['--radius'], '2px');
  assert.equal(tokens['--bar'], '72px');
  assert.equal(tokens['--content'], '1200px');
  assert.equal(tokens['--gutter'], '24px');
  for (const [name, px] of Object.entries(SPACING)) assert.equal(tokens[name], px, name);
  const steps = Object.keys(tokens).filter((k) => /^--s-\d+$/.test(k));
  assert.deepEqual(steps.sort(), Object.keys(SPACING).sort(), 'a spacing step outside the ten');
  for (const [name, ms] of [['--t-attack', '120ms'], ['--t-cool', '1800ms'], ['--t-ui', '240ms'], ['--t-shift', '240ms']]) assert.equal(tokens[name], ms, name);
  assert.equal(tokens['--ease-attack'], 'cubic-bezier(0.1, 0.9, 0.2, 1)');
  assert.equal(tokens['--ease-cool'], 'cubic-bezier(0.2, 0.6, 0.4, 1)');
  assert.equal(tokens['--ease-ui'], 'cubic-bezier(0.2, 0, 0, 1)');
  assert.equal((css.match(/:root\s*\{/g) ?? []).length, 1, 'one :root block: one theme');
  assert.ok(!/prefers-color-scheme/.test(css), 'no second colour scheme');
  assert.ok(!/infinite|@keyframes/.test(css), 'no loop');
});

// ── the scope the scales are enforced over ──────────────────────────────────
const REPO = new URL('../../', import.meta.url);
const walk = (rel, keep) => {
  const root = new URL(rel, REPO);
  const out = [];
  const visit = (url) => {
    for (const name of listDir(url)) {
      if (name === 'node_modules' || name === 'dist' || name === 'cache') continue;
      const child = new URL(name, url);
      if (statSync(child).isDirectory()) visit(new URL(`${name}/`, url));
      else if (keep(name)) out.push(child);
    }
  };
  visit(root);
  return out;
};
const rel = (url) => url.pathname.replace(new URL('.', REPO).pathname, '');
// Every file that can carry a colour: the chrome and its copies, every page
// stylesheet and module, the instruments, the docs theme, the explorer's source.
export const COLOUR_SCOPE = [
  ...walk('landing/src/', (n) => /\.(css|m?js)$/.test(n)),
  ...walk('docs/.vitepress/theme/', (n) => /\.(css|vue|ts)$/.test(n)),
  ...walk('explorer/src/', (n) => /\.(css|ts)$/.test(n)),
].filter((u) => !/\/chrome\/(?:tokens|print)\.css$/.test(u.pathname));
// Every stylesheet the spacing and type scales are enforced over, with the
// explorer's inline layout sheet (render.ts) lifted out of its template literal.
export const STYLE_SCOPE = () => {
  const sheets = [
    ...walk('landing/src/', (n) => n.endsWith('.css')),
    ...walk('docs/.vitepress/theme/', (n) => n.endsWith('.css')),
    ...walk('explorer/src/', (n) => n.endsWith('.css')),
  ]
    .filter((u) => !/\/chrome\/tokens\.css$/.test(u.pathname))
    .map((u) => [rel(u), readFileSync(u, 'utf8')]);
  const render = readFileSync(new URL('explorer/src/render.ts', REPO), 'utf8');
  for (const m of render.matchAll(/const ([A-Z_]+_CSS) = `([^`]*)`/g)) sheets.push([`explorer/src/render.ts ${m[1]}`, m[2]]);
  return sheets;
};

// A literal is written-out colour: a hex, or an rgb()/hsl() whose first argument
// is a number. A colour computed at runtime from a token's value (the agent
// field mixes two tokens) is not a literal and is not caught.
const COLOUR_LITERAL = /(?<![\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(\s*[\d.]/gi;

test('no colour literal anywhere outside tokens.css: no hex, rgb or hsl in the chrome, the pages, the instruments or the copies', () => {
  assert.ok(COLOUR_SCOPE.length > 40, 'the scope is the whole site');
  const hits = [];
  for (const url of COLOUR_SCOPE) {
    const source = readFileSync(url, 'utf8');
    source.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(COLOUR_LITERAL)) hits.push(`${rel(url)}:${i + 1} ${m[0]}`);
    });
  }
  assert.deepEqual(hits, [], `colour literals outside tokens.css:\n${hits.join('\n')}`);
});

test('no file names a deleted Nightwatch token: pine, bone, sage, leader, filament, glow, vermilion, ice, clay and the sans are gone, not aliased', () => {
  const gone = /var\(--(?:pine-[0-3]|bone(?:-dim)?|sage|leader|filament|glow|vermilion|ice|clay|font-sans)\)/g;
  const hits = [];
  for (const url of COLOUR_SCOPE) {
    readFileSync(url, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(gone)) hits.push(`${rel(url)}:${i + 1} ${m[0]}`);
    });
  }
  assert.deepEqual(hits, [], `references to deleted tokens:\n${hits.join('\n')}`);
});

const SPACING_PROPS = /^(?:margin|padding|inset|gap|row-gap|column-gap|top|right|bottom|left|height|min-height|max-height)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/;
const SCALE_VAR = /var\(--(?:s-(?:[1-9]|10)|bar|gutter)\)/g;
// A value is on the scale when every part is 0, auto, none, 100%, a scale
// variable (--s-n, or the --bar and --gutter geometry tokens), or a calc()
// built from those, plain numbers and operators. Heights may also be measured
// in viewport units: a full-screen surface (the pulse field, a presenter
// slide, the docs main column) is viewport geometry, not a spacing step.
const splitParts = (v) => {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
};
export const onScale = (value, prop = '') => {
  const v = value.replace(/!important/, '').trim();
  if (/^(?:inherit|initial|unset|none)$/.test(v)) return true;
  const viewport = /height$/.test(prop);
  return splitParts(v).every((part) => {
    if (/^(?:0|auto|100%|none)$/.test(part)) return true;
    if (viewport && /^\d+d?vh$/.test(part)) return true;
    if (/^var\(--(?:s-(?:[1-9]|10)|bar|gutter)\)$/.test(part)) return true;
    if (/^calc\(/.test(part)) {
      let rest = part.slice(4).replace(SCALE_VAR, '').replace(/100%/g, '');
      if (viewport) rest = rest.replace(/\d+d?vh/g, '');
      return /^[\s\d.+\-*/()]*$/.test(rest);
    }
    return false;
  });
};
const declarations = (sheet) =>
  [...sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) =>
    [...m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)].map((d) => [m[1].trim(), d[1], d[2].trim()]),
  );

test('one spacing scale: every margin, padding, gap, offset and height is 0, auto, 100%, a --s-n step or a calc() of them', () => {
  const bad = [];
  for (const [file, sheet] of STYLE_SCOPE()) {
    for (const [selector, prop, value] of declarations(sheet)) {
      if (selector.startsWith('@font-face') || selector.startsWith(':root')) continue;
      if (SPACING_PROPS.test(prop) && !onScale(value, prop)) bad.push(`${file} ${selector} { ${prop}: ${value} }`);
    }
  }
  assert.deepEqual(bad, [], `off the spacing scale:\n${bad.join('\n')}`);
});

test('one type scale: every font is one of the eleven styles; nothing sets a font-size', () => {
  const allowed = new RegExp(`^(?:var\\(--(?:${TYPE_TOKENS.join('|')})\\)|inherit)(?:\\s*!important)?$`);
  const bad = [];
  for (const [file, sheet] of STYLE_SCOPE()) {
    for (const [selector, prop, value] of declarations(sheet)) {
      if (selector.startsWith('@font-face') || selector.startsWith(':root')) continue;
      if (prop === 'font' && !allowed.test(value)) bad.push(`${file} ${selector} { font: ${value} }`);
      if (prop === 'font-size' && !/^inherit$/.test(value)) bad.push(`${file} ${selector} { font-size: ${value} }`);
      if (prop === 'font-family' && !/^var\(--font-(?:serif|mono)\)$|^inherit$/.test(value)) bad.push(`${file} ${selector} { font-family: ${value} }`);
    }
  }
  assert.deepEqual(bad, [], `off the type scale:\n${bad.join('\n')}`);
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

test('chrome.css draws in the Ledger: rules are lines not frames, the only gradients are leader dots and hatching, one loop, no glow, no italics', () => {
  for (const [selector, body] of blocks(chrome)) {
    if (selector.startsWith('@font-face') || selector.startsWith(':root')) continue;
    // A four-sided border is a frame; the Ledger draws frames only as marks
    // (a stub, a tag's mark, the lamp's ring, the switch) and the focus ring.
    if (/(?:^|;)\s*border\s*:(?!\s*(?:0|none)\s*(?:;|$))/.test(body)) {
      assert.match(selector, /focus-visible|nw-stub|nw-dot|nw-mark|nw-lamp|nw-switch|nw-ember|nw-redaction/, `${selector} draws a box`);
    }
  }
  const loops = [...chrome.matchAll(/animation:[^;]*infinite/g)];
  assert.equal(loops.length, 1, 'exactly one loop, the loading leader');
  assert.match(chrome, /\.nw-reading\.is-loading \.nw-leader::before \{[^}]*nw-travel 1200ms linear infinite/);
  assert.match(chrome, /@media \(prefers-reduced-motion: reduce\)[\s\S]*content: "loading"/);
  const rest = chrome
    .replace(/radial-gradient\(circle, (?:currentColor|var\(--(?:rule|rule-2|ink)\)) [0-9.]+px, transparent [0-9.]+px\)/g, '')
    .replace(/repeating-linear-gradient\((?:45deg|-45deg|135deg), var\(--ink\) 0 1px, transparent 1px [0-9]+px\)/g, '');
  assert.ok(!/gradient\(/.test(rest), 'the only gradients are the leader dots and the 45° hatch');
  assert.ok(!/text-shadow|backdrop-filter|blur\(|drop-shadow/.test(chrome), 'no glow, no glass');
  // A shadow is allowed only as a hard line or ring (blur 0): the double
  // outline of an operator-run stub, a mark's ring, a one-pixel tick.
  const hard = /^(?:inset )?(?:-?[\d.]+px|0) (?:-?[\d.]+px|0) 0(?: [\d.]+px)? var\(--(?:ink|ink-2|ink-3|rule|rule-2|paper|paper-2|paper-3)\)$/;
  for (const [, value] of chrome.matchAll(/box-shadow:\s*([^;]+);/g)) {
    if (value.trim() === 'none') continue;
    for (const part of value.split(/,\s*/)) assert.match(part.trim(), hard, `a box-shadow with blur: ${value}`);
  }
  assert.ok(!/font-style:\s*italic/.test(chrome + print), 'no italics');
  assert.ok(!/prefers-color-scheme/.test(chrome + print), 'one theme, dark; print is not a scheme');
  assert.match(print, /@media print/);
  assert.match(print, /\.nw-receipt, \.nw-receipt-line \{ display: block !important; \}/);
  assert.match(print, /\.nw-bar[^{]*\{ display: none !important; \}/, 'print is the page without the bar');
  for (const face of ['Source Serif 4', 'IBM Plex Mono']) assert.ok(chrome.includes(`font-family: "${face}"`), `${face} is self-hosted by the chrome`);
  for (const file of ['source-serif-4-latin-opsz-normal.woff2', 'ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2']) assert.ok(chrome.includes(`url("fonts/${file}")`), file);
  assert.match(chrome, /font-display: swap/);
  assert.match(chrome, /\.nw-figure[^{]*\{[^}]*font-variant-numeric: tabular-nums lining-nums/);
  assert.match(chrome, /font-optical-sizing: auto/);
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
  const pages = readdirSync(out).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length >= 6);
  // oversight.html renders public/oversight-sample.json, a real devnet record whose
  // agreement account the brief later lifted as a design specimen (5GbFZC…8pcj). A
  // string the record itself carries is a figure from the chain, not a typed one, so
  // on that page only, a specimen match must also be verbatim in the record.
  const record = readFileSync(new URL('../public/oversight-sample.json', import.meta.url), 'utf8');
  for (const page of pages) {
    const html = readFileSync(join(out, page), 'utf8');
    for (const pattern of FORBIDDEN_SPECIMENS) {
      const hit = html.match(pattern);
      if (hit && page === 'oversight.html' && record.includes(hit[0])) continue;
      assert.ok(!hit, `${page} matches ${pattern}`);
    }
  }
  const fonts = readdirSync(join(out, 'fonts'));
  assert.deepEqual(fonts.sort(), ['ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2', 'source-serif-4-latin-opsz-normal.woff2'], 'dist/fonts holds the two faces and nothing else');
});

// ── fit.js: a row drops one size step, as a whole, when a figure outgrows its column ──
import { fitRow } from '../src/chrome/behaviour/fit.js';

test('fit: a row whose figure outgrows its column drops one step for all its figures, and steps back when it fits again', () => {
  const figure = (width, column) => {
    const reading = { clientWidth: column };
    return { scrollWidth: width, closest: () => reading, parentElement: reading };
  };
  const row = (figs) => ({ dataset: {}, figs, querySelectorAll: () => figs, removeAttribute(name) { if (name === 'data-step') delete this.dataset.step; } });
  const fits = row([figure(200, 282), figure(180, 282)]);
  assert.equal(fitRow(fits), false);
  assert.equal(fits.dataset.step, undefined);
  const spills = row([figure(200, 282), figure(300, 282)]);
  assert.equal(fitRow(spills), true);
  assert.equal(spills.dataset.step, '1', 'the whole row steps down');
  spills.figs[1].scrollWidth = 240; // the live figure shrank
  assert.equal(fitRow(spills), false);
  assert.equal(spills.dataset.step, undefined, 'and steps back up');
});
