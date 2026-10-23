// The plain chrome (SITE-REDESIGN.md §2–§3), held to the brief: the token
// values exact, colour literals only from the token list on any surface, no
// uppercase and no letter-spacing (except the display headline), every
// margin/padding/gap on the 4–96 px scale, every font one of the ten type
// tokens, weights 400/500/600 only, one shadow (an open menu), colour
// transitions only; the header, footer and components as specified; the
// copies in docs/ and explorer/ byte-identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { contrast, rootTokens } from './lib/contrast.mjs';
import { drift, syncPairs, CHROME_FILES, CHROME_FONTS } from '../scripts/sync-chrome.mjs';
import {
  BADGES,
  ICONS,
  badge,
  button,
  card,
  footer,
  head,
  header,
  icon,
  kvTable,
  navItems,
  pagination,
  stats,
  table,
  address,
  callout,
  codeBlock,
  searchField,
  tabs,
  DISCLAIMER,
} from '../src/chrome/templates.mjs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const tokensCss = read('../src/chrome/tokens.css');
const tokens = rootTokens(tokensCss);
const chromeCss = read('../src/chrome/chrome.css');
const fontsCss = read('../src/chrome/fonts.css');

export const COLOURS = {
  '--bg': '#ffffff',
  '--bg-2': '#f6f7f9',
  '--border': '#e3e6ea',
  '--control': '#8a919a',
  '--text': '#1a1c1e',
  '--text-2': '#5c6370',
  '--text-3': '#6b727c',
  '--accent': '#1457d6',
  '--accent-2': '#0f46b0',
  '--ok': '#188038',
  '--warn': '#9a5b00',
  '--bad': '#c62828',
  '--ok-bg': '#ecfdf3',
  '--warn-bg': '#fef7e6',
  '--bad-bg': '#fdecec',
};
export const TYPE = {
  '--display': '600 3.5rem/1.1 var(--font-sans)',
  '--h1': '600 2.5rem/1.2 var(--font-sans)',
  '--h2': '600 1.75rem/1.25 var(--font-sans)',
  '--h3': '600 1.25rem/1.35 var(--font-sans)',
  '--lead': '400 1.125rem/1.6 var(--font-sans)',
  '--body': '400 1rem/1.6 var(--font-sans)',
  '--small': '400 0.875rem/1.5 var(--font-sans)',
  '--caption': '400 0.8125rem/1.5 var(--font-sans)',
  '--stat': '600 2rem/1.1 var(--font-sans)',
  '--mono': '400 0.875rem/1.5 var(--font-mono)',
};
export const TYPE_TOKENS = Object.keys(TYPE).map((k) => k.slice(2));
export const SPACING = { '--s-1': '4px', '--s-2': '8px', '--s-3': '12px', '--s-4': '16px', '--s-5': '24px', '--s-6': '32px', '--s-7': '48px', '--s-8': '64px', '--s-9': '96px' };

test('the colours are the brief’s, to the hex, and the text pairs read on white', () => {
  for (const [name, hex] of Object.entries(COLOURS)) assert.equal(tokens[name], hex, name);
  const colourTokens = Object.entries(tokens).filter(([, v]) => /^#/.test(v)).map(([k]) => k);
  assert.deepEqual(colourTokens.sort(), Object.keys(COLOURS).sort(), 'a colour token outside the list');
  const ratio = (a, b) => contrast(tokens[a], tokens[b]);
  assert.ok(ratio('--text', '--bg') >= 16.5, 'text 17:1');
  assert.ok(ratio('--text-2', '--bg') >= 5.9, 'text-2 6:1');
  assert.ok(ratio('--text-3', '--bg') >= 4.5, 'text-3 4.9:1');
  assert.ok(ratio('--accent', '--bg') >= 5.5, 'accent 6.2:1');
  assert.ok(ratio('--control', '--bg') >= 3, 'control 3.2:1');
  for (const s of ['ok', 'warn', 'bad']) assert.ok(contrast(tokens[`--${s}`], tokens[`--${s}-bg`]) >= 4.5, `${s} on its badge fill`);
});

test('one light theme: no dark scheme anywhere in the chrome', () => {
  for (const css of [tokensCss, chromeCss, fontsCss]) {
    assert.ok(!/prefers-color-scheme/.test(css));
    assert.ok(!/color-scheme:\s*dark/.test(css));
  }
});

test('the type scale is closed: ten styles in two faces, mobile sizes for the headings and stats', () => {
  for (const [name, value] of Object.entries(TYPE)) assert.equal(tokens[name], value, name);
  assert.match(tokens['--font-sans'], /^"Inter Variable"/);
  assert.match(tokens['--font-mono'], /^"JetBrains Mono"/);
  const mobile = tokensCss.match(/@media \(max-width: 640px\) \{\s*:root \{([^}]*)\}/)?.[1] ?? '';
  for (const [name, size] of [['--display', '2.5rem/1.15'], ['--h1', '2rem/1.2'], ['--h2', '1.5rem/1.25'], ['--h3', '1.125rem/1.35'], ['--stat', '1.75rem/1.1']]) {
    assert.ok(mobile.includes(`${name}:`) && mobile.match(new RegExp(`${name}:[^;]*${size.replace('.', '\\.').replace('/', '\\/')}`)), `${name} at ${size} on mobile`);
  }
  assert.ok(!/Source Serif|IBM Plex|Instrument|Martian/.test(tokensCss + fontsCss + chromeCss), 'no retired face is named');
  assert.match(fontsCss, /font-family: "Inter Variable"[\s\S]*inter-latin-wght-normal\.woff2/);
  assert.match(fontsCss, /font-family: "JetBrains Mono"[\s\S]*jetbrains-mono-latin-400-normal\.woff2/);
  assert.equal((fontsCss.match(/font-display: swap/g) ?? []).length, 2);
});

test('space and shape: the 4–96 px scale, radius 8 and 4, the container and the reading column', () => {
  for (const [name, px] of Object.entries(SPACING)) assert.equal(tokens[name], px, name);
  assert.deepEqual(Object.keys(tokens).filter((k) => /^--s-\d+$/.test(k)).sort(), Object.keys(SPACING).sort());
  assert.equal(tokens['--radius'], '8px');
  assert.equal(tokens['--radius-sm'], '4px');
  assert.equal(tokens['--container'], '1120px');
  assert.equal(tokens['--gutter'], '24px');
  assert.equal(tokens['--reading'], '720px');
  assert.equal(tokens['--header'], '64px');
  assert.equal(tokens['--menu-shadow'], '0 2px 8px rgba(0, 0, 0, .12)');
});

// ── the scope the rules hold over ────────────────────────────────────────────
const REPO = new URL('../../', import.meta.url);
const rel = (url) => url.pathname.replace(new URL('.', REPO).pathname, '');
const walk = (dir, keep) => {
  const root = new URL(dir, REPO);
  if (!existsSync(root)) return [];
  const out = [];
  const visit = (url) => {
    for (const name of readdirSync(url)) {
      if (['node_modules', 'dist', 'cache', '.temp'].includes(name)) continue;
      const child = new URL(name, url);
      if (statSync(child).isDirectory()) visit(new URL(`${name}/`, url));
      else if (keep(name)) out.push(child);
    }
  };
  visit(root);
  return out;
};
// Every stylesheet on every surface is held to the rules; nothing is exempt.
export const LEGACY_DIRS = [];
export const NOT_YET_REBUILT = [];
const exempt = (path) => LEGACY_DIRS.some((d) => path.startsWith(d)) || NOT_YET_REBUILT.some((d) => path.startsWith(d));

const COLOUR_FILES = () =>
  [
    ...walk('landing/src/', (n) => /\.(css|m?js|svg)$/.test(n)),
    ...walk('landing/public/', (n) => /\.svg$/.test(n)),
    ...walk('docs/.vitepress/theme/', (n) => /\.(css|vue|ts|svg)$/.test(n)),
    ...walk('explorer/src/', (n) => /\.(css|ts|svg)$/.test(n)),
  ].filter((u) => !LEGACY_DIRS.some((d) => rel(u).startsWith(d)) && !/\/chrome\/tokens\.css$/.test(u.pathname));
export const STYLE_SHEETS = () => {
  const sheets = [
    ...walk('landing/src/', (n) => n.endsWith('.css')),
    ...walk('docs/.vitepress/theme/', (n) => n.endsWith('.css')),
    ...walk('explorer/src/', (n) => n.endsWith('.css')),
  ]
    .filter((u) => !exempt(rel(u)) && !/\/chrome\/tokens\.css$/.test(u.pathname))
    .map((u) => [rel(u), readFileSync(u, 'utf8')]);
  const render = readFileSync(new URL('explorer/src/render.ts', REPO), 'utf8');
  if (!exempt('explorer/src/render.ts')) for (const m of render.matchAll(/const ([A-Z_]+_CSS) = `([^`]*)`/g)) sheets.push([`explorer/src/render.ts ${m[1]}`, m[2]]);
  return sheets;
};
const declarations = (sheet) =>
  [...sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) =>
    [...m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)].map((d) => [m[1].trim(), d[1], d[2].trim()]),
  );

const LITERAL = /(?<![\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(\s*[\d.]/gi;
const ALLOWED = new Set(Object.values(COLOURS));

test('colours only from the token list on every surface: no literal colour that is not a token value', () => {
  const files = COLOUR_FILES();
  assert.ok(files.length > 20, 'the scope is the whole site');
  const hits = [];
  for (const url of files) {
    readFileSync(url, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(LITERAL)) if (!ALLOWED.has(m[0].toLowerCase())) hits.push(`${rel(url)}:${i + 1} ${m[0]}`);
    });
  }
  assert.deepEqual(hits, [], `colour literals outside the token list:\n${hits.join('\n')}`);
});

test('sentence case: no text-transform uppercase, and no letter-spacing except the display headline', () => {
  const bad = [];
  for (const [file, sheet] of STYLE_SHEETS()) {
    for (const [selector, prop, value] of declarations(sheet)) {
      if (prop === 'text-transform' && /uppercase/.test(value)) bad.push(`${file} ${selector} { text-transform: ${value} }`);
      if (prop === 'letter-spacing' && !/^(?:normal|0)$/.test(value) && !/sc-display|hero-title/.test(selector)) bad.push(`${file} ${selector} { letter-spacing: ${value} }`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

const SCALE_VAR = /var\(--(?:s-[1-9]|header|gutter)\)/g;
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
/** 0, auto, 100%, a --s-n step (or the header and gutter), or a calc() of those. */
export const onScale = (value) =>
  splitParts(value.replace(/!important/, '').trim()).every((part) => {
    if (/^(?:0|auto|inherit|unset|none)$/.test(part)) return true;
    if (/^var\(--(?:s-[1-9]|header|gutter)\)$/.test(part)) return true;
    if (/^calc\(/.test(part)) return /^[\s\d.+\-*/()%]*$/.test(part.slice(4).replace(SCALE_VAR, '').replace(/100%/g, ''));
    return false;
  });
const SPACING_PROPS = /^(?:margin|padding|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/;

test('one spacing scale: every margin, padding and gap is 0, auto, a --s-n step or a calc() of them', () => {
  const bad = [];
  for (const [file, sheet] of STYLE_SHEETS()) {
    for (const [selector, prop, value] of declarations(sheet)) {
      if (selector.startsWith('@font-face') || selector.startsWith(':root')) continue;
      if (SPACING_PROPS.test(prop) && !onScale(value)) bad.push(`${file} ${selector} { ${prop}: ${value} }`);
    }
  }
  assert.deepEqual(bad, [], `off the spacing scale:\n${bad.join('\n')}`);
});

test('one type scale: every font is one of the ten tokens; weights 400, 500, 600; nothing sets a font-size', () => {
  const allowed = new RegExp(`^(?:var\\(--(?:${TYPE_TOKENS.join('|')})\\)|inherit)$`);
  const bad = [];
  for (const [file, sheet] of STYLE_SHEETS()) {
    for (const [selector, prop, value] of declarations(sheet)) {
      if (selector.startsWith('@font-face') || selector.startsWith(':root')) continue;
      if (prop === 'font' && !allowed.test(value)) bad.push(`${file} ${selector} { font: ${value} }`);
      if (prop === 'font-size' && value !== 'inherit') bad.push(`${file} ${selector} { font-size: ${value} }`);
      if (prop === 'font-weight' && !/^(?:400|500|600|inherit|normal)$/.test(value)) bad.push(`${file} ${selector} { font-weight: ${value} }`);
      if (prop === 'font-family' && !/^var\(--font-(?:sans|mono)\)$|^inherit$/.test(value)) bad.push(`${file} ${selector} { font-family: ${value} }`);
    }
  }
  assert.deepEqual(bad, [], `off the type scale:\n${bad.join('\n')}`);
});

test('no elevation but an open menu, no motion but colour transitions, no 2 px rules, no dotted leaders', () => {
  const bad = [];
  for (const [file, sheet] of STYLE_SHEETS()) {
    for (const [selector, prop, value] of declarations(sheet)) {
      if (prop === 'box-shadow' && value !== 'none' && value !== 'var(--menu-shadow)') bad.push(`${file} ${selector} { box-shadow: ${value} }`);
      if (prop === 'transition' && !/^(?:none|(?:color|background-color|border-color) \.15s(?:, (?:color|background-color|border-color) \.15s)*)$/.test(value)) bad.push(`${file} ${selector} { transition: ${value} }`);
      if (/^animation/.test(prop) && value !== 'none') bad.push(`${file} ${selector} { ${prop}: ${value} }`);
      if (/gradient\(/.test(value)) bad.push(`${file} ${selector} { ${prop}: ${value} }`);
      if (/dotted|double/.test(value) && /^(?:border|text-decoration|outline)/.test(prop)) bad.push(`${file} ${selector} { ${prop}: ${value} }`);
    }
    if (/@keyframes/.test(sheet)) bad.push(`${file} declares @keyframes`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('the chrome copies in docs/ and explorer/ are byte-identical to the source, fonts included', () => {
  assert.deepEqual(CHROME_FILES, ['tokens.css', 'fonts.css', 'chrome.css']);
  assert.deepEqual(CHROME_FONTS.map(([, n]) => n), ['inter-latin-wght-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2']);
  assert.equal(syncPairs().length, 10);
  assert.deepEqual(drift().map(([, d]) => d), [], 'run `node scripts/sync-chrome.mjs`');
});

// ── components ───────────────────────────────────────────────────────────────
const facts = { provenance: { specName: 'scalar-commons', specVersion: 309, readAtBlock: 1166072 } };

test('header: wordmark, the four nav items in order, GitHub, one Get started button, a native menu; nothing else', () => {
  const h = header({ current: 'network' });
  assert.deepEqual(navItems().map((i) => i.label), ['Network', 'Explorer', 'Docs', 'Faucet']);
  const nav = h.match(/<nav class="sc-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]), ['Network', 'Explorer', 'Docs', 'Faucet']);
  assert.match(nav, /href="\/network" aria-current="page">Network/);
  assert.match(h, /class="sc-wordmark" href="\/">Scalar Commons<\/a>/);
  assert.match(h, /class="sc-header-link" href="https:\/\/github\.com\/[^"]+" rel="noopener">GitHub/);
  assert.equal((h.match(/sc-btn-primary/g) ?? []).length, 1);
  assert.match(h, /href="\/docs\/guide\/run-an-agent">Get started<\/a>/);
  assert.match(h, /<details class="sc-menu">\s*<summary aria-label="Menu">/, 'the menu works without a script');
  assert.match(h, /<a class="sc-skip" href="#main">Skip to content<\/a>/);
  for (const gone of ['AS BUILT', 'Sources', '⌘K', 'Present', 'connecting', 'Oversight', 'Pulse', 'Observatory']) assert.ok(!h.includes(gone), `the header carries ${gone}`);
  assert.match(header({ site: 'https://scalarnet.io' }), /href="https:\/\/scalarnet\.io\/network"/);
});

test('footer: four columns of links a person can read, the network values, one caption line from the facts', () => {
  const f = footer({ facts, builtAt: '2026-10-23T11:32:11.000Z' });
  assert.deepEqual([...f.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]), ['Product', 'Developers', 'Project', 'Network']);
  for (const word of ['Home', 'Network', 'Explorer', 'Faucet', 'Docs', 'Run a node', 'Run an agent', 'Run a validator', 'SDK', 'Privacy demo', 'GitHub', 'Releases', 'Constitution', 'Security', 'Public RPC', 'REST API', 'Chain spec (download)']) {
    assert.ok(f.includes(`>${word}<`) || f.includes(`<span>${word}</span>`), `footer lacks ${word}`);
  }
  assert.ok(f.includes('wss://rpc.scalarnet.io') && f.includes('https://api.scalarnet.io/v1'));
  for (const [, href] of f.matchAll(/href="([^"]+)"/g)) {
    assert.ok(!/\.rs$|\/status\.json$|\/posture\.json$|\/tree\//.test(href), `footer opens raw source or JSON: ${href}`);
  }
  assert.match(f, /href="\/docs\/chainspec\.json" download="chainspec\.json">Chain spec \(download\)/);
  assert.match(f, /href="\/docs\/reference\/constitution">Constitution/);
  assert.match(f, /SECURITY\.md"[^>]*>Security/);
  assert.ok(f.includes(`${DISCLAIMER} Runtime scalar-commons 309. Page built 23 Oct 2026, 11:32 UTC from block 1,166,072.`));
  assert.ok(!/©|copyright/i.test(f));
});

test('head: title "Page — Scalar Commons", description, canonical, Open Graph with the image, favicon, lang', () => {
  const h = head({ title: 'Network', description: 'Live figures.', path: '/network' });
  assert.match(h, /^<!doctype html>\n<html lang="en">/);
  assert.match(h, /<title>Network — Scalar Commons<\/title>/);
  assert.match(h, /<meta name="description" content="Live figures\.">/);
  assert.match(h, /<link rel="canonical" href="https:\/\/scalarnet\.io\/network">/);
  for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) assert.match(h, new RegExp(`property="${p}"`));
  assert.match(h, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(h, /fonts\/inter-latin-wght-normal\.woff2/);
  assert.match(h, /color-scheme|<meta name="viewport"/);
  assert.ok(!/color-scheme" content="dark/.test(h));
  assert.throws(() => head({ title: 'x' }), /description/);
});

test('components: buttons, cards, stats, tables, badges, tabs, search, code, callouts, pagination, addresses, icons', () => {
  assert.match(button({ text: 'Get started', href: '/docs/' }), /class="sc-btn sc-btn-primary" href="\/docs\/">Get started<\/a>/);
  assert.match(button({ text: 'See the network', href: '/network', variant: 'text' }), /sc-btn-text[\s\S]*sc-icon-arrow-right/);
  assert.match(button({ text: 'Request', type: 'submit', disabled: true }), /<button class="sc-btn sc-btn-primary" type="submit" disabled>/);
  assert.match(card({ title: 'Run an agent', body: 'One sentence.', action: { text: 'Read', href: '/docs/' } }), /<article class="sc-card"><h3>Run an agent<\/h3><p>One sentence\.<\/p>/);
  assert.match(stats([{ label: 'Block height', value: '1,166,072', caption: 'Updated 4 s ago', key: 'height' }]), /sc-stat-label">Block height<[\s\S]*data-value>1,166,072</);
  assert.match(table({ columns: [{ label: 'Block' }], rows: [], empty: 'No disputes are open.' }), /colspan="1">No disputes are open\.</);
  assert.match(table({ columns: [{ label: 'Block' }, { label: 'Extrinsics', align: 'right' }], rows: [['1', '2']] }), /<th scope="col" class="sc-r">Extrinsics/);
  assert.match(kvTable([['Symbol', 'CMN']]), /<th scope="row">Symbol<\/th><td>CMN<\/td>/);
  assert.deepEqual(Object.keys(BADGES).filter((w) => ['Live', 'Finalized', 'Pending', 'Stale', 'Dispute', 'Slashed', 'Operator-run', 'Testnet'].includes(w)).length, 8);
  assert.match(badge('Finalized'), /sc-badge sc-badge-ok">Finalized/);
  assert.match(badge('Dispute'), /sc-badge-bad/);
  assert.throws(() => badge('Cool'), /status word/);
  assert.match(tabs([{ label: 'Extrinsics', href: '?tab=extrinsics', current: true }, { label: 'Events', href: '?tab=events' }]), /role="tablist"[\s\S]*aria-selected="true">Extrinsics/);
  assert.match(searchField({ action: '/search', placeholder: 'Search', label: 'Search' }), /role="search"[\s\S]*type="search" name="q"/);
  assert.match(codeBlock('curl -s https://api.scalarnet.io/v1/status'), /sc-code"><pre><code>curl[\s\S]*data-copy=/);
  assert.match(callout({ variant: 'warning', body: 'Testnet.' }), /sc-callout sc-callout-warning" role="alert"/);
  assert.match(pagination({ nextHref: '?offset=25', from: 1, to: 25, total: 989474 }), /Showing 1–25 of 989,474/);
  assert.match(address('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', { href: '/account/x' }), /title="5Grwva[^"]+">5Grwva…utQY<\/a>/);
  assert.deepEqual(ICONS, ['search', 'menu', 'close', 'external-link', 'copy', 'check', 'chevron-right', 'chevron-down', 'arrow-right', 'warning', 'info']);
  assert.match(icon('search'), /viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1\.5"/);
  assert.throws(() => icon('sparkles'));
});
