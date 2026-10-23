// Boot for /faucet. The frame arrives CLOSED (the curl commands, the field and
// the button disabled with the reason). This script tries the one read the
// page depends on, `GET faucet.scalarnet.io/health`; if the browser can read
// it, the form opens and every Reading is filled from the answer; if it cannot
// (today: no cross-origin permission on the faucet host), the Readings settle
// as leaders to nothing with their receipts, and nothing else changes.
import { initChrome, setFigure } from '../chrome/behaviour/index.js';
import { decodeSs58 } from './address.js';
import { formatInterval, formatPlancks } from './format.js';

const root = document.querySelector('[data-faucet]');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const utcNow = () => new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
const readingEl = (key) => root.querySelector(`[data-reading="${key}"]`);

/** Fill a Reading with a figure read just now; the stub goes `state` (live by default). */
function fill(key, text, { state = 'live', note = null } = {}) {
  const el = readingEl(key);
  if (!el) return;
  el.classList.remove('is-loading', 'is-unavailable');
  const value = el.querySelector('[data-reading-value]');
  if (value) setFigure(value, text, { reduced });
  el.querySelector('.nw-stub')?.setAttribute('data-state', state);
  const fetched = el.querySelector('[data-fetched]');
  if (fetched) fetched.textContent = `fetched ${utcNow()} · block —`;
  const line = el.querySelector('[data-receipt-line]');
  if (line) line.textContent = `${el.querySelector('[data-request]')?.textContent ?? ''} · ${utcNow()}`;
  const computed = el.querySelector('[data-computed]');
  if (computed) computed.textContent = note ?? '';
}

/** A Reading that could not be read: the leader runs to nothing and the receipt says why. */
function unavailable(key, why) {
  const el = readingEl(key);
  if (!el) return;
  el.classList.remove('is-loading');
  el.classList.add('is-unavailable');
  el.querySelector('.nw-stub')?.setAttribute('data-state', 'record');
  const fetched = el.querySelector('[data-fetched]');
  if (fetched) fetched.textContent = why;
}

const KEYS = ['title-amount', 'title-interval', 'amount', 'next-drip', 'faucet-address', 'faucet-balance'];

function closed() {
  root.dataset.state = 'closed';
  for (const key of KEYS) unavailable(key, 'not readable from this origin');
}

/** The interval, only if /health exposes a limit; otherwise the title drops the clause. */
const intervalMs = (h) => h.dripIntervalMs ?? h.rateLimit?.perAddressMs ?? h.perAddressMs ?? null;

function open(h) {
  root.dataset.state = 'open';
  const symbol = h.tokenSymbol ?? '';
  const decimals = h.tokenDecimals ?? 12;
  const amount = `${formatPlancks(h.dripAmountPlancks, decimals)} ${symbol}`;
  fill('title-amount', amount);
  fill('amount', amount);
  const ms = intervalMs(h);
  if (ms) fill('title-interval', formatInterval(ms));
  else {
    readingEl('title-interval')?.setAttribute('hidden', '');
    root.querySelector('[data-title-comma]')?.setAttribute('hidden', '');
  }
  if (h.faucetAddress) fill('faucet-address', h.faucetAddress);
  if (h.faucetFreePlancks !== undefined) fill('faucet-balance', `${formatPlancks(h.faucetFreePlancks, decimals)} ${symbol}`);
  unavailable('next-drip', '—');
  for (const el of root.querySelectorAll('[data-drip-form] [disabled]')) el.removeAttribute('disabled');
  root.querySelector('[data-drip-form]')?.addEventListener('submit', (event) => submit(event, h));
}

function showError(text) {
  const input = root.querySelector('input[name="address"]');
  const error = root.querySelector('[data-field-error]');
  input?.setAttribute('aria-invalid', 'true');
  if (error) {
    error.textContent = text;
    error.hidden = false;
  }
}
function clearError() {
  const input = root.querySelector('input[name="address"]');
  const error = root.querySelector('[data-field-error]');
  input?.removeAttribute('aria-invalid');
  if (error) {
    error.textContent = '';
    error.hidden = true;
  }
}

/** The receipt for a sent drip: the extrinsic hash, where it went, and the explorer's activity page for that address. */
function sent(result, address) {
  const box = root.querySelector('[data-sent]');
  if (!box) return;
  box.hidden = false;
  box.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'nw-reading is-torn';
  const line = document.createElement('div');
  line.className = 'nw-reading-line';
  const label = document.createElement('span');
  label.className = 'nw-label';
  label.textContent = 'Sent';
  const leader = document.createElement('span');
  leader.className = 'nw-leader';
  const figure = document.createElement('span');
  figure.className = 'nw-reading-figure';
  const link = document.createElement('a');
  link.className = 'nw-figure nw-figure--body nw-mono';
  link.href = `https://explorer.scalarnet.io/activity?agent=${encodeURIComponent(address)}`;
  link.textContent = result.txHash ?? '';
  const stub = document.createElement('span');
  stub.className = 'nw-stub';
  stub.dataset.state = 'live';
  figure.append(link, stub);
  line.append(label, leader, figure);
  const receipt = document.createElement('div');
  receipt.className = 'nw-receipt';
  for (const text of [`POST ${root.dataset.drip.replace(/^https?:\/\//, '')}`, `fetched ${utcNow()} · block ${result.blockHash ?? '—'}`, `extrinsic ${result.txHash ?? '—'}`]) {
    const row = document.createElement('div');
    row.textContent = text;
    receipt.append(row);
  }
  wrap.append(line, receipt);
  box.append(wrap);
}

async function submit(event, h) {
  event.preventDefault();
  const input = root.querySelector('input[name="address"]');
  const button = root.querySelector('.fc-send');
  const address = (input?.value ?? '').trim();
  const check = decodeSs58(address, { prefix: Number(root.dataset.prefix) });
  if (!check.ok) {
    showError(root.dataset.refusal);
    return;
  }
  clearError();
  button.classList.add('is-loading');
  button.disabled = true;
  try {
    const response = await fetch(root.dataset.drip, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.ok) {
      sent(body, address);
      unavailable('next-drip', `after ${utcNow()}`);
      // The faucet's balance moved: read it again from the same place.
      const again = await fetch(root.dataset.health).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (again?.faucetFreePlancks !== undefined) fill('faucet-balance', `${formatPlancks(again.faucetFreePlancks, again.tokenDecimals ?? h.tokenDecimals ?? 12)} ${again.tokenSymbol ?? h.tokenSymbol ?? ''}`);
    } else if (body.code === 'RATE_LIMITED' || response.status === 429) {
      const seconds = Number(response.headers.get('retry-after')) || (body.retryAfterMs ? Math.ceil(body.retryAfterMs / 1000) : null);
      if (seconds) fill('next-drip', formatInterval(seconds * 1000).replace(/^once every /, 'in '), { state: 'record' });
      showError(body.error ?? 'rate limited');
    } else {
      showError(body.error ?? `HTTP ${response.status}`);
    }
  } catch (error) {
    showError(error.message);
  } finally {
    button.classList.remove('is-loading');
    button.disabled = false;
  }
}

async function boot() {
  initChrome();
  if (!root) return;
  try {
    const response = await fetch(root.dataset.health, { mode: 'cors', cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    open(await response.json());
  } catch {
    closed();
  }
}

boot();
