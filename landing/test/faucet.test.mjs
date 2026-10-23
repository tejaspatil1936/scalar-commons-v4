// /faucet (SITE-REDESIGN.md §5.3), held to the brief: the title, the one
// sentence (its amount read in the browser, never typed), the form (label,
// 44 px field, one primary button), the inline SS58 check, the success and
// failure callouts, the collapsed "Use the API instead" with the two curl
// commands — and nothing else. The warning callout appears when the /health
// read fails, never from a flag. The script is driven in jsdom against stubbed
// faucet answers; the build emits the page on the plain chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { API_SUMMARY, CURL, DRIP_URL, HEALTH_URL, LABEL, LEAD_AFTER, LEAD_BEFORE, SUBMIT, UNAVAILABLE, renderFaucet } from '../src/faucet.mjs';
import { escapeHtml } from '../src/chrome/templates.mjs';
import { addressError, decodeSs58 } from '../src/faucet/address.js';
import { formatPlancks, formatWait, sentence } from '../src/faucet/format.js';

const landingDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = fileURLToPath(new URL('../../', import.meta.url));
const facts = JSON.parse(readFileSync(new URL('../chain-facts.json', import.meta.url), 'utf8'));
const html = renderFaucet({ facts, css: '/* css */', builtAt: '2026-10-23T20:00:00.000Z' });
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

test('the page: one h1 "Faucet", landmarks, title, description, canonical, Faucet current in the nav, one script', () => {
  assert.match(html, /<title>Faucet — Scalar Commons<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/scalarnet\.io\/faucet">/);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(main, /<h1 class="sc-h1">Faucet<\/h1>/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<header class="sc-header">/);
  assert.match(html, /<footer class="sc-footer">/);
  assert.match(html, /<a href="\/faucet" aria-current="page">Faucet<\/a>/);
  assert.equal((html.match(/<script type="module"/g) ?? []).length, 1);
  assert.match(html, /<script type="module" src="\/faucet\.js"><\/script>/, 'absolute, so /faucet/ works too');
});

test('the sentence: the brief’s words around an empty amount slot the browser fills; no digit is typed in the page', () => {
  assert.ok(main.includes(`${escapeHtml(LEAD_BEFORE)}<span data-drip-amount></span>${escapeHtml(LEAD_AFTER)}`));
  const lead = text(main.match(/<p class="sc-lead"[^>]*>([\s\S]*?)<\/p>/)[1]).trim();
  assert.equal(lead, 'Get test CMN for an address on the public testnet. One request per address every hour, with a separate limit per IP address. Tokens have no value.', 'with no figure the sentence still reads');
  // "SS58" is the address format's name, not a figure.
  const prose = text(main.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')).replace(/SS58/g, 'SS');
  assert.ok(!/\d/.test(prose), `a digit in the prose: ${prose.match(/.{0,30}\d.{0,30}/)?.[0]}`);
  assert.ok(!/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\s+(?:CMN|test CMN|tokens?)\b/i.test(prose), 'no amount in words');
  assert.ok(!/!/.test(prose), 'no exclamation marks');
  // The figures the script works with come from chain-facts.json.
  assert.ok(main.includes(`data-prefix="${facts.provenance.ss58Format}"`));
  assert.ok(main.includes(`data-decimals="${facts.token.decimals}"`));
  assert.ok(main.includes(`data-symbol="${facts.token.symbol}"`));
  assert.ok(main.includes(`data-health="${HEALTH_URL}"`) && main.includes(`data-drip="${DRIP_URL}"`));
});

test('the form: label "Your address (SS58)", one 44 px field, one primary button "Request test CMN", the error slot under the field', () => {
  const form = main.match(/<form class="fc-form"[\s\S]*?<\/form>/)[0];
  assert.match(form, new RegExp(`<label for="fc-address">${escapeHtml(LABEL).replace(/[()]/g, '\\$&')}</label>`));
  assert.equal((form.match(/<input /g) ?? []).length, 1);
  assert.match(form, /<input class="sc-input" id="fc-address" name="address" type="text"[^>]*aria-describedby="fc-address-error">/);
  assert.equal((main.match(/sc-btn-primary/g) ?? []).length, 1, 'one primary button');
  assert.match(form, new RegExp(`<button class="sc-btn sc-btn-primary" type="submit">${SUBMIT}</button>`));
  assert.match(form, /<p class="sc-field-error" id="fc-address-error" data-field-error hidden><\/p>/);
  assert.ok(!/ disabled/.test(form), 'the form is never disabled by a flag');
});

test('the warning callout is in the page, hidden, with the brief’s words; the result slot is empty and live', () => {
  assert.match(main, new RegExp(`<div data-unavailable hidden><div class="sc-callout sc-callout-warning" role="alert">[\\s\\S]*?${UNAVAILABLE.replace(/[.;]/g, '\\$&')}`));
  assert.match(main, /<div class="fc-result" data-result aria-live="polite" hidden><\/div>/);
  assert.match(main, /<noscript><div class="sc-callout sc-callout-info"/, 'scripts off: say the form needs a script');
  assert.match(html, /<noscript><style>\.fc-form \{ display: none; \}<\/style><\/noscript>/);
});

test('"Use the API instead": collapsed, with exactly the two curl commands', () => {
  const details = main.match(/<details class="fc-api">([\s\S]*?)<\/details>/);
  assert.ok(details, 'a <details>');
  assert.ok(!/<details[^>]* open/.test(main), 'collapsed');
  assert.match(details[1], new RegExp(`<summary>[\\s\\S]*${API_SUMMARY}</summary>`));
  assert.equal((details[1].match(/<pre>/g) ?? []).length, 2);
  for (const command of Object.values(CURL)) assert.ok(details[1].includes(escapeHtml(command)), command);
  assert.match(CURL.drip, /^curl -s -X POST https:\/\/faucet\.scalarnet\.io\/drip[\s\\]*-H 'content-type: application\/json'[\s\\]*-d '\{"address":"<your address>"\}'$/);
  // No line starts with indentation before a long unbreakable token (a phone would wrap it into a line of spaces).
  for (const line of CURL.drip.split('\n')) assert.ok(!/^\s+\S{24,}/.test(line), line);
  assert.equal(CURL.balance, 'curl -s https://faucet.scalarnet.io/balance/<your address>');
});

test('nothing else on the page: no stats, tables, badges, eyebrows, readings or legacy classes', () => {
  for (const gone of ['sc-stat', 'sc-table', 'sc-badge', 'nw-', 'fc-title', 'Recent drips', 'Faucet account', 'AS BUILT', 'OPERATOR-RUN']) assert.ok(!main.includes(gone), gone);
  const blocks = [...main.matchAll(/<(form|details|noscript|div data-unavailable|div class="fc-result"|div class="sc-page-head")/g)].map((m) => m[1]);
  assert.deepEqual(blocks, ['div class="sc-page-head"', 'noscript', 'div data-unavailable', 'form', 'div class="fc-result"', 'details']);
  for (const [, href] of main.matchAll(/href="([^"]+)"/g)) assert.fail(`a link in the page body that the brief does not ask for: ${href}`);
});

test('the SS58 check: a real decode with the chain’s prefix, and a plain sentence for each way an address is wrong', () => {
  const prefix = facts.provenance.ss58Format;
  assert.equal(decodeSs58(ALICE, { prefix }).ok, true);
  assert.equal(addressError(ALICE, prefix), null);
  assert.equal(addressError(`  ${ALICE}  `, prefix), null, 'surrounding spaces are not an error');
  assert.equal(addressError('', prefix), 'Enter an address.');
  assert.match(addressError('0xd43593c715fdd31c61141abd04a99fd6822c8558', prefix), /character SS58 does not use/);
  assert.match(addressError(`${ALICE.slice(0, -1)}Z`, prefix), /checksum does not match/);
  assert.match(addressError('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGK', prefix), /wrong length/);
  assert.equal(addressError('15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5', prefix), `That address is for another network (SS58 prefix 0). This chain uses prefix ${prefix}.`);
});

test('figures compose from the faucet’s answers: plancks with the chain’s decimals, waits rounded up', () => {
  assert.equal(formatPlancks('1100000000000000', 12), '1,100');
  assert.equal(formatPlancks('1500000000000', 12), '1.5');
  assert.equal(formatPlancks('1234567890000', 12), '1.23', 'never more than two decimals');
  assert.equal(formatPlancks('0', 12), '0');
  assert.equal(formatWait(3_600_000), '1 h');
  assert.equal(formatWait(3_000_000), '50 min');
  assert.equal(formatWait(3_540_001), '1 h', 'rounded up, never understated');
  assert.equal(formatWait(3_900_000), '1 h 5 min');
  assert.equal(formatWait(44_200), '45 s');
  assert.equal(sentence('rate limit reached for this address'), 'Rate limit reached for this address.');
});

// ── the script, in jsdom, against stubbed faucet answers ────────────────────
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const HEALTH = { ok: true, tokenSymbol: 'CMN', tokenDecimals: 12, dripAmountPlancks: '1100000000000000' };
const TX = `0x${'ab'.repeat(32)}`;
const BLOCK = `0x${'cd'.repeat(32)}`;
let run = 0;
async function boot({ health, drip = null }) {
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, ''), { url: 'https://scalarnet.io/faucet' });
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push([init.method ?? 'GET', url, init.body ?? null]);
    const answer = url === HEALTH_URL ? health : drip;
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(init) : answer;
  };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, fetch });
  run += 1;
  await import(`../src/faucet/main.js?run=${run}`);
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  };
  await settle();
  const doc = dom.window.document;
  const $ = (s) => doc.querySelector(s);
  const submit = async (value) => {
    $('#fc-address').value = value;
    $('[data-faucet-form]').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settle();
  };
  return { doc, $, calls, submit };
}

test('script: /health answers → the amount fills the sentence, no warning', async () => {
  const { $ } = await boot({ health: json(HEALTH) });
  assert.equal($('[data-intro]').textContent, `Get 1,100 test CMN${LEAD_AFTER.slice('test CMN'.length)}`);
  assert.equal($('[data-unavailable]').hidden, true);
});

test('script: /health cannot be read (CORS) → the sentence without a figure, and the warning callout', async () => {
  const { $ } = await boot({ health: new TypeError('Failed to fetch') });
  assert.equal($('[data-drip-amount]').textContent, '');
  assert.ok($('[data-intro]').textContent.startsWith('Get test CMN for an address'));
  assert.equal($('[data-unavailable]').hidden, false);
  assert.match($('[data-unavailable]').textContent, /The faucet is temporarily unavailable from this page; use the API below\./);
  assert.ok(!/\b0\b/.test($('[data-intro]').textContent), 'never a zero for an unknown');
});

test('script: a bad address is answered under the field and nothing is sent', async () => {
  const { $, calls, submit } = await boot({ health: json(HEALTH) });
  await submit(`${ALICE.slice(0, -1)}Z`);
  assert.equal($('[data-field-error]').hidden, false);
  assert.match($('[data-field-error]').textContent, /checksum does not match/);
  assert.equal($('#fc-address').getAttribute('aria-invalid'), 'true');
  assert.deepEqual(calls.map(([m]) => m), ['GET'], 'no POST');
  // Corrected in place: the error clears as soon as the address is valid.
  $('#fc-address').value = ALICE;
  $('#fc-address').dispatchEvent(new globalThis.window.Event('input'));
  assert.equal($('[data-field-error]').hidden, true);
});

test('script: a drip → the success callout with the amount, the extrinsic hash linked to the explorer, and the next request', async () => {
  const { $, calls, submit } = await boot({ health: json(HEALTH), drip: json({ ok: true, address: ALICE, amountPlancks: '1100000000000000', blockHash: BLOCK, txHash: TX }) });
  await submit(ALICE);
  const post = calls.find(([m]) => m === 'POST');
  assert.deepEqual(post, ['POST', DRIP_URL, JSON.stringify({ address: ALICE })]);
  const result = $('[data-result]');
  assert.equal(result.hidden, false);
  assert.ok(result.querySelector('.sc-callout-ok'));
  assert.match(result.textContent, /Sent 1,100 CMN to 5Grwv…GKutQY\./);
  const [to, link] = result.querySelectorAll('a');
  assert.equal(to.getAttribute('href'), `https://explorer.scalarnet.io/account/${ALICE}`, 'the address opens its account in the explorer');
  assert.equal(to.getAttribute('title'), ALICE);
  assert.equal(link.getAttribute('href'), `https://explorer.scalarnet.io/block/${BLOCK}`, 'the extrinsic hash opens its block in the explorer');
  assert.equal(link.getAttribute('title'), TX);
  assert.equal(link.textContent, `${TX.slice(0, 6)}…${TX.slice(-4)}`);
  assert.match(result.textContent, /Next request for this address: an hour from now\./);
  assert.equal($('[data-faucet-form] button').disabled, false);
});

test('script: refused → the faucet’s own message in an error callout, with the wait it reports', async () => {
  const { $, submit } = await boot({ health: json(HEALTH), drip: json({ ok: false, code: 'RATE_LIMITED', error: 'rate limit reached for this address', scope: 'address', retryAfterMs: 1_500_000 }, 429) });
  await submit(ALICE);
  const result = $('[data-result]');
  assert.ok(result.querySelector('.sc-callout-error'));
  assert.match(result.textContent, /Rate limit reached for this address\./);
  assert.match(result.textContent, /Next request for this address: 25 min from now\./);
});

test('script: an answer with no message names the status; a request that never arrives says so and shows the warning', async () => {
  let r = await boot({ health: json(HEALTH), drip: new Response('<html>bad gateway</html>', { status: 502 }) });
  await r.submit(ALICE);
  assert.match(r.$('[data-result]').textContent, /The faucet answered HTTP 502 \(bad gateway\) with no message\./);
  r = await boot({ health: json(HEALTH), drip: new TypeError('Failed to fetch') });
  await r.submit(ALICE);
  assert.match(r.$('[data-result]').textContent, /The request did not reach the faucet: this page could not read faucet\.scalarnet\.io\. Use the API below\./);
  assert.equal(r.$('[data-unavailable]').hidden, false);
});

// ── the files ───────────────────────────────────────────────────────────────
const OWN = ['src/faucet.mjs', 'src/faucet.css', 'src/faucet/main.js', 'src/faucet/address.js', 'src/faucet/format.js', 'src/faucet/blake2b.js', 'scripts/pages/faucet.mjs'];

test('the faucet’s files use the plain chrome only: nothing from chrome-legacy or another page', () => {
  for (const file of OWN) {
    const source = readFileSync(join(landingDir, file), 'utf8');
    assert.ok(!/chrome-legacy|observatory\/|pulse/.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${file} reaches outside the faucet and the chrome`);
  }
});

test('faucet.css holds to the chrome’s rules: tokens only, the spacing and type scales, no uppercase, tracking, shadow or motion', () => {
  const css = readFileSync(join(landingDir, 'src/faucet.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.test(css), 'a colour literal');
  const decls = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => [...m[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)].map((d) => [m[1].trim(), d[1], d[2].trim()]));
  assert.ok(decls.length > 10);
  for (const [sel, prop, value] of decls) {
    if (/^(?:margin|padding|gap|row-gap|column-gap)/.test(prop)) assert.match(value, /^(?:0|auto|var\(--s-[1-9]\)(?: var\(--s-[1-9]\))*|calc\(var\(--s-[1-9]\) [-+] var\(--s-[1-9]\)\))$/, `${sel} { ${prop}: ${value} }`);
    if (prop === 'font') assert.match(value, /^var\(--(?:display|h1|h2|h3|lead|body|small|caption|stat|mono)\)$/, `${sel} { font: ${value} }`);
    if (prop === 'font-weight') assert.match(value, /^(?:400|500|600)$/);
    if (/color|background/.test(prop) && !/^(?:none|transparent)$/.test(value)) assert.match(value, /^var\(--(?:bg|bg-2|border|control|text|text-2|text-3|accent|accent-2|ok|warn|bad|ok-bg|warn-bg|bad-bg)\)$/, `${sel} { ${prop}: ${value} }`);
    if (prop === 'transition') assert.equal(value, 'color .15s, background-color .15s, border-color .15s');
    assert.ok(!['font-size', 'letter-spacing', 'text-transform', 'box-shadow', 'animation'].includes(prop), `${sel} { ${prop} }`);
  }
  assert.ok(!/gradient\(|@keyframes/.test(css));
});

test('npm run build emits faucet.html on the plain chrome, absolute font URLs, and faucet.js with the SS58 check', () => {
  const out = mkdtempSync(join(tmpdir(), 'landing-faucet-'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: landingDir, env: { ...process.env, LANDING_OUT_DIR: out }, stdio: 'pipe' });
  for (const file of ['faucet.html', 'faucet.js']) assert.ok(readdirSync(out).includes(file), file);
  const page = readFileSync(join(out, 'faucet.html'), 'utf8');
  assert.match(page, /--accent:\s*#1457d6/, 'the plain chrome is inlined');
  assert.ok(!/--paper|nw-|Source Serif|IBM Plex/.test(page), 'nothing of the Ledger');
  assert.match(page, /url\("?\/fonts\/inter-latin-wght-normal\.woff2/);
  assert.ok(existsSync(join(out, 'fonts/inter-latin-wght-normal.woff2')) && existsSync(join(out, 'fonts/jetbrains-mono-latin-400-normal.woff2')));
  const script = readFileSync(join(out, 'faucet.js'), 'utf8');
  assert.ok(/SS58PRE/.test(script), 'the SS58 check rides in the bundle');
  assert.ok(script.length < 12 * 1024, `faucet.js is ${script.length} bytes`);
  assert.ok(!/force-graph|gsap|d3-/.test(script));
});

test('nginx: the faucet vhost answers the site’s origin with CORS headers at server level and the preflight in its one location', () => {
  const conf = readFileSync(join(repoDir, 'deploy/public/nginx/scalar-commons.conf.template'), 'utf8');
  const vhost = conf.slice(conf.indexOf('server_name faucet.<DOMAIN>;'), conf.indexOf('#  (f) explorer'));
  assert.ok(vhost.length > 100);
  assert.match(vhost, /add_header Access-Control-Allow-Origin\s+"https:\/\/<DOMAIN>" always;/);
  assert.match(vhost, /add_header Access-Control-Allow-Methods "POST, GET, OPTIONS" always;/);
  assert.match(vhost, /add_header Access-Control-Allow-Headers "content-type" always;/);
  assert.ok(vhost.indexOf('Access-Control-Allow-Origin') < vhost.indexOf('location /'), 'at server level, beside the security headers');
  assert.equal((vhost.match(/^\s*location\b/gm) ?? []).length, 1, 'exactly one location');
  const location = vhost.slice(vhost.indexOf('location / {')).replace(/#.*$/gm, '');
  const firstLine = location.split('\n').slice(1).find((l) => l.trim() && !l.trim().startsWith('#'));
  assert.equal(firstLine.trim(), 'if ($request_method = OPTIONS) { return 204; }');
  assert.ok(!/add_header/.test(location), 'no add_header inside the location: it would drop the security headers');
  assert.match(location, /proxy_set_header X-Forwarded-For\s+\$remote_addr;/, 'the per-IP limit stays protected');
});
