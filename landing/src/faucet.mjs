// Renders /faucet (brief §5.6): one receipt-shaped form, static. Nothing on
// the page is typed as a figure: the amount, the interval, the faucet's
// address and balance all arrive from `GET faucet.scalarnet.io/health` in the
// reader's browser (src/faucet/main.js). The frame below is the CLOSED state —
// what a browser on scalarnet.io sees today, because the faucet's answers carry
// no cross-origin permission — and the script opens the form only after a
// successful read of /health, so the page never promises a form it cannot work.
import { DISCLAIMER, button, code, escapeHtml, field, footer, head, leader, reading, tag, topBar, utc, utcDay } from './chrome/templates.mjs';

export const FAUCET_ORIGIN = 'https://faucet.scalarnet.io';
export const HEALTH_URL = `${FAUCET_ORIGIN}/health`;
export const DRIP_URL = `${FAUCET_ORIGIN}/drip`;
export const BALANCE_URL = `${FAUCET_ORIGIN}/balance/<address>`;

export const TITLE = 'Faucet';
export const EYEBROW = 'TESTNET FAUCET · OPERATOR-RUN';
export const LINE = 'Paste an address. The faucet signs a transfer from its own account and shows you the extrinsic. Nothing here has value.';
/** The one sentence on why the form is closed: the cross-origin block, nothing more. */
export const WHY = 'This page cannot read faucet.scalarnet.io from this origin: the faucet’s answers carry no cross-origin permission, so the browser withholds them and the same requests are given here as commands.';
export const NOT_READABLE = 'not readable from this origin';

/** The three commands, exactly as a terminal would send them. The drip body's field is `address` (faucet/src/server.ts). */
export const CURL = {
  health: `curl -s ${HEALTH_URL}`,
  drip: `curl -s -X POST -H 'content-type: application/json' -d '{"address":"<your SS58 address>"}' ${DRIP_URL}`,
  balance: `curl -s ${BALANCE_URL}`,
};

/** The refusal, composed from the chain's SS58 prefix in chain-facts.json. */
export const refusal = (prefix) => `That is not an SS58 address for this chain (prefix ${prefix}).`;

const source = (method, url) => ({ method, url, fetchedAt: null, block: null, raw: url, computed: NOT_READABLE });

export function renderFaucet({ facts, css }) {
  const p = facts.provenance;
  const health = source('GET', HEALTH_URL);
  const drip = source('POST', DRIP_URL);
  const slot = (key, label) => reading({ key, label, figure: null, live: true, size: 'l', state: 'connecting', source: health, className: 'fc-title-slot' });
  const live = (key, label, src = health, size = 'm') => reading({ key, label, figure: null, live: true, size, state: 'connecting', source: src });
  // The chrome's field() has no `disabled` (see src/chrome/requests/phase7.css); the attribute is added here.
  const addressField = field({ name: 'address', label: 'Address', placeholder: '' }).replace('<input class="nw-field"', '<input class="nw-field" disabled aria-describedby="fc-why"');
  const send = button({ text: 'Send', type: 'submit', className: 'fc-send', disabled: true }).replace('<button class="nw-button fc-send"', '<button class="nw-button fc-send" aria-describedby="fc-why"');

  return `<!doctype html>
<html lang="en">
<head>
${head({
  title: `${TITLE} — Scalar Commons`,
  description: 'The Scalar Commons testnet faucet: one transfer from the operator’s account to an address you paste, with the extrinsic shown. The token has no value.',
  css,
  scripts: ['faucet.js'],
  // Scripts off: nothing can be read, so no slot may keep its loading leader running (the loop is for loading only).
  extraHead: '<noscript><style>.nw-reading.is-loading .nw-leader::before { display: none; }</style></noscript>\n',
})}
</head>
<body>
${topBar({ current: 'faucet', lampHtml: tag({ state: 'built', text: 'AS BUILT', detail: utcDay(facts.provenance.fetchedAt) }) })}
<main class="nw-frame fc" aria-labelledby="faucet-h" data-faucet data-health="${escapeHtml(HEALTH_URL)}" data-drip="${escapeHtml(DRIP_URL)}" data-balance="${escapeHtml(`${FAUCET_ORIGIN}/balance/`)}" data-prefix="${escapeHtml(p.ss58Format)}" data-refusal="${escapeHtml(refusal(p.ss58Format))}" data-state="closed">
  <section class="nw-section fc-head">
    <span class="nw-eyebrow">${tag({ state: 'operator', text: EYEBROW })}</span>
    <div class="fc-title" role="heading" aria-level="1" id="faucet-h">
      ${slot('title-amount', 'Amount')}
      <span class="fc-title-word" data-title-word>test CMN<span data-title-comma>,</span></span>
      ${slot('title-interval', 'Interval')}
    </div>
    <p class="nw-body fc-line">${escapeHtml(LINE)}</p>
  </section>
  <section class="nw-section fc-form">
    <div class="fc-form-main">
      <p class="nw-body nw-dim" id="fc-why" data-why>${escapeHtml(WHY)}</p>
      <div class="fc-curl" data-closed>
        ${code({ text: CURL.health, lang: 'sh' })}
        ${code({ text: CURL.drip, lang: 'sh' })}
        ${code({ text: CURL.balance, lang: 'sh' })}
      </div>
      <form class="fc-fields" data-drip-form novalidate>
        ${addressField}
        ${send}
      </form>
      <div class="fc-sent" data-sent hidden></div>
    </div>
    <div class="fc-readings">
      ${live('amount', 'Amount')}
      ${live('next-drip', 'Next drip for this address', drip, 'body')}
    </div>
  </section>
  <section class="nw-section fc-account">
    <span class="nw-label nw-eyebrow">Faucet account</span>
    ${live('faucet-address', 'Address', health, 'body')}
    ${live('faucet-balance', 'Balance')}
  </section>
  <section class="nw-section fc-recent">
    <div class="nw-reading is-unavailable"><div class="nw-reading-line"><span class="nw-label">Recent drips</span>${leader()}</div><span class="nw-receipt-line" data-receipt-line>from the index · not read</span></div>
  </section>
</main>
${footer({ facts: { genesisHash: p.genesisHash, specVersion: p.specVersion, nodeVersion: p.nodeVersion ?? null, builtAt: p.fetchedAt, block: p.readAtBlock } })}
</body>
</html>
`;
}

export { DISCLAIMER };
