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
