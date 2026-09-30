// The status bar: one slim line at the very top of the page with a live dot,
// a word for the network's state, how many of the validators have been seen
// sealing, the finality lag and the block height counting up. It draws
// nothing of its own: every figure here is the hero's, carried on the page
// bus with the record it came from, and the validator count is the same
// `Session.Validators` read the ring makes (the scheduler fetches it once).
// The line under the figures is the record's endpoint and time, as under
// every other reading.
//
// The state word is derived, and the rules are stated here so they can be
// checked: "Connecting" until a block has arrived; "Not updating" when the
// last read failed; "Polling" when the live stream could not be opened and
// the index is polled instead; "Paused" while the tab is hidden; "Finality
// lagging" when more than FINALITY_LAG_ALERT blocks wait for finality;
// "Blocks late" when the last block came more than LATE_MS after the one
// before; otherwise "Network normal". The validators phrase counts distinct
// block authors in the last SEALING_WINDOW blocks seen: until that many have
// been seen it says so ("seen sealing so far"), since a validator that has
// not had a turn yet is not a validator that is missing.

import { decodeValidators } from './scale.js';

export const FINALITY_LAG_ALERT = 6; // blocks
export const LATE_MS = 18_000; // three slots without a block
export const SEALING_WINDOW = 30; // blocks; with primary slots random, ten would miss a validator by chance
const VALIDATORS_INTERVAL_MS = 60_000;

/** The state word for the bar, from what the hero has reported. Pure; tested. */
export function stateWord({ socket, lastOk, seen, lag, intervalMs, hidden }) {
  if (hidden) return 'Paused';
  if (!seen) return 'Connecting';
  if (lastOk === false) return 'Not updating';
  if (Number.isFinite(lag) && lag > FINALITY_LAG_ALERT) return 'Finality lagging';
  if (Number.isFinite(intervalMs) && intervalMs > LATE_MS) return 'Blocks late';
  if (socket === 'polling') return 'Polling';
  return 'Network normal';
}

/** "5 of 5 validators sealing", or the honest partial while the window fills. Pure; tested. */
export function sealingPhrase({ authors, total, observed }) {
  if (!Number.isFinite(total) || total < 1) return 'validators not yet read';
  if (authors === null) return `${total} validator${total === 1 ? '' : 's'} in the set`;
  if (observed < SEALING_WINDOW && authors < total) return `${authors} of ${total} validators seen sealing so far`;
  return `${authors} of ${total} validators sealing`;
}

export function init(root, ctx) {
  if (!root) return;
  const dot = root.querySelector('.pulse-dot');
  const stateEl = root.querySelector('.sb-state');
  const sealingEl = root.querySelector('.sb-validators');
  const finalityEl = root.querySelector('.sb-finality');
  const { formatInteger } = ctx.format;

  let socket = 'live';
  let lastOk = null;
  let seen = false;
  let lag = null;
  let lastArrival = null;
  let intervalMs = null;
  let hidden = false;
  let total = null; // validators in the active set
  const authors = []; // authority index per head, newest last, SEALING_WINDOW at most
  let polled = 0; // heads with no author (polling), counted so the phrase stays honest

  function render() {
    const word = stateWord({ socket, lastOk, seen, lag, intervalMs, hidden });
    root.dataset.state = word.toLowerCase().replace(/\s+/g, '-');
    if (stateEl) stateEl.textContent = word;
    if (sealingEl) {
      const distinct = polled > 0 || authors.length === 0 ? null : new Set(authors).size;
      sealingEl.textContent = sealingPhrase({ authors: distinct, total, observed: authors.length });
    }
    if (finalityEl) {
      finalityEl.textContent = lag === null ? 'finality —' : `finality ${formatInteger(lag)} block${lag === 1 ? '' : 's'}`;
    }
  }

  function beat() {
    if (!dot || ctx.motion.reduced()) return;
    dot.classList.remove('beat');
    void dot.offsetWidth;
    dot.classList.add('beat');
  }

  ctx.bus.on('head', ({ record, number, author, arrivedAt }) => {
    lastOk = Boolean(record?.ok);
    if (!record?.ok) {
      ctx.readout.showError(root, record);
      render();
      return;
    }
    seen = true;
    if (Number.isFinite(number)) {
      ctx.readout.showValue(root, record, { value: number, motion: ctx.motion });
      beat();
    }
    if (Number.isFinite(arrivedAt)) {
      if (lastArrival !== null) intervalMs = arrivedAt - lastArrival;
      lastArrival = arrivedAt;
    }
    if (author && Number.isInteger(author.authorityIndex)) {
      authors.push(author.authorityIndex);
      if (authors.length > SEALING_WINDOW) authors.shift();
      polled = 0;
    } else if (author === null) {
      polled += 1;
    }
    render();
  });

  ctx.bus.on('finalized', ({ number }) => {
    if (!Number.isFinite(number)) return;
    const best = Number(root.querySelector('.reading-value')?.dataset.number);
    lag = Number.isFinite(best) ? Math.max(0, best - number) : null;
    render();
  });

  ctx.bus.on('socket', ({ state, attempts }) => {
    if (state === 'open') socket = 'live';
    else if (state === 'failed' || (state === 'closed' && attempts >= 1)) socket = 'polling';
    render();
  });

  ctx.bus.on('visibility', (v) => {
    hidden = v.hidden;
    render();
  });

  ctx.watch(
    'validators',
    (record) => {
      if (!record.ok) {
        total = null;
        render();
        return;
      }
      try {
        total = decodeValidators(ctx.field(record.data, 'result')).length;
      } catch {
        total = null;
      }
      render();
    },
    VALIDATORS_INTERVAL_MS,
  );

  render();
}
