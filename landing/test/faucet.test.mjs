// /faucet (SITE-REDESIGN.md §5.3). The page is the title, one intro whose only
// figure the browser reads from GET /health, the form, and a collapsed "Use
// the API instead" — nothing else, and no callout until something happened.
// The script is run here against the real markup with the network played by
// a stub: the amount fills, a bad address is refused before anything is sent,
// a sent drip becomes the success callout, a refusal becomes the error callout
// with the API's words and its wait, and a request the browser cannot read at
// all (no CORS permission yet) becomes the one warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { API_SUMMARY, CURL, DESCRIPTION, DRIP_URL, EMPTY, HEALTH_URL, INTRO, LABEL, NEEDS_SCRIPT, SUBMIT, UNAVAILABLE, refusal, renderFaucet } from '../src/faucet.mjs';
import { DISCLAIMER, escapeHtml } from '../src/chrome/templates.mjs';
import { decodeSs58 } from '../src/faucet/address.js';
import { formatCmn, formatDuration, formatPlancks } from '../src/faucet/format.js';
import { init } from '../src/faucet/page.js';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));
const html = renderFaucet({ facts, css: '/* css */', builtAt: '2026-10-23T11:32:11.000Z' });
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
/** The markup a visitor sees before anything happened: no template, no noscript. */
const live = main.replace(/<template[\s\S]*?<\/template>/g, '').replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
const text = (markup) => markup.replace(/<[^>]+>/g, ' ');

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const HEALTH = { ok: true, chain: 'Scalar Commons Local Testnet', specName: 'scalar-commons', specVersion: 309, tokenSymbol: 'CMN', tokenDecimals: 12, faucetAddress: '5Ff3A2zFHT5zYujb2gaF4s8z5CALoCdizSVstTqTtttCjezQ', faucetFreePlancks: '4647593951671899590', dripAmountPlancks: '1100000000000000', reservePlancks: '1000000000000000' };
const SENT = { ok: true, address: ALICE, amountPlancks: '1100000000000000', blockHash: '0x9ed1be710564ba25e7eb38de011fe4e7531e6fde01cdf406055c0acc15b0dd5f', txHash: '0x4b1c0e2f8a6d3c9b7e5f1a2d4c6b8e0f9a7c5d3b1e2f4a6c8d0b2e4f6a8c0d1e' };
const REFUSED = { ok: false, code: 'RATE_LIMITED', error: 'rate limit reached for this address', scope: 'address', retryAfterMs: 3_540_000 };

test('the frame through the chrome: title, description, canonical, Faucet current in the nav, one h1, the footer line', () => {
  assert.match(html, /<title>Faucet — Scalar Commons<\/title>/);
  assert.ok(html.includes(`<meta name="description" content="${escapeHtml(DESCRIPTION)}">`));
  assert.match(html, /<link rel="canonical" href="https:\/\/scalarnet\.io\/faucet">/);
  assert.match(html, /<a href="\/faucet" aria-current="page">Faucet<\/a>/);
  assert.equal((main.match(/<h1/g) ?? []).length, 1);
  assert.match(main, /<h1 class="sc-h1">Faucet<\/h1>/);
  assert.match(html, /<main id="main">/);
  assert.ok(html.includes(`${DISCLAIMER} Runtime ${facts.provenance.specName} ${facts.provenance.specVersion}. Page built 23 Oct 2026, 11:32 UTC`));
  assert.match(html, /<script type="module" src="faucet\.js"><\/script>/);
  assert.ok(!/nw-|AS BUILT|⌘K/.test(html), 'no Ledger chrome survives');
});

test('the intro: three sentences, the amount a skeleton the browser fills, every other figure from chain-facts.json', () => {
  assert.ok(main.includes(`<p class="sc-lead">${INTRO.before} <span data-amount><span class="sc-skeleton"`));
  assert.ok(main.includes(`</span> ${escapeHtml(INTRO.after)}</p>`));
  assert.ok(INTRO.after.endsWith('Tokens have no value.'));
  assert.ok(main.includes(`data-prefix="${facts.provenance.ss58Format}"`));
  assert.ok(main.includes(`data-decimals="${facts.token.decimals}"`) && main.includes(`data-symbol="${facts.token.symbol}"`));
  assert.ok(main.includes(`data-health="${HEALTH_URL}"`) && main.includes(`data-drip="${DRIP_URL}"`));
  assert.ok(main.includes(`data-refusal="${escapeHtml(refusal(facts.provenance.ss58Format))}"`) && main.includes(`data-empty="${EMPTY}"`));
  // The one allowed figure-looking word is the address format's name, SS58, in the brief's label.
  const prose = text(live.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<div class="sc-container"[^>]*>/, ' ').replace(/data-copy="[^"]*"/g, '')).replace(/SS58/g, '');
  assert.ok(!/\d/.test(prose), `a digit typed in the prose: ${prose.match(/.{0,30}\d.{0,30}/)?.[0]}`);
});

test('the form: the label bound to the input, the inline error under the field, one primary button, no native validation', () => {
  assert.match(main, /<form class="sc-stack" data-drip-form novalidate>/);
  assert.ok(main.includes(`<label for="address">${LABEL}</label>`));
  assert.match(main, /<input class="sc-input" id="address" name="address" type="text"[^>]*aria-describedby="address-error">/);
  assert.match(main, /<p class="sc-field-error" id="address-error" data-field-error aria-live="polite" hidden><\/p>/);
  assert.equal((main.match(/sc-btn-primary/g) ?? []).length, 1, 'one primary button on the page');
  assert.ok(main.includes(`<button class="sc-btn sc-btn-primary" type="submit">${SUBMIT}</button>`));
});

test('no callout until something happened: the live markup has none, the three states and the copy button are templates', () => {
  assert.ok(!live.includes('sc-callout'), 'a callout is shown before anything happened');
  assert.match(main, /<div data-notice hidden><\/div>/);
  assert.match(main, /<div data-result aria-live="polite" hidden><\/div>/);
  const tpl = (name) => main.match(new RegExp(`<template data-tpl="${name}">([\\s\\S]*?)</template>`))?.[1];
  assert.match(tpl('unavailable'), new RegExp(`sc-callout-warning" role="alert"[\\s\\S]*${escapeHtml(UNAVAILABLE)}`));
  assert.match(tpl('success'), /sc-callout-ok"/);
  assert.match(tpl('error'), /sc-callout-error" role="alert"/);
  assert.match(tpl('copy'), /<button type="button" class="sc-copy" data-copy=""/);
  assert.ok(main.includes(`<noscript><div class="sc-callout sc-callout-warning" role="alert">`) && main.includes(NEEDS_SCRIPT));
  assert.match(html, /<noscript><style>\[data-drip-form\], \[data-amount\] \{ display: none; \}<\/style><\/noscript>/);
});

test('Use the API instead: a collapsed details holding the two curl commands as code blocks with copy buttons', () => {
  assert.match(main, /<details class="sc-stack" data-api>\s*<summary>Use the API instead<\/summary>/);
  assert.ok(!/<details class="sc-stack" data-api open/.test(main));
  assert.equal(Object.keys(CURL).length, 2);
  assert.equal(CURL.health, `curl -s ${HEALTH_URL}`);
  assert.ok(CURL.drip.startsWith(`curl -s -X POST ${DRIP_URL}`) && CURL.drip.includes('{"address":"<your SS58 address>"}'), 'the drip body field is `address` (faucet/src/server.ts)');
  const details = main.match(/<details[\s\S]*?<\/details>/)[0];
  assert.equal((details.match(/class="sc-code"/g) ?? []).length, 2);
  for (const command of Object.values(CURL)) {
    assert.ok(details.includes(`<pre><code>${escapeHtml(command)}</code></pre>`), command);
    assert.ok(details.includes(`data-copy="${escapeHtml(command)}"`), 'a copy button for each command');
  }
  assert.equal(API_SUMMARY, 'Use the API instead');
});

test('nothing else on the page: no section, table, stats, second heading or image', () => {
  for (const gone of ['<section', '<table', 'sc-stats', '<h2', '<h3', '<img', 'Faucet account', 'Recent drips']) assert.ok(!live.includes(gone), gone);
  assert.equal((live.match(/<p[ >]/g) ?? []).length, 2, 'the intro and the field error');
});

// ── the script, against the real markup ─────────────────────────────────────
const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => (typeof body === 'string' ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)),
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'));
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 1));
};

/** Boot the page with `net` answering GET /health and POST /drip; returns the DOM and a way to submit. */
async function boot(net) {
  const dom = new JSDOM(html, { url: 'http://localhost/faucet' });
  const doc = dom.window.document;
  const root = doc.querySelector('[data-faucet]');
  const calls = [];
  const fetchImpl = (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    return net(String(url), init);
  };
  const { ready } = init(root, { fetch: fetchImpl });
  await ready;
  const submit = async (value) => {
    doc.querySelector('#address').value = value;
    doc.querySelector('[data-drip-form]').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    await settle();
  };
  const q = (sel) => doc.querySelector(sel);
  return { doc, q, calls, submit };
}
const healthThen = (drip) => (url, init) => (url === HEALTH_URL ? Promise.resolve(reply(200, HEALTH)) : drip(url, init));

test('GET /health fills the amount in place, with the chain’s decimals and at most two shown', async () => {
  const { q, calls } = await boot(healthThen(unreachable));
  assert.equal(q('[data-amount]').textContent, '1,100');
  assert.equal(q('[data-amount]').getAttribute('title'), null);
  assert.equal(q('.sc-lead').textContent.replace(/\s+/g, ' '), `${INTRO.before} 1,100 ${INTRO.after}`);
  assert.equal(calls[0].url, HEALTH_URL);
  assert.equal(calls[0].mode, 'cors');
  const fractional = await boot((url) => (url === HEALTH_URL ? Promise.resolve(reply(200, { ...HEALTH, dripAmountPlancks: '1100123400000000' })) : unreachable()));
  assert.equal(fractional.q('[data-amount]').textContent, '1,100.12');
  assert.equal(fractional.q('[data-amount]').getAttribute('title'), '1,100.1234 CMN');
});

test('a /health the browser cannot read shows the one warning and drops the amount; an HTTP error only drops the amount', async () => {
  const blocked = await boot(unreachable);
  assert.equal(blocked.q('[data-notice] .sc-callout-warning')?.textContent.trim(), UNAVAILABLE);
  assert.equal(blocked.q('[data-notice]').hidden, false);
  assert.equal(blocked.q('[data-amount]'), null);
  assert.equal(blocked.q('.sc-lead').textContent.replace(/\s+/g, ' '), `${INTRO.before} ${INTRO.after}`);
  assert.equal(blocked.q('button[type="submit"]').disabled, false, 'the form stays usable: the next request decides');
  const down = await boot((url) => (url === HEALTH_URL ? Promise.resolve(reply(502, '<html>bad gateway</html>')) : unreachable()));
  assert.equal(down.q('[data-amount]'), null);
  assert.equal(down.q('[data-notice]').hidden, true);
});

test('an empty or invalid address is refused under the field before anything is sent', async () => {
  const { q, calls, submit } = await boot(healthThen(unreachable));
  await submit('');
  assert.equal(q('[data-field-error]').textContent, EMPTY);
  assert.equal(q('[data-field-error]').hidden, false);
  assert.equal(q('#address').getAttribute('aria-invalid'), 'true');
  await submit('not an address');
  assert.equal(q('[data-field-error]').textContent, refusal(facts.provenance.ss58Format));
  await submit('15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5');
  assert.equal(q('[data-field-error]').textContent, refusal(facts.provenance.ss58Format), 'another chain’s prefix is refused');
  assert.deepEqual(calls.map((c) => c.url), [HEALTH_URL], 'nothing was sent');
  q('#address').dispatchEvent(new (q('#address').ownerDocument.defaultView.Event)('input', { bubbles: true }));
  assert.equal(q('[data-field-error]').hidden, true, 'typing clears the refusal');
  assert.equal(q('#address').getAttribute('aria-invalid'), null);
});

test('a sent drip: POST /drip with the address as JSON, then the success callout — amount, recipient, hash with a copy button, block linked', async () => {
  const { q, calls, submit } = await boot(healthThen(() => Promise.resolve(reply(200, SENT))));
  await submit(` ${ALICE} `);
  const drip = calls[1];
  assert.equal(drip.url, DRIP_URL);
  assert.equal(drip.method, 'POST');
  assert.equal(drip.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(drip.body), { address: ALICE });
  const callout = q('[data-result] .sc-callout-ok');
  assert.ok(callout, 'the success callout');
  assert.equal(q('[data-result]').hidden, false);
  const lines = [...callout.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim());
  assert.equal(lines[0], 'Sent 1,100 CMN to 5Grwva…utQY.');
  assert.equal(lines[1], 'Extrinsic 0x4b1c…0d1e Copy in block 0x9ed1…dd5f.');
  const recipient = callout.querySelector(`a[href="https://explorer.scalarnet.io/account/${ALICE}"]`);
  assert.equal(recipient?.getAttribute('title'), ALICE);
  assert.equal(recipient?.closest('.sc-addr')?.className, 'sc-addr', 'mono, never broken across lines');
  assert.equal(callout.querySelector(`span[title="${SENT.txHash}"]`)?.textContent, '0x4b1c…0d1e');
  const copy = callout.querySelector('button.sc-copy');
  assert.equal(copy?.getAttribute('data-copy'), SENT.txHash);
  assert.equal(copy?.getAttribute('aria-label'), `Copy ${SENT.txHash}`);
  assert.equal(callout.querySelector(`a[href="https://explorer.scalarnet.io/block/${SENT.blockHash}"]`)?.getAttribute('title'), SENT.blockHash);
  assert.equal(q('[data-notice]').hidden, true);
  assert.equal(q('button[type="submit"]').disabled, false);
  assert.equal(q('[data-field-error]').hidden, true);
  await submit('nope');
  assert.equal(q('[data-result]').hidden, true, 'a new request clears the last answer');
});

test('a refused drip: the API’s message as a sentence, and the wait from retryAfterMs or Retry-After', async () => {
  const address = await boot(healthThen(() => Promise.resolve(reply(429, REFUSED, { 'retry-after': '3540' }))));
  await address.submit(ALICE);
  const callout = address.q('[data-result] .sc-callout-error');
  assert.equal(callout?.getAttribute('role'), 'alert');
  assert.deepEqual([...callout.querySelectorAll('p')].map((p) => p.textContent), ['Rate limit reached for this address.', 'Next request for this address: 59 min from now.']);
  assert.equal(address.q('[data-result] .sc-callout-ok'), null);
  const ip = await boot(healthThen(() => Promise.resolve(reply(429, { ...REFUSED, error: 'rate limit reached for this ip', scope: 'ip', retryAfterMs: undefined }, { 'retry-after': '120' }))));
  await ip.submit(ALICE);
  assert.deepEqual([...ip.q('[data-result] .sc-callout-error').querySelectorAll('p')].map((p) => p.textContent), ['Rate limit reached for this ip.', 'Next request from this IP address: 2 min from now.']);
  const broke = await boot(healthThen(() => Promise.resolve(reply(503, { ok: false, code: 'INSUFFICIENT_FAUCET_FUNDS', error: 'faucet balance 1 cannot fund a drip of 2 while holding a reserve of 3' }))));
  await broke.submit(ALICE);
  assert.deepEqual([...broke.q('[data-result] .sc-callout-error').querySelectorAll('p')].map((p) => p.textContent), ['Faucet balance 1 cannot fund a drip of 2 while holding a reserve of 3.']);
  const bare = await boot(healthThen(() => Promise.resolve(reply(502, '<html>bad gateway</html>'))));
  await bare.submit(ALICE);
  assert.deepEqual([...bare.q('[data-result] .sc-callout-error').querySelectorAll('p')].map((p) => p.textContent), ['The faucet answered HTTP 502.']);
});

test('a drip the browser cannot read at all shows the one warning above the form, once, and no result', async () => {
  const { q, submit } = await boot(healthThen(unreachable));
  await submit(ALICE);
  assert.equal(q('[data-notice] .sc-callout-warning')?.textContent.trim(), UNAVAILABLE);
  assert.equal(q('[data-result]').hidden, true);
  await submit(ALICE);
  assert.equal(q('[data-notice]').querySelectorAll('.sc-callout').length, 1);
  assert.equal(q('button[type="submit"]').disabled, false);
});

// ── the pure parts ───────────────────────────────────────────────────────────
test('figures compose from plancks with the chain’s decimals; waits are rounded up with their unit', () => {
  assert.equal(formatPlancks('1100000000000000', 12), '1,100');
  assert.equal(formatPlancks('1500000000000', 12), '1.5');
  assert.equal(formatPlancks('0', 12), '0');
  assert.deepEqual(formatCmn('1100000000000000', 12), { text: '1,100', full: '1,100', truncated: false });
  assert.deepEqual(formatCmn('1100123400000000', 12), { text: '1,100.12', full: '1,100.1234', truncated: true });
  assert.deepEqual(formatCmn('1000000000', 12), { text: '0.001', full: '0.001', truncated: false }, 'too small for two decimals: never shown as zero');
  assert.equal(formatDuration(500), '1 s');
  assert.equal(formatDuration(45_000), '45 s');
  assert.equal(formatDuration(3_540_000), '59 min');
  assert.equal(formatDuration(3_600_000), '1 h');
  assert.equal(formatDuration(5_400_000), '1 h 30 min');
});

test('the address check is a real SS58 decode with the chain’s prefix', () => {
  assert.equal(decodeSs58(ALICE, { prefix: facts.provenance.ss58Format }).ok, true);
  assert.equal(decodeSs58(`${ALICE.slice(0, -1)}Z`, { prefix: 42 }).ok, false, 'a damaged checksum is refused');
  assert.equal(decodeSs58('15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5', { prefix: 42 }).ok, false, 'another chain’s prefix is refused');
  assert.equal(decodeSs58('not an address', { prefix: 42 }).ok, false);
  assert.equal(decodeSs58('', { prefix: 42 }).ok, false);
});

test('npm run build emits faucet.html with the plain chrome inlined and faucet.js with the decoder, and 404.html with no script file', () => {
  const out = mkdtempSync(join(tmpdir(), 'landing-faucet-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: landingDir, env: { ...process.env, LANDING_OUT_DIR: out }, stdio: 'pipe' });
  const files = readdirSync(out);
  for (const file of ['faucet.html', 'faucet.js', '404.html', 'favicon.svg', 'og.png']) assert.ok(files.includes(file), file);
  for (const gone of ['faucet.css', '404.js']) assert.ok(!files.includes(gone), `${gone} is no longer built`);
  const page = readFileSync(join(out, 'faucet.html'), 'utf8');
  assert.ok(!/fonts\.googleapis|cdn\./.test(page));
  assert.ok(/--accent:\s*#1457d6/.test(page) && !page.includes('--paper'), 'the plain chrome is inlined, not the Ledger');
  assert.ok(page.includes('url(/fonts/inter-latin-wght-normal.woff2)') && !/url\(["']?fonts\//.test(page), 'font URLs are absolute');
  assert.ok(!/nw-/.test(page));
  const script = readFileSync(join(out, 'faucet.js'), 'utf8');
  assert.ok(!/force-graph|gsap|d3|alphaDecay/.test(script), 'the faucet script carries no library');
  assert.ok(/SS58PRE/.test(script), 'the SS58 decoder rides in the bundle');
  assert.ok(script.length < 12 * 1024, `faucet.js is ${script.length} bytes`);
});
