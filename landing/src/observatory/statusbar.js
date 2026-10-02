// The status bar: one slim line at the very top of the page with a live dot,
// a word for the network's state, how many of the validators have been seen
// sealing, the finality lag and the block height counting up. It draws
// nothing of its own: every figure here is the hero's, carried on the page
// bus with the record it came from, and the validator count is the same
// `Session.Validators` read the ring makes (the scheduler fetches it once).
// The line under the figures is the record's endpoint and time, as under
// every other reading. A live header arrives as `head`; a height from the
// polling fallback or the first indexed position arrives as `poll`, with no
// header and no author, and is folded in the same way.
//
// The state word is derived, and the rules are stated here so they can be
// checked: "Connecting" until a block has arrived; "Not updating" when the
// last read failed; "Polling" when the live stream could not be opened and
// the index is polled instead; "Paused" while the tab is hidden; "Finality
// lagging" when more than FINALITY_LAG_ALERT blocks wait for finality;
// "Blocks late" when the last block came more than LATE_MS after the one
// before; otherwise "Network normal". On load, before the real state word,
// the bar shows the connection as a sequence — "connecting", then
// "connecting · subscribed" once the socket is open, then "connecting ·
// subscribed · block N" once the first head is in — each step held for
// BOOT_STEP_MS and the whole for BOOT_MS, driven by the page's one tween, so
// a reader sees the page connect rather than a figure appear from nowhere.
// A failure ends the sequence at once (the fault is said, not the ceremony),
// and under prefers-reduced-motion there is no sequence at all. The validators phrase states the size
// of the active set from the chain read ("5 validators in the active set"),
// and only once the page has been open for SEALING_GRACE_MS adds how many
// distinct validators have been seen sealing since it opened. On load it
// says nothing about who has sealed: "2 of 5 seen so far" read as three
// validators down, when it only meant the page had seen two blocks.

import { decodeValidators } from './scale.js';

export const FINALITY_LAG_ALERT = 6; // blocks
export const LATE_MS = 18_000; // three slots without a block
/** The count of validators seen sealing is shown only after the page has been open this long. */
export const SEALING_GRACE_MS = 60_000;
/** A height this far below the best is a new chain (a test-network reset), not a reorg: the bar starts over. */
export const RESET_DEPTH = 1_000; // blocks
// How often to re-evaluate the state word with no event to prompt it. A third
// of LATE_MS, so a stall is reported within a slot of crossing the threshold.
export const STALL_CHECK_MS = 6_000;
/** The connection sequence: three steps of BOOT_STEP_MS, BOOT_MS in all. */
export const BOOT_MS = 1_500;
export const BOOT_STEP_MS = 500;
const VALIDATORS_INTERVAL_MS = 60_000;

/** The state word for the bar, from what the hero has reported. Pure; tested. */
export function stateWord({ socket, lastOk, seen, lag, intervalMs, hidden }) {
  if (hidden) return 'Paused';
  if (lastOk === false) return 'Not updating'; // a failed first read is an outage, not "Connecting"
  if (!seen) return 'Connecting';
  if (Number.isFinite(lag) && lag > FINALITY_LAG_ALERT) return 'Finality lagging';
  if (Number.isFinite(intervalMs) && intervalMs > LATE_MS) return 'Blocks late';
  if (socket === 'polling') return 'Polling';
  return 'Network normal';
}

/**
 * "5 validators in the active set", and after SEALING_GRACE_MS of the page
 * being open, "· 3 seen sealing since you opened this page". `seen` is the
 * number of distinct validators seen sealing since the page opened, or null
 * when none has been seen with an author (polled heights carry none).
 * `error` names why the set could not be read or decoded, and the phrase says
 * so: a set that was read and could not be decoded is not a set "not yet
 * read". Pure; tested.
 */
export function sealingPhrase({ seen = null, total, sinceMs = 0, error = null }) {
  if (error) return `validators unavailable · ${error}`;
  if (!Number.isFinite(total) || total < 1) return 'validators not yet read';
  const set = `${total} validator${total === 1 ? '' : 's'} in the active set`;
  if (seen === null || !Number.isFinite(sinceMs) || sinceMs < SEALING_GRACE_MS) return set;
  // Clamped to the set size: for a while after the set shrinks, validators
  // that have since left were still seen sealing, and "6 of 5" reads as a
  // bug in the page whatever the chain is doing.
  return `${set} · ${Math.min(seen, total)} seen sealing since you opened this page`;
}

/**
 * The sequence's phrase `sinceMs` into the page: a step is said only once its
 * moment has come AND the thing it names has happened, so a fast socket is
 * still shown connecting for its half second and a slow one is never claimed.
 * Pure; tested.
 */
export function bootPhrase({ sinceMs, subscribed, block, formatInteger = String }) {
  const parts = ['connecting'];
  if (sinceMs >= BOOT_STEP_MS && subscribed) parts.push('subscribed');
  if (sinceMs >= 2 * BOOT_STEP_MS && subscribed && Number.isFinite(block)) parts.push(`block ${formatInteger(block)}`);
  return parts.join(' · ');
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
  const sealed = new Set(); // authority indices seen sealing since the page opened
  const openedAt = ctx.now();
  let validatorsError = null; // why the set could not be read or decoded, when it could not
  // Held here rather than read back out of the DOM. Finality lag needs both
  // numbers, and either can arrive first.
  let bestNumber = null;
  let finalizedNumber = null;
  // The connection sequence. Without a tween to drive it (reduced motion, or
  // a host with no animation primitive) there is no sequence: the real state.
  const boot = { subscribed: false, block: null, blockAt: null, done: ctx.motion.reduced() || typeof ctx.motion.tween !== 'function' };

  /**
   * Blocks are only "arriving" when the HEIGHT moves.
   *
   * In polling mode `pulse.js` emits a head on every poll whether or not the
   * chain advanced, so timing arrivals rather than heights measured the poll
   * interval (~6 s) and "Blocks late" could never fire. Gating on the height
   * makes a stalled chain look stalled in both modes.
   */
  function noteArrival(number, arrivedAt) {
    if (!Number.isFinite(number)) return;
    if (bestNumber !== null && number < bestNumber - RESET_DEPTH) {
      // A test-network reset: the old heights say nothing about this chain.
      bestNumber = null;
      finalizedNumber = null;
      lastArrival = null;
      intervalMs = null;
      sealed.clear();
    }
    const advanced = bestNumber === null || number > bestNumber;
    if (!advanced) return;
    bestNumber = number;
    if (Number.isFinite(arrivedAt)) {
      if (lastArrival !== null) intervalMs = arrivedAt - lastArrival;
      lastArrival = arrivedAt;
    }
  }

  function recomputeLag() {
    lag = Number.isFinite(bestNumber) && Number.isFinite(finalizedNumber)
      ? Math.max(0, bestNumber - finalizedNumber)
      : null;
  }

  /**
   * The gap that matters is the one SINCE THE LAST BLOCK, not the last gap
   * between two blocks.
   *
   * `intervalMs` alone is a measurement of history: if blocks stop entirely,
   * no event fires, nothing re-renders, and the bar holds its last healthy
   * value — so it read "Network normal" for exactly as long as the chain was
   * dead. Comparing against the elapsed time since the last arrival makes a
   * stall grow into "Blocks late" on the ticker below, with no block needed to
   * report it.
   */
  function effectiveIntervalMs() {
    if (lastArrival === null) return intervalMs;
    const since = ctx.now() - lastArrival;
    return Math.max(Number.isFinite(intervalMs) ? intervalMs : 0, since);
  }

  /** Whether the connection sequence is over: it ends on a fault, or once the block has been shown for its step. */
  function bootDone() {
    if (boot.done) return true;
    if (lastOk === false || socket === 'polling') boot.done = true;
    else if (boot.blockAt !== null && ctx.now() - openedAt >= BOOT_MS && ctx.now() - boot.blockAt >= BOOT_STEP_MS) boot.done = true;
    return boot.done;
  }

  function render() {
    const word = stateWord({ socket, lastOk, seen, lag, intervalMs: effectiveIntervalMs(), hidden });
    const booting = !bootDone();
    // The dot and the word colour in together, when the sequence resolves.
    root.dataset.state = booting ? 'connecting' : word.toLowerCase().replace(/\s+/g, '-');
    if (stateEl) {
      stateEl.textContent = booting
        ? bootPhrase({ sinceMs: ctx.now() - openedAt, subscribed: boot.subscribed, block: boot.block, formatInteger })
        : word;
    }
    if (sealingEl) {
      sealingEl.textContent = sealingPhrase({
        seen: sealed.size === 0 ? null : sealed.size,
        total,
        sinceMs: ctx.now() - openedAt,
        error: validatorsError,
      });
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

  /** A height from the hero, live (`head`) or polled (`poll`): the figure, the interval, the lag. */
  function arrival({ record, number, author, arrivedAt }) {
    lastOk = Boolean(record?.ok);
    if (!record?.ok) {
      ctx.readout.showError(root, record);
      render();
      return;
    }
    seen = true;
    if (boot.blockAt === null && Number.isFinite(number)) {
      boot.block = number;
      boot.blockAt = ctx.now();
      // The block step is held for its half second however late it came, then the sequence resolves.
      if (!bootDone()) ctx.motion.tween(BOOT_STEP_MS, () => render(), { done: () => render() });
    }
    const advanced = Number.isFinite(number) && (bestNumber === null || number > bestNumber);
    if (Number.isFinite(number)) {
      ctx.readout.showValue(root, record, { value: number, motion: ctx.motion });
      if (advanced) beat(); // a poll that repeats the height is not a block, so no beat
    }
    noteArrival(number, arrivedAt);
    // Recomputed on EVERY head, not only when a `finalized` event arrives. If
    // GRANDPA stops finalising while blocks keep coming, no `finalized` event
    // ever fires again — so a lag that only moved on that event stayed frozen
    // at its last healthy value and the bar reported "finality 2 blocks" in
    // green while the real lag grew without bound. "Finality lagging" was
    // reachable only while finality was still working.
    recomputeLag();
    // A polled height carries no author, so it adds nothing; what was seen before stays true.
    if (author && Number.isInteger(author.authorityIndex)) sealed.add(author.authorityIndex);
    render();
  }

  ctx.bus.on('head', (event) => arrival(event));

  ctx.bus.on('poll', ({ record, number, finalized, arrivedAt }) => {
    if (record?.ok && Number.isFinite(finalized)) finalizedNumber = finalized;
    arrival({ record, number, author: null, arrivedAt });
  });

  ctx.bus.on('finalized', ({ number }) => {
    if (!Number.isFinite(number)) return;
    finalizedNumber = number;
    recomputeLag();
    render();
  });

  ctx.bus.on('socket', ({ state, attempts }) => {
    if (state === 'open') {
      socket = 'live';
      boot.subscribed = true;
    }
    else if (state === 'failed' || (state === 'closed' && attempts >= 1)) socket = 'polling';
    render();
  });

  ctx.bus.on('visibility', (v) => {
    const returning = hidden && !v.hidden;
    hidden = v.hidden;
    // Coming back from a hidden tab is not a late block. `lastArrival` is a
    // wall-clock instant, so without this the first head after ten minutes
    // hidden reads as a ten-minute gap and the bar cries "Blocks late" about
    // a chain that was fine the whole time. The clock restarts on return; the
    // next real gap is measured honestly.
    if (returning) {
      lastArrival = ctx.now();
      intervalMs = null;
    }
    render();
  });

  // A STALL PRODUCES NO EVENTS, so something has to ask.
  //
  // Every other figure on this bar is event-driven, which is right for values
  // that change when the chain changes. "Is the chain still moving?" is the
  // opposite: the answer changes precisely when nothing arrives. Without a
  // prompt the bar could only report a stall retroactively, once the chain
  // recovered and a late block finally landed — the one moment the warning is
  // no longer needed.
  //
  // THE TIMER IS NOT HERE, deliberately. `observatory.test.mjs` refuses
  // `setInterval` in any instrument — "use ctx.watch so it pauses when hidden"
  // — and it is right to: a timer inside an instrument keeps running in a
  // hidden tab and nothing in the instrument's scope knows to stop it. main.js
  // is the one module the rule exempts, and it already guards on
  // `document.hidden`. So the re-evaluation is returned as a function and the
  // host drives it.

  ctx.watch(
    'validators',
    (record) => {
      // The read's outcome is said, never hidden: a failed read carries its
      // error, and a read that succeeded but would not decode is said as that,
      // with the error logged, so "not yet read" is only ever true.
      let next = null;
      if (!record.ok) {
        validatorsError = record.error ?? 'read failed';
      } else {
        try {
          next = decodeValidators(ctx.field(record.data, 'result')).length;
          validatorsError = null;
        } catch (error) {
          validatorsError = `could not decode the set: ${error.message}`;
          console.error(error);
        }
      }
      if (total !== null && next !== total) sealed.clear(); // a changed set makes the old count meaningless
      total = next;
      render();
    },
    VALIDATORS_INTERVAL_MS,
  );

  if (!boot.done) ctx.motion.tween(BOOT_MS, () => render(), { done: () => render() });
  render();

  return {
    /** Re-evaluates the state word with no event to prompt it; main.js drives this, never while hidden. */
    tick: () => { if (!hidden && seen) render(); },
    /** The bar's derived state, for tests. */
    state: () => ({ socket, lastOk, seen, best: bestNumber, lastFinalized: finalizedNumber, lag, intervalMs, hidden, total, validatorsError, sealed: [...sealed], openedAt }),
  };
}
