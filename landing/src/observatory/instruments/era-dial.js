// 02 · Era dial. A circular gauge of the era in progress: the arc fills from
// twelve o'clock as blocks are produced, and when it meets the settlement mark
// the era is due — rewards are computed from the work actually done, and any
// account may trigger the settlement.
//
// Data: `/v1/eras/current` every 6 s for the position of the era (its number,
// start block, length, blocks elapsed and remaining, and whether settlement is
// due), and `/v1/eras?limit=14` every minute for the most recent settled era
// and what its settlement issued. The block time used to turn "blocks
// remaining" into minutes is the chain's nominal 6 s until the hero has
// observed real block times, after which the observed figure is used and the
// provenance line says so.
//
// Motion: on each update the arc tweens from its previous fraction to the new
// one over 200 ms. Nothing else moves.

const ERA_INTERVAL_MS = 6_000;
const ERAS_INTERVAL_MS = 60_000;
/** The chain's target block time (`SLOT_DURATION` in runtime/src/lib.rs), until one is observed. */
export const NOMINAL_BLOCK_MS = 6_000;
/** The SVG's coordinate space: a 320-unit square; the dial scales to its box. */
export const SIZE = 320;
export const CENTRE = SIZE / 2;
export const RADIUS = 136;
export const GRADUATIONS = 60; // hairline marks around the track; every fifth is longer

// ── pure helpers (unit-tested) ────────────────────────────────────────────────

/** How much of the era has passed, clamped to [0, 1]; the pallet does not clamp `blocksElapsed`. */
export function progressFraction(blocksElapsed, durationBlocks) {
  if (!(durationBlocks > 0) || !Number.isFinite(blocksElapsed)) return 0;
  return Math.min(1, Math.max(0, blocksElapsed / durationBlocks));
}

/** The block at which settlement opens. */
export function settlementBlock(startBlock, durationBlocks) {
  return startBlock + durationBlocks;
}

/** Seconds until settlement, from blocks remaining and a block time in milliseconds. */
export function countdownSeconds(blocksRemaining, blockMs = NOMINAL_BLOCK_MS) {
  return (Math.max(0, blocksRemaining) * blockMs) / 1000;
}

/** The provenance phrase for the block time in use. */
export function blockTimeLabel(observedMs) {
  if (!(observedMs > 0)) return `at ${NOMINAL_BLOCK_MS / 1000} s per block`;
  return `at the observed ${(observedMs / 1000).toFixed(1)} s per block`;
}

/** Start and end angles in radians of the progress arc, from twelve o'clock, clockwise. */
export function arcAngles(fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  return { start: -Math.PI / 2, end: -Math.PI / 2 + f * 2 * Math.PI, sweep: f * 2 * Math.PI };
}

/** A point on the circle at `angle` radians (0 at three o'clock, clockwise positive in SVG). */
export function pointAt(angle, r = RADIUS, cx = CENTRE, cy = CENTRE) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

const fix = (n) => Number(n.toFixed(3));

/**
 * The SVG path of the progress arc for a fraction of the era, from twelve
 * o'clock clockwise. A full circle is two half-arcs, since one arc command
 * cannot start and end on the same point.
 */
export function arcPath(fraction, r = RADIUS, cx = CENTRE, cy = CENTRE) {
  const { start, end, sweep } = arcAngles(fraction);
  if (sweep <= 0) return '';
  const a = pointAt(start, r, cx, cy);
  if (sweep >= 2 * Math.PI - 1e-9) {
    const b = pointAt(start + Math.PI, r, cx, cy);
    return `M ${fix(a.x)} ${fix(a.y)} A ${r} ${r} 0 1 1 ${fix(b.x)} ${fix(b.y)} A ${r} ${r} 0 1 1 ${fix(a.x)} ${fix(a.y)}`;
  }
  const b = pointAt(end, r, cx, cy);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${fix(a.x)} ${fix(a.y)} A ${r} ${r} 0 ${large} 1 ${fix(b.x)} ${fix(b.y)}`;
}

/** The geometry of one graduation mark on the track: index k of `count`. */
export function graduation(k, count = GRADUATIONS, r = RADIUS, cx = CENTRE, cy = CENTRE) {
  const angle = -Math.PI / 2 + (k / count) * 2 * Math.PI;
  const major = k % 5 === 0;
  const inner = r - (major ? 10 : 5);
  const from = pointAt(angle, inner, cx, cy);
  const to = pointAt(angle, r - 1, cx, cy);
  return { x1: fix(from.x), y1: fix(from.y), x2: fix(to.x), y2: fix(to.y), major };
}

/**
 * Everything the dial shows, from one `/v1/eras/current` response and the
 * block time in use. Throws (via `field`) on a missing key, so a decode
 * mismatch becomes an unavailable reading rather than a wrong dial.
 */
export function dialState(data, field, blockMs = NOMINAL_BLOCK_MS) {
  const era = field(data, 'era');
  const startBlock = field(data, 'startBlock');
  const durationBlocks = field(data, 'durationBlocks');
  const blocksElapsed = field(data, 'blocksElapsed');
  const blocksRemaining = field(data, 'blocksRemaining');
  const due = field(data, 'dueForSettlement') === true;
  const fraction = due ? 1 : progressFraction(blocksElapsed, durationBlocks);
  return {
    era,
    startBlock,
    durationBlocks,
    blocksElapsed,
    blocksRemaining,
    due,
    fraction,
    // Floored, and 100 only once settlement is due: "100 %" while blocks remain would be a lie.
    percent: due ? 100 : Math.min(99, Math.floor(fraction * 100)),
    settlesAt: settlementBlock(startBlock, durationBlocks),
    seconds: due ? 0 : countdownSeconds(blocksRemaining, blockMs),
  };
}

/** The one-sentence summary the dial's aria-label carries. */
export function ariaSummary(state, format) {
  const era = format.formatInteger(state.era);
  const at = format.formatInteger(state.settlesAt);
  if (state.due) {
    return `Era ${era}, complete, awaiting settlement at block ${at}, which any account may trigger`;
  }
  return `Era ${era}, ${state.percent} % complete, settles at block ${at}, ${format.formatDuration(state.seconds)} from now`;
}

/** The most recent settled era in a `/v1/eras` page, or null when the index holds none. */
export function latestSettled(items, field) {
  for (const item of items) {
    if (field(item, 'settled') === true) return item;
  }
  return null;
}

// ── the instrument ────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, className = '') {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (className) node.setAttribute('class', className);
  return node;
}

function text(className, y, content = '') {
  const node = el('text', { x: CENTRE, y }, className);
  node.textContent = content;
  return node;
}

/** Builds the dial's SVG once; the parts that change are returned by name. */
function buildDial(dial) {
  const svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true', focusable: 'false' });

  // Graduations: sixty hairline marks inside the track, one longer every fifth.
  const marks = el('g', {}, 'dial-marks');
  for (let k = 0; k < GRADUATIONS; k += 1) {
    const { x1, y1, x2, y2, major } = graduation(k);
    marks.append(el('line', { x1, y1, x2, y2 }, major ? 'dial-mark dial-mark-major' : 'dial-mark'));
  }
  svg.append(marks);

  svg.append(el('circle', { cx: CENTRE, cy: CENTRE, r: RADIUS }, 'dial-track'));
  const arc = el('path', { d: '' }, 'dial-arc');
  svg.append(arc);

  // The settlement mark at twelve o'clock, crossing the track.
  const top = pointAt(-Math.PI / 2);
  svg.append(el('line', { x1: top.x, y1: top.y - 12, x2: top.x, y2: top.y + 14 }, 'dial-tick'));

  const percent = text('dial-caption dial-percent', 84);
  const era = text('dial-era', 178);
  const caption = text('dial-caption dial-word', 204, 'ERA');
  const settles = text('dial-caption dial-settles', 240);
  const blocks = text('dial-caption dial-blocks', 258);
  svg.append(percent, era, caption, settles, blocks);
  dial.replaceChildren(svg);
  return { arc, percent, era, caption, settles, blocks };
}

export function init(root, ctx) {
  const dial = root.querySelector('[data-role="dial"]');
  const targets = {
    era: ctx.reading('era', root),
    settlement: ctx.reading('eraSettlement', root),
    countdown: ctx.reading('eraCountdown', root),
    lastSettled: ctx.reading('lastSettled', root),
  };
  const parts = dial ? buildDial(dial) : null;
  const { formatInteger, formatDuration, formatCmn } = ctx.format;

  let observedMs = null; // block time from the hero, once observed
  let eraRecord = null; // the last /v1/eras/current record, for re-rendering the countdown
  let fraction = null; // the arc as currently drawn
  let drawnEra = null; // a new era resets the arc rather than unwinding it
  let cancelTween = () => {};
  let countdownKey = '';

  // ── drawing ──
  function setArc(f) {
    fraction = f;
    parts.arc.setAttribute('d', arcPath(f));
  }

  function moveArc(to, era) {
    cancelTween();
    const reset = drawnEra !== null && era !== drawnEra;
    drawnEra = era;
    if (fraction === null || fraction === to || reset) {
      setArc(to);
      return;
    }
    const from = fraction;
    cancelTween = ctx.motion.tween(200, (t) => setArc(from + (to - from) * t));
  }

  function drawState(state) {
    if (!parts) return;
    dial.dataset.state = state.due ? 'due' : 'running';
    parts.era.textContent = formatInteger(state.era);
    parts.settles.textContent = `settles at #${formatInteger(state.settlesAt)}`;
    parts.blocks.textContent = `${formatInteger(Math.min(state.blocksElapsed, state.durationBlocks))} of ${formatInteger(state.durationBlocks)} blocks`;
    parts.caption.replaceChildren();
    if (state.due) {
      parts.percent.textContent = 'era complete';
      const line1 = el('tspan', { x: CENTRE, dy: 0 });
      line1.textContent = 'awaiting settlement —';
      const line2 = el('tspan', { x: CENTRE, dy: 14 });
      line2.textContent = 'any account may trigger it';
      parts.caption.append(line1, line2);
    } else {
      parts.percent.textContent = `${state.percent} % complete`;
      parts.caption.textContent = 'ERA';
    }
    dial.setAttribute('aria-label', ariaSummary(state, ctx.format));
    moveArc(state.fraction, state.era);
  }

  function drawUnavailable(reason) {
    if (!parts) return;
    cancelTween();
    dial.dataset.state = 'unavailable';
    drawnEra = null;
    setArc(0);
    parts.percent.textContent = '';
    parts.era.textContent = '—';
    parts.caption.textContent = 'ERA';
    parts.settles.textContent = 'unavailable';
    parts.blocks.textContent = '';
    dial.setAttribute('aria-label', `Era progress unavailable: ${reason}`);
  }

  // ── readouts ──
  function showCountdown(state, record) {
    const key = state.due ? 'now' : `${state.blocksRemaining}:${observedMs ?? 'nominal'}`;
    if (key === countdownKey && record === eraRecord) return; // nothing new to say
    countdownKey = key;
    if (state.due) {
      ctx.readout.showValue(targets.countdown, record, {
        value: 'now',
        extra: 'settlement is due — any account may trigger it',
      });
      return;
    }
    const blocks = `${formatInteger(state.blocksRemaining)} block${state.blocksRemaining === 1 ? '' : 's'} left`;
    ctx.readout.showValue(targets.countdown, record, {
      value: formatDuration(state.seconds),
      extra: `${blocks} ${blockTimeLabel(observedMs)}`,
    });
  }

  function onEra(record) {
    eraRecord = record;
    const ok = ctx.readout.apply([targets.era, targets.settlement, targets.countdown], record, (data) => {
      const state = dialState(data, ctx.field, observedMs ?? NOMINAL_BLOCK_MS);
      ctx.readout.showValue(targets.era, record, { value: state.era, motion: ctx.motion });
      ctx.readout.showValue(targets.settlement, record, {
        value: state.settlesAt,
        prefix: '#',
        motion: ctx.motion,
        extra: `era began at block #${formatInteger(state.startBlock)}, ${formatInteger(state.durationBlocks)} blocks long`,
      });
      countdownKey = '';
      showCountdown(state, record);
      drawState(state);
    });
    if (!ok) {
      countdownKey = '';
      drawUnavailable(record?.error ?? 'the reading could not be decoded');
    }
  }

  function onEras(record) {
    ctx.readout.apply(targets.lastSettled, record, (data) => {
      const items = ctx.field(data, 'items');
      const settled = latestSettled(items, ctx.field);
      if (!settled) {
        const from = ctx.field(data, 'settledHistoryFrom');
        ctx.readout.showAbsent(
          targets.lastSettled,
          record,
          `no settled era in the index, which begins at block #${formatInteger(from)}`,
        );
        return;
      }
      const era = ctx.field(settled, 'era');
      const emission = ctx.field(settled, 'totalEmissionPlancks');
      const at = ctx.field(settled, 'settledAtBlock');
      ctx.readout.showValue(targets.lastSettled, record, {
        value: formatCmn(emission),
        unit: ' CMN',
        extra: `era ${formatInteger(era)} · settled at block #${formatInteger(at)}`,
      });
    });
  }

  // The hero's observed block time refines the countdown; re-read the last era record with it.
  ctx.bus.on('cadence', ({ intervalMs }) => {
    if (!(intervalMs > 0)) return;
    const changed = observedMs === null || Math.abs(intervalMs - observedMs) >= 50;
    observedMs = intervalMs;
    if (!changed || !eraRecord?.ok) return;
    try {
      const state = dialState(eraRecord.data, ctx.field, observedMs);
      showCountdown(state, eraRecord);
      dial?.setAttribute('aria-label', ariaSummary(state, ctx.format));
    } catch {
      // onEra already reported the decode failure on the readings
    }
  });

  if (parts) {
    dial.dataset.state = 'waiting';
    parts.era.textContent = '';
    parts.settles.textContent = 'waiting for the first reading';
    setArc(0);
  }

  ctx.watch('era', onEra, ERA_INTERVAL_MS);
  ctx.watch('eras', onEras, ERAS_INTERVAL_MS);
}
