// /faucet (brief §5.6). What the page must not quietly lose: the closed state
// is the default (the faucet host grants no cross-origin read today), with
// the three curl commands, the field and the button disabled for a stated
// reason; every figure is a Reading with a receipt and no digit is typed in
// the page's prose; the address check is a real SS58 decode with the chain's
// prefix; the build emits the page and its script beside the oversight page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURL, EYEBROW, LINE, NOT_READABLE, WHY, refusal, renderFaucet } from '../src/faucet.mjs';
import { escapeHtml, DISCLAIMER } from '../src/chrome/templates.mjs';
import { decodeSs58 } from '../src/faucet/address.js';
import { formatInterval, formatPlancks } from '../src/faucet/format.js';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));
const html = renderFaucet({ facts, css: '/* css */' });
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ');

test('the frame: chrome bar with Faucet current, eyebrow, the one line, the footer disclaimer', () => {
  assert.match(html, /<title>Faucet — Scalar Commons<\/title>/);
  assert.match(html, /<a href="faucet" aria-current="page">Faucet<\/a>/);
  assert.ok(html.includes(`data-state="operator">`) && html.includes(EYEBROW), 'the clay-dot eyebrow');
  assert.ok(html.includes(escapeHtml(LINE)));
  assert.ok(html.includes(DISCLAIMER));
  assert.ok(html.includes(`spec ${facts.provenance.specVersion}`), 'footer facts from chain-facts.json');
  assert.match(html, /<script type="module" src="faucet\.js"><\/script>/);
});

test('closed by default: the reason, the three curl commands, the field and the button disabled with the reason', () => {
  assert.equal((main.match(/data-state="closed"/g) ?? []).length, 1);
  assert.ok(main.includes(escapeHtml(WHY)));
  for (const command of Object.values(CURL)) assert.ok(main.includes(escapeHtml(command)), `missing: ${command}`);
  assert.ok(CURL.drip.includes('{"address":"<your SS58 address>"}'), 'the drip body field is `address` (faucet/src/server.ts)');
  assert.match(main, /<input class="nw-field" disabled aria-describedby="fc-why"[^>]*name="address"/);
  assert.match(main, /<button class="nw-button fc-send" aria-describedby="fc-why" type="submit" disabled>Send</);
  assert.match(main, /id="fc-why"/);
});

test('every figure is a Reading with a receipt that names the request; the slots are leaders to nothing', () => {
  for (const key of ['title-amount', 'title-interval', 'amount', 'next-drip', 'faucet-address', 'faucet-balance']) {
    assert.ok(main.includes(`data-reading="${key}"`), key);
  }
  for (const label of ['Amount', 'Next drip for this address', 'Address', 'Balance', 'Recent drips', 'Faucet account']) {
    assert.ok(main.includes(`>${label}<`), label);
  }
  assert.ok((main.match(/GET faucet\.scalarnet\.io\/health/g) ?? []).length >= 5);
  assert.ok(main.includes('POST faucet.scalarnet.io/drip'));
  assert.ok(main.includes(NOT_READABLE));
  assert.ok(!main.includes('nw-figure nw-figure--l" data-reading-value aria-live="polite" aria-atomic="true">1'), 'no figure is pre-filled');
});

test('no digit is typed in the page’s prose: amounts, limits and addresses come from responses', () => {
  const prose = text(main.replace(/<pre[\s\S]*?<\/pre>/g, ' '));
  assert.ok(!/\d/.test(prose), `a digit in the prose: ${prose.match(/.{0,30}\d.{0,30}/)?.[0]}`);
  assert.equal(refusal(facts.provenance.ss58Format), `That is not an SS58 address for this chain (prefix ${facts.provenance.ss58Format}).`);
  assert.ok(main.includes(`data-prefix="${facts.provenance.ss58Format}"`), 'the prefix comes from chain-facts.json');
});

test('figures compose from plancks with the chain’s decimals', () => {
  assert.equal(formatPlancks('1100000000000000', 12), '1,100');
  assert.equal(formatPlancks('1500000000000', 12), '1.5');
  assert.equal(formatPlancks('0', 12), '0');
  assert.equal(formatInterval(3_600_000), 'once every 1 h');
  assert.equal(formatInterval(90_000), 'once every 90 s');
});

test('the address check is a real SS58 decode with the chain’s prefix', () => {
  const alice = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
  assert.equal(decodeSs58(alice, { prefix: facts.provenance.ss58Format }).ok, true);
  assert.equal(decodeSs58(`${alice.slice(0, -1)}Z`, { prefix: 42 }).ok, false, 'a damaged checksum is refused');
  assert.equal(decodeSs58('15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5', { prefix: 42 }).ok, false, 'another chain’s prefix is refused');
  assert.equal(decodeSs58('not an address', { prefix: 42 }).ok, false);
  assert.equal(decodeSs58('', { prefix: 42 }).ok, false);
});

test('faucet.css draws in the Ledger: tokens only, no hue, the eleven fonts, rules as lines never frames, no gradient, no shadow, no italic', () => {
  const css = readFileSync(new URL('../src/faucet.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.test(css), 'a colour literal');
  for (const [, name] of css.matchAll(/(?:color|background)\s*:\s*var\(--([a-z0-9-]+)\)/g)) assert.ok(['paper', 'paper-2', 'paper-3', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-2'].includes(name), `--${name} is not a Ledger token`);
  assert.ok(!/filament|vermilion|--ice|--clay|--pine|--bone|--sage|--glow/.test(css), 'a Nightwatch token survives');
  for (const [, prop, value] of css.matchAll(/(border(?!-radius)[a-z-]*)\s*:\s*([^;]+);/g)) {
    assert.match(prop, /^border-(?:top|bottom)$/, `a border that is not a top or bottom rule: ${prop}`);
    assert.match(value.trim(), /^1px solid var\(--rule(?:-2)?\)$/, value);
  }
  assert.ok(!/gradient\(|box-shadow|text-shadow|font-style:\s*italic/.test(css));
  assert.ok(!/font-size\s*:/.test(css), 'nothing sets a font-size');
  for (const [, value] of css.matchAll(/(?:^|[;{\s])font:\s*([^;]+);/g)) assert.match(value.trim(), /^var\(--(?:display|h2|h3|body|small|figure-(?:xl|l|m|s)|label|mono)\)$/);
  assert.match(css, /\.fc-title-word \{ font: var\(--display\); letter-spacing: -0\.015em;/, 'the display face at the Ledger’s tracking');
  assert.match(css, /@media \(max-width: 480px\)/, 'the narrow step is the contract’s 480 px');
});

test('npm run build emits faucet.html and faucet.js beside oversight.html and oversight.js', () => {
  const out = mkdtempSync(join(tmpdir(), 'landing-faucet-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: landingDir, env: { ...process.env, LANDING_OUT_DIR: out }, stdio: 'pipe' });
  const files = readdirSync(out);
  for (const file of ['faucet.html', 'faucet.js', 'faucet.css', 'oversight.html', 'oversight.js', 'oversight.css', 'oversight-sample.json']) assert.ok(files.includes(file), file);
  const page = readFileSync(join(out, 'faucet.html'), 'utf8');
  assert.ok(!/fonts\.googleapis|cdn\./.test(page));
  assert.ok(page.includes('--paper:'), 'the chrome is inlined');
  const script = readFileSync(join(out, 'faucet.js'), 'utf8');
  assert.ok(!/force-graph|gsap|alphaDecay/.test(script), 'the faucet script carries no instrument library');
  assert.ok(/SS58PRE/.test(script), 'the SS58 decoder rides in the bundle');
});
