// The Day Bar (02 · Economy): the last three settled eras in sage and the
// current one filling with filament by elapsed blocks, and the "Time to
// settlement" Reading beside it. Fed by the two era reads the page already
// makes — /v1/eras/current and /v1/eras — through ctx.watch, so it pauses
// with a hidden tab and polls on the scheduler's clock, never its own.
// Labels: `era n · <emission> CMN` for a settled era, `era n · k of 3,600 ·
// h m` for the current one, every number from the response (3,600 is its
// durationBlocks); a label the page has not read yet stays empty. The era
// decoding is the dial's (instruments/era-dial.js), whose pure functions and
// tests stay; this module replaces its drawing.

import { dialState, elapsedPhrase, NOMINAL_BLOCK_MS } from './instruments/era-dial.js';
import { emissionSeries } from './instruments/history.js';

const ERA_INTERVAL_MS = 6_000;
const ERAS_INTERVAL_MS = 60_000;

/** The four labels, oldest settled first, from the settled series and the current era's state. Pure. */
export function labels({ settled = [], current = null }, { formatInteger, formatCmn, formatDuration }) {
  const out = settled.slice(-3).map((e) => `era ${formatInteger(e.era)} · ${formatCmn(e.plancks)} CMN`);
  while (out.length < 3) out.unshift('');
  out.push(
    current
      ? `era ${formatInteger(current.era)} · ${formatInteger(Math.min(current.blocksElapsed, current.durationBlocks))} of ${formatInteger(current.durationBlocks)} · ${current.due ? 'due' : formatDuration(current.seconds)}`
      : '',
  );
  return out;
}

export function init(root, ctx) {
  const bar = root.querySelector('[data-daybar]');
  const countdown = ctx.reading('eraCountdown', root);
  if (!bar && !countdown) return null;
  const fills = bar ? [...bar.querySelectorAll('.nw-daybar-fill')] : [];
  const labelEls = bar ? [...bar.querySelectorAll('[data-daybar-label]')] : [];
  const { formatInteger, formatDuration } = ctx.format;
  const state = { settled: [], current: null };
  let blockMs = NOMINAL_BLOCK_MS;

  const render = () => {
    if (!bar) return;
    const words = labels(state, ctx.format);
    labelEls.forEach((el, i) => {
      el.textContent = words[i] ?? '';
    });
    fills.forEach((fill, i) => {
      if (i < 3) fill.style.width = words[i] ? '100%' : '0%';
    });
    if (state.current) {
      const { blocksElapsed, durationBlocks, fraction } = state.current;
      fills[3].style.width = `${Math.round(fraction * 100)}%`;
      bar.setAttribute('aria-valuenow', String(Math.min(blocksElapsed, durationBlocks)));
      bar.setAttribute('aria-valuemax', String(durationBlocks));
    }
  };

  const showCountdown = (record) => {
    if (!countdown || !state.current) return;
    const era = state.current;
    if (era.due) {
      ctx.readout.showValue(countdown, record, { value: 'now', extra: 'settlement is due — anyone may trigger it' });
      return;
    }
    ctx.readout.showValue(countdown, record, {
      // The figure is the duration alone; the hedge is the receipt's ("about · estimate — …").
      value: formatDuration(era.seconds).replace(/^about /, ''),
      extra: `about · estimate — ${formatInteger(era.blocksRemaining)} block${era.blocksRemaining === 1 ? '' : 's'} left · ${elapsedPhrase(era, ctx.format)}`,
    });
  };

  ctx.watch(
    'era',
    (record) => {
      const ok = ctx.readout.apply(countdown ? [countdown] : [], record, (data) => {
        state.current = dialState(data, ctx.field, blockMs);
      });
      if (!ok) {
        state.current = null;
        return;
      }
      render();
      showCountdown(record);
    },
    ERA_INTERVAL_MS,
  );

  ctx.watchAll(
    'eras',
    (record) => {
      if (!record?.ok) return;
      try {
        state.settled = emissionSeries(record.items, ctx.field, () => 0, Infinity);
        render();
      } catch (error) {
        console.error(error);
      }
    },
    ERAS_INTERVAL_MS,
    { maxPages: 1 },
  );

  // The chain's observed cadence refines the estimate, as it did for the dial.
  ctx.bus.on('cadence', ({ intervalMs }) => {
    if (intervalMs > 0) blockMs = intervalMs;
  });

  return { render, state };
}
