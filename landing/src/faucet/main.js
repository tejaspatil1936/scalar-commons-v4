// The faucet page's one script. On load it reads the faucet's `GET /health`:
// the drip amount fills the sentence, or — if the read fails (today: the
// faucet's answers carry no cross-origin permission) — the sentence stays
// without a figure and the warning callout appears. The form checks the
// address as SS58 under the field, then sends `POST /drip` and shows the
// faucet's answer: a success callout with the amount, the extrinsic hash
// linked to the explorer and when the address can ask again, or the faucet's
// own message in an error callout.
import { initChrome } from '../chrome/behaviour/index.js';
import { callout, escapeHtml, skeleton, truncateMiddle } from '../chrome/templates.mjs';
import { addressError } from './address.js';
import { formatPlancks, formatWait, sentence } from './format.js';

const root = document.querySelector('[data-faucet]');
const BLOCK_HASH = /^0x[0-9a-f]{64}$/i;
const STATUS_WORDS = { 400: 'bad request', 404: 'not found', 429: 'too many requests', 500: 'internal error', 502: 'bad gateway', 503: 'service unavailable', 504: 'gateway timeout' };

if (root) {
  const $ = (selector) => root.querySelector(selector);
  const form = $('[data-faucet-form]');
  const input = form.querySelector('input[name="address"]');
  const submit = form.querySelector('button[type="submit"]');
  const fieldError = $('[data-field-error]');
  const result = $('[data-result]');
  const unavailable = $('[data-unavailable]');
  const amountSlot = $('[data-drip-amount]');
  const prefix = Number(root.dataset.prefix);
  const faucetHost = new URL(root.dataset.drip).host;
  // From chain-facts.json; replaced by the faucet's own figures when /health answers.
  let decimals = Number(root.dataset.decimals);
  let symbol = root.dataset.symbol;

  const setUnavailable = (on) => {
    unavailable.hidden = !on;
  };
  const showResult = (html) => {
    result.innerHTML = html ?? '';
    result.hidden = !html;
  };
  const showFieldError = (text) => {
    fieldError.textContent = text;
    fieldError.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  };
  const clearFieldError = () => {
    fieldError.textContent = '';
    fieldError.hidden = true;
    input.removeAttribute('aria-invalid');
  };
  /** Checks the field; true when the address is one this chain accepts. */
  const check = () => {
    const error = addressError(input.value, prefix);
    if (error) showFieldError(error);
    else clearFieldError();
    return !error;
  };

  async function readHealth() {
    amountSlot.innerHTML = `${skeleton('4ch')} `;
    try {
      const response = await fetch(root.dataset.health, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = await response.json();
      if (Number.isInteger(health.tokenDecimals)) decimals = health.tokenDecimals;
      if (health.tokenSymbol) symbol = health.tokenSymbol;
      // A figure only when the faucet states one; otherwise the sentence reads without it.
      amountSlot.textContent = /^\d+$/.test(String(health.dripAmountPlancks ?? '')) ? `${formatPlancks(health.dripAmountPlancks, decimals)} ` : '';
      setUnavailable(false);
    } catch {
      amountSlot.textContent = '';
      setUnavailable(true);
    }
  }

  function success(body, address) {
    const amount = /^\d+$/.test(String(body.amountPlancks ?? '')) ? `${formatPlancks(body.amountPlancks, decimals)} ${symbol}` : `test ${symbol}`;
    const hash = String(body.txHash ?? '');
    const block = String(body.blockHash ?? '');
    const hashHtml = BLOCK_HASH.test(hash)
      ? BLOCK_HASH.test(block)
        ? `<a class="sc-mono" href="${escapeHtml(`${root.dataset.explorer}/block/${block}`)}" title="${escapeHtml(hash)}">${escapeHtml(truncateMiddle(hash))}</a> (opens its block in the explorer)`
        : `<span class="sc-mono" title="${escapeHtml(hash)}">${escapeHtml(truncateMiddle(hash))}</span>`
      : null;
    // The address as the faucet confirmed it (or as sent), linked to its account page in the explorer.
    const to = String(body.address ?? address);
    const toHtml = `<a class="sc-mono" href="${escapeHtml(`${root.dataset.explorer}/account/${to}`)}" title="${escapeHtml(to)}">${escapeHtml(truncateMiddle(to, 5, 6))}</a>`;
    const lines = [
      `<strong>Sent ${escapeHtml(amount)} to ${toHtml}.</strong>`,
      hashHtml ? `<span>Extrinsic ${hashHtml}</span>` : null,
      `<span>Next request for this address: ${escapeHtml(root.dataset.wait)} from now.</span>`,
    ].filter(Boolean);
    showResult(callout({ variant: 'ok', body: lines.join('') }));
  }

  function failure(response, body) {
    const message = body?.error
      ? sentence(body.error)
      : `The faucet answered HTTP ${response.status}${STATUS_WORDS[response.status] ? ` (${STATUS_WORDS[response.status]})` : ''} with no message.`;
    const lines = [`<span>${escapeHtml(message)}</span>`];
    if (body?.code === 'RATE_LIMITED' && Number.isFinite(Number(body.retryAfterMs))) {
      const who = body.scope === 'ip' ? 'IP address' : 'address';
      lines.push(`<span>Next request for this ${who}: ${escapeHtml(formatWait(body.retryAfterMs))} from now.</span>`);
    }
    showResult(callout({ variant: 'error', body: lines.join('') }));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!check()) {
      input.focus();
      return;
    }
    const address = input.value.trim();
    showResult(null);
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    try {
      let response;
      try {
        response = await fetch(root.dataset.drip, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) });
      } catch {
        setUnavailable(true);
        showResult(callout({ variant: 'error', body: `<span>${escapeHtml(`The request did not reach the faucet: this page could not read ${faucetHost}. Use the API below.`)}</span>` }));
        return;
      }
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok) {
        setUnavailable(false);
        success(body, address);
      } else {
        failure(response, body);
      }
    } finally {
      submit.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
  // Checked when the visitor leaves the field, and again as they correct it.
  input.addEventListener('blur', () => {
    if (input.value.trim()) check();
  });
  input.addEventListener('input', () => {
    if (!fieldError.hidden) check();
  });

  initChrome();
  readHealth();
}
