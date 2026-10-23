// Renders /faucet (SITE-REDESIGN.md §5.3): the title, one intro, the form, a
// collapsed "Use the API instead", and nothing else. No figure is typed here:
// the drip amount is a skeleton the browser fills from `GET /health`
// (src/faucet/page.js), the chain's SS58 prefix and token come from
// chain-facts.json, and the callouts for a sent, refused or unreachable
// request are <template>s the script clones — so the page carries no success
// or error state until one has happened.
import { EXPLORER_ORIGIN, button, callout, codeBlock, copyButton, escapeHtml, page, skeleton } from './chrome/templates.mjs';

export const FAUCET_ORIGIN = 'https://faucet.scalarnet.io';
export const HEALTH_URL = `${FAUCET_ORIGIN}/health`;
export const DRIP_URL = `${FAUCET_ORIGIN}/drip`;

export const TITLE = 'Faucet';
export const DESCRIPTION = 'Request test CMN for an address on the Scalar Commons public testnet. The tokens have no value.';
/** The intro, in three sentences; the amount is the one figure, and the browser reads it. */
export const INTRO = {
  before: 'Get',
  after: 'test CMN for an address on the public testnet. The faucet limits requests per address and per IP address, and a refused request says how long to wait. Tokens have no value.',
};
export const LABEL = 'Your address (SS58)';
export const SUBMIT = 'Request test CMN';
export const API_SUMMARY = 'Use the API instead';
/** Shown only when the browser cannot read the faucet at all (no CORS permission yet, or no network). */
export const UNAVAILABLE = 'The faucet is temporarily unavailable from this page; use the API below.';
export const NEEDS_SCRIPT = 'The form needs JavaScript; use the API below.';

/** The two commands, as a terminal would take them. The drip body's field is `address` (faucet/src/server.ts). */
export const CURL = {
  health: `curl -s ${HEALTH_URL}`,
  drip: `curl -s -X POST ${DRIP_URL} \\\n  -H 'content-type: application/json' \\\n  -d '{"address":"<your SS58 address>"}'`,
};

/** The field's two refusals; the prefix is the chain's, from chain-facts.json. */
export const EMPTY = 'Enter an address.';
export const refusal = (prefix) => `That is not a valid SS58 address for this chain (prefix ${prefix}).`;

export function renderFaucet({ facts, css, builtAt }) {
  const p = facts.provenance;
  const root = {
    'data-faucet': true,
    'data-health': HEALTH_URL,
    'data-drip': DRIP_URL,
    'data-explorer': EXPLORER_ORIGIN,
    'data-prefix': p.ss58Format,
    'data-decimals': facts.token.decimals,
    'data-symbol': facts.token.symbol,
    'data-refusal': refusal(p.ss58Format),
    'data-empty': EMPTY,
  };
  const rootAttrs = Object.entries(root)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
    .join('');

  const body = `<div class="sc-container"${rootAttrs}>
  <div class="sc-page-head">
    <h1 class="sc-h1">${escapeHtml(TITLE)}</h1>
    <p class="sc-lead">${escapeHtml(INTRO.before)} <span data-amount>${skeleton('5ch')}</span> ${escapeHtml(INTRO.after)}</p>
  </div>
  <div class="sc-reading sc-stack">
    <noscript>${callout({ variant: 'warning', body: escapeHtml(NEEDS_SCRIPT) })}</noscript>
    <div data-notice hidden></div>
    <form class="sc-stack" data-drip-form novalidate>
      <div class="sc-field">
        <label for="address">${escapeHtml(LABEL)}</label>
        <input class="sc-input" id="address" name="address" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="address-error">
        <p class="sc-field-error" id="address-error" data-field-error aria-live="polite" hidden></p>
      </div>
      <div>${button({ text: SUBMIT, type: 'submit' })}</div>
    </form>
    <div data-result aria-live="polite" hidden></div>
    <details class="sc-stack" data-api>
      <summary>${escapeHtml(API_SUMMARY)}</summary>
      <div>${codeBlock(CURL.health)}</div>
      <div>${codeBlock(CURL.drip)}</div>
    </details>
  </div>
  <template data-tpl="unavailable">${callout({ variant: 'warning', body: escapeHtml(UNAVAILABLE) })}</template>
  <template data-tpl="success">${callout({ variant: 'ok', body: '' })}</template>
  <template data-tpl="error">${callout({ variant: 'error', body: '' })}</template>
  <template data-tpl="copy">${copyButton('')}</template>
</div>`;

  // Scripts off: the form cannot send anything and the skeleton would never fill, so neither is shown.
  const extraHead = '\n<noscript><style>[data-drip-form], [data-amount] { display: none; }</style></noscript>';
  return page({ title: TITLE, description: DESCRIPTION, path: '/faucet', current: 'faucet', facts, builtAt, body, css, scripts: ['faucet.js'], extraHead });
}
