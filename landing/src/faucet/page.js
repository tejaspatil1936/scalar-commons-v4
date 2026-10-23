// The faucet form's behaviour, against the markup src/faucet.mjs renders. Pure
// DOM: `init(root, { fetch })` takes the network as a parameter so the test
// can play every answer the faucet gives. Three things happen here, nothing
// else: the intro's amount is read from GET /health; a submitted address is
// decoded (SS58, the chain's prefix) before anything is sent; and the answer
// to POST /drip becomes one callout — sent, refused, or, when the browser
// could not reach the faucet at all, "temporarily unavailable from this page".
import { truncateMiddle } from '../chrome/templates.mjs';
import { decodeSs58 } from './address.js';
import { formatCmn, formatDuration } from './format.js';

/** The API's message as a sentence: a capital, a full stop. */
const sentence = (text) => {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const cased = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cased) ? cased : `${cased}.`;
};

export function init(root, { fetch = globalThis.fetch.bind(globalThis) } = {}) {
  const $ = (sel) => root.querySelector(sel);
  const doc = root.ownerDocument;
  const amountEl = $('[data-amount]');
  const form = $('[data-drip-form]');
  const input = form.querySelector('input[name="address"]');
  const fieldError = form.querySelector('[data-field-error]');
  const submit = form.querySelector('button[type="submit"]');
  const notice = $('[data-notice]');
  const result = $('[data-result]');
  const token = { decimals: Number(root.dataset.decimals), symbol: root.dataset.symbol };

  const clone = (name) => $(`template[data-tpl="${name}"]`).content.firstElementChild.cloneNode(true);
  const el = (tag, props = {}, children = []) => {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) if (v !== null && v !== undefined) node.setAttribute(k, v);
    for (const child of children) node.append(child);
    return node;
  };
  /** A hash or address the chrome's way: mono, truncated, the full value in a title, never broken across lines. */
  const mono = (value, { href = null } = {}) =>
    el('span', { class: 'sc-addr' }, [el(href ? 'a' : 'span', { title: value, href }, [truncateMiddle(value)])]);
  const copy = (value) => {
    const btn = clone('copy');
    btn.setAttribute('data-copy', value);
    btn.setAttribute('aria-label', `Copy ${value}`);
    return btn;
  };
  const cmn = (plancks) => {
    const { text, full, truncated } = formatCmn(plancks, token.decimals);
    return el('span', { title: truncated ? `${full} ${token.symbol}` : null }, [`${text} ${token.symbol}`]);
  };

  // ── the three places a message can go ─────────────────────────────────────
  const show = (slot, node) => {
    slot.replaceChildren(node);
    slot.hidden = false;
  };
  const clear = (slot) => {
    slot.replaceChildren();
    slot.hidden = true;
  };
  const unavailable = () => {
    if (!notice.firstElementChild) show(notice, clone('unavailable'));
  };
  const callout = (name, paragraphs) => {
    const node = clone(name);
    const body = node.querySelector('.sc-callout-body');
    body.replaceChildren(...paragraphs.map((kids) => el('p', {}, kids)));
    return node;
  };
  const refuse = (text) => {
    input.setAttribute('aria-invalid', 'true');
    fieldError.textContent = text;
    fieldError.hidden = false;
  };
  const accept = () => {
    input.removeAttribute('aria-invalid');
    fieldError.textContent = '';
    fieldError.hidden = true;
  };

  // ── the amount, from GET /health; the sentence loses it when the faucet cannot be read ──
  const ready = (async () => {
    try {
      const response = await fetch(root.dataset.health, { mode: 'cors', cache: 'no-cache' });
      const h = response.ok ? await response.json() : null;
      if (h?.dripAmountPlancks === undefined) {
        amountEl?.remove();
        return;
      }
      if (Number.isInteger(h.tokenDecimals)) token.decimals = h.tokenDecimals;
      if (h.tokenSymbol) token.symbol = h.tokenSymbol;
      const { text, full, truncated } = formatCmn(h.dripAmountPlancks, token.decimals);
      amountEl.textContent = text;
      if (truncated) amountEl.title = `${full} ${token.symbol}`;
      else amountEl.removeAttribute('title');
    } catch {
      // A TypeError: no answer the browser may read (no CORS permission yet, or no network).
      amountEl?.remove();
      unavailable();
    }
  })();

  // ── one request ────────────────────────────────────────────────────────────
  input.addEventListener('input', accept);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clear(result);
    const address = input.value.trim();
    if (!address) {
      refuse(root.dataset.empty);
      return;
    }
    if (!decodeSs58(address, { prefix: Number(root.dataset.prefix) }).ok) {
      refuse(root.dataset.refusal);
      return;
    }
    accept();
    submit.disabled = true;
    try {
      const response = await fetch(root.dataset.drip, {
        method: 'POST',
        mode: 'cors',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const body = await response.json().catch(() => ({}));
      clear(notice);
      if (response.ok && body.ok) {
        const explorer = root.dataset.explorer;
        const to = body.address ?? address;
        show(
          result,
          callout('success', [
            ['Sent ', cmn(body.amountPlancks), ' to ', mono(to, { href: `${explorer}/account/${to}` }), '.'],
            ['Extrinsic ', mono(body.txHash), ' ', copy(body.txHash), ' in block ', mono(body.blockHash, { href: `${explorer}/block/${body.blockHash}` }), '.'],
          ]),
        );
        return;
      }
      const lines = [[sentence(body.error) || `The faucet answered HTTP ${response.status}.`]];
      const retryMs = Number(body.retryAfterMs) || Number(response.headers?.get?.('retry-after') ?? 0) * 1000;
      if (response.status === 429 && retryMs > 0) {
        const who = body.scope === 'ip' ? 'from this IP address' : 'for this address';
        lines.push([`Next request ${who}: ${formatDuration(retryMs)} from now.`]);
      }
      show(result, callout('error', lines));
    } catch {
      // The request never got an answer the browser may read: say so above the form, once.
      clear(result);
      unavailable();
    } finally {
      submit.disabled = false;
    }
  });

  return { ready };
}
