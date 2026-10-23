// Filling a Nightwatch Reading from a provenance record: the figure (only the
// digits that changed warm), the stub's state, and the receipt's fetched
// time, block and raw bytes. The observatory's readout targets its own older
// markup; this is the same contract on the chrome's `nw-reading`.

import { setFigure } from '../chrome/behaviour/index.js';
import { snapshotUrl } from '../observatory/readout.js';
import { formatInteger } from '../observatory/format.js';

const utc = (at) => {
  if (at === null || at === undefined) return null;
  const date = typeof at === 'number' ? new Date(at) : new Date(String(at));
  if (Number.isNaN(date.getTime())) return String(at);
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
};

/** The receipt lines under a reading, from the record. */
function receipt(target, record, { block = null, computed = null } = {}) {
  const fetched = target.querySelector('[data-fetched]');
  const when = utc(record?.at) ?? '—';
  const blockText = block === null || block === undefined ? '—' : `block ${formatInteger(block)}`;
  if (fetched) fetched.textContent = `fetched ${when} · ${blockText}`;
  const raw = target.querySelector('[data-raw]');
  const url = record ? snapshotUrl(record) : null;
  if (raw && url) {
    if (raw.tagName !== 'A') {
      const a = document.createElement('a');
      a.setAttribute('data-raw', '');
      a.textContent = 'raw ↗';
      a.target = '_blank';
      a.rel = 'noopener';
      raw.replaceWith(a);
      a.href = url;
    } else raw.href = url;
  }
  const line = target.querySelector('[data-receipt-line]');
  if (line && record?.label) line.textContent = `${record.label} · ${when}${block === null || block === undefined ? '' : ` · block ${formatInteger(block)}`}`;
  const computedEl = target.querySelector('[data-computed]');
  if (computedEl && computed) computedEl.textContent = computed;
}

/** Shows a value: the figure warms where it changed, the stub goes live, the receipt is the record's. */
export function showValue(target, record, { value, block = null, computed = null, reduced = false, state = 'live' }) {
  if (!target) return;
  const slot = target.querySelector('[data-reading-value]');
  if (!slot) return;
  target.classList.remove('is-loading', 'is-unavailable');
  setFigure(slot, typeof value === 'number' ? formatInteger(value) : String(value), { reduced });
  target.querySelector('.nw-stub')?.setAttribute('data-state', state);
  receipt(target, record, { block, computed });
}

/** Shows that a figure cannot be had: the slot says so in sage, the stub goes sage, the reason is in the receipt. */
export function showUnavailable(target, record, reason) {
  if (!target) return;
  const slot = target.querySelector('[data-reading-value]');
  if (!slot) return;
  target.classList.remove('is-loading');
  target.classList.add('is-unavailable');
  slot.removeAttribute('data-text');
  slot.textContent = 'unavailable';
  target.querySelector('.nw-stub')?.setAttribute('data-state', 'record');
  receipt(target, record, { computed: reason });
}
