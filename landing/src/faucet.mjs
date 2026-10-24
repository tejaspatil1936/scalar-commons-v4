// /faucet (SITE-REDESIGN.md §5.3): the title, one sentence, the form, and the
// API commands in a collapsed disclosure. Nothing else.
//
// Nothing on the page is typed as a figure. The drip amount is read in the
// visitor's browser from the faucet's own `GET /health` (src/faucet/main.js);
// until it answers, and whenever it cannot, the sentence reads without the
// figure rather than with a guess. The SS58 prefix, the token's decimals and
// symbol come from chain-facts.json. Whether the form can reach the faucet is
// found out by trying (the /health read failing), never by a flag: until the
// faucet answers with cross-origin headers, the warning callout says so.
import { callout, codeBlock, escapeHtml, EXPLORER_ORIGIN, icon, page } from './chrome/templates.mjs';

export const FAUCET_ORIGIN = 'https://faucet.scalarnet.io';
export const HEALTH_URL = `${FAUCET_ORIGIN}/health`;
export const DRIP_URL = `${FAUCET_ORIGIN}/drip`;

export const TITLE = 'Faucet';
export const DESCRIPTION = 'Get test CMN for an address on the Scalar Commons public testnet. Tokens have no value.';
/**
 * The page's one sentence, as three parts around the amount the browser reads.
 * The faucet's per-address limit is one drip an hour; its per-IP limit is a
 * separate, larger budget (faucet/src/config.ts), so the sentence says there
 * is one without stating a count it cannot read.
 */
export const LEAD_BEFORE = 'Get ';
export const LEAD_AFTER = 'test CMN for an address on the public testnet. One request per address every hour, with a separate limit per IP address. Tokens have no value.';
/** The wait after a drip, in the same words as the sentence's limit. */
export const ADDRESS_WAIT = 'an hour';
export const LABEL = 'Your address (SS58)';
export const SUBMIT = 'Request test CMN';
export const UNAVAILABLE = 'The faucet is temporarily unavailable from this page; use the API below.';
export const NO_SCRIPT = 'The form needs JavaScript. Use the API below instead.';
export const API_SUMMARY = 'Use the API instead';

/**
 * The two commands, exactly as a terminal sends them. The drip body's field is
 * `address` (faucet/src/server.ts). The URL follows `POST` as in the docs'
 * guides, so no line of the command starts with indentation before a long
 * unbreakable token: wrapped on a phone, it never leaves a line of only spaces.
 */
export const CURL = {
  drip: `curl -s -X POST ${DRIP_URL} \\\n  -H 'content-type: application/json' \\\n  -d '{"address":"<your address>"}'`,
  balance: `curl -s ${FAUCET_ORIGIN}/balance/<your address>`,
};

export function renderFaucet({ facts, css, builtAt }) {
  const p = facts.provenance;
  const token = facts.token ?? {};
  const body = `<div class="sc-container">
  <div class="fc sc-reading" data-faucet data-health="${escapeHtml(HEALTH_URL)}" data-drip="${escapeHtml(DRIP_URL)}" data-explorer="${escapeHtml(EXPLORER_ORIGIN)}" data-prefix="${escapeHtml(p.ss58Format)}" data-decimals="${escapeHtml(token.decimals)}" data-symbol="${escapeHtml(token.symbol)}" data-wait="${escapeHtml(ADDRESS_WAIT)}">
    <div class="sc-page-head">
      <h1 class="sc-h1">${escapeHtml(TITLE)}</h1>
      <p class="sc-lead" data-intro>${escapeHtml(LEAD_BEFORE)}<span data-drip-amount></span>${escapeHtml(LEAD_AFTER)}</p>
    </div>
    <div class="fc-body">
      <noscript>${callout({ variant: 'info', body: escapeHtml(NO_SCRIPT) })}</noscript>
      <div data-unavailable hidden>${callout({ variant: 'warning', body: escapeHtml(UNAVAILABLE) })}</div>
      <form class="fc-form" data-faucet-form novalidate>
        <div class="sc-field">
          <label for="fc-address">${escapeHtml(LABEL)}</label>
          <div class="fc-row">
            <div class="fc-input">
              <input class="sc-input" id="fc-address" name="address" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="fc-address-error">
              <p class="sc-field-error" id="fc-address-error" data-field-error hidden></p>
            </div>
            <button class="sc-btn sc-btn-primary" type="submit">${escapeHtml(SUBMIT)}</button>
          </div>
        </div>
      </form>
      <div class="fc-result" data-result aria-live="polite" hidden></div>
      <details class="fc-api">
        <summary>${icon('chevron-right', { className: 'sc-icon-sm fc-closed' })}${icon('chevron-down', { className: 'sc-icon-sm fc-open' })}${escapeHtml(API_SUMMARY)}</summary>
        <div class="fc-api-body">
          <p class="sc-small">Request test CMN for an address:</p>
          ${codeBlock(CURL.drip, { label: 'Copy the request command' })}
          <p class="sc-small">Check an address’s balance:</p>
          ${codeBlock(CURL.balance, { label: 'Copy the balance command' })}
        </div>
      </details>
    </div>
  </div>
</div>`;
  return page({
    title: TITLE,
    description: DESCRIPTION,
    path: '/faucet',
    current: 'faucet',
    facts,
    builtAt,
    body,
    css,
    scripts: ['/faucet.js'],
    // Scripts off: the form cannot send JSON, so it is not offered; the noscript callout points at the API.
    extraHead: '\n<noscript><style>.fc-form { display: none; }</style></noscript>',
  });
}
