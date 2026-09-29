// 05 · History strips. Four small multiples of the chain's own record, each
// saying where its history begins. Nothing is extrapolated and nothing is
// faked: a strip that cannot be filled says so instead of drawing a guess.
//
// Data (all polled once a minute through the shared scheduler):
//   blockTime         /v1/blocks?limit=200 — the seconds between consecutive
//                     blocks, oldest to newest, against the 6 s target.
//   agreementsPerEra  /v1/eras?limit=14 for the era boundaries, and every
//                     escrow.AgreementCreated event the index holds, counted
//                     into the twelve most recent whole settled eras plus the
//                     era in progress ("so far"). Eras whose span the fetched
//                     events do not reach are dropped, never shown short.
//   emissionPerEra    the same eras record — the CMN each settlement issued,
//                     as the pallet reported it. Zero is drawn as zero.
//   agentsOverTime    every agents.AgentRegistered and UnstakeCompleted event
//                     the index holds, walked forward from a baseline of the
//                     agents that predate the index (today's total, less the
//                     registrations and plus the departures the index saw).
//
// Drawing: one SVG per strip, sized to its box (a ResizeObserver re-fits it),
// with d3-scale for the axes and d3-shape for the paths. Colours come from
// the design system's classes, so light and dark are the stylesheet's.
//
// Motion: when a strip's data changes it is revealed left to right over
// 350 ms, once; a resize redraws without motion. Nothing loops.

import { scaleBand, scaleLinear } from 'd3-scale';
import { area, curveLinear, curveStepAfter, line } from 'd3-shape';
import { max, mean, min } from 'd3-array';

const INTERVAL_MS = 60_000;
/** The chain's target block time (`SLOT_DURATION` in runtime/src/lib.rs). */
export const NOMINAL_BLOCK_S = 6;
/** Whole settled eras a strip shows at most. */
export const ERAS_SHOWN = 12;
/** The drawing box before the strip has been measured. */
export const DEFAULT_WIDTH = 300;
export const DEFAULT_HEIGHT = 88;
const REVEAL_MS = 350;

// ── pure helpers (unit-tested) ────────────────────────────────────────────────

/**
 * Seconds between consecutive blocks, oldest to newest, from a newest-first
 * page of /v1/blocks. A pair with a missing timestamp, or a gap in the block
 * numbers, is skipped rather than interpolated; the count of skipped pairs is
 * returned so the reading can say so.
 */
export function blockIntervals(items, field) {
  const blocks = items
    .map((item) => ({
      number: field(item, 'number'),
      at: item.timestampMs === null || item.timestampMs === undefined ? NaN : Number(item.timestampMs),
    }))
    .sort((a, b) => a.number - b.number);
  const points = [];
  let skipped = 0;
  for (let i = 1; i < blocks.length; i += 1) {
    const a = blocks[i - 1];
    const b = blocks[i];
    if (b.number !== a.number + 1 || !Number.isFinite(a.at) || !Number.isFinite(b.at)) {
      skipped += 1;
      continue;
    }
    points.push({ number: b.number, seconds: (b.at - a.at) / 1000 });
  }
  return {
    points,
    skipped,
    blocks: blocks.length,
    first: blocks.length ? blocks[0].number : null,
    last: blocks.length ? blocks[blocks.length - 1].number : null,
  };
}

/** Last, mean, min and max of an interval series; null when there is none. */
export function intervalStats(points) {
  if (points.length === 0) return null;
  const seconds = points.map((p) => p.seconds);
  return {
    last: seconds[seconds.length - 1],
    mean: mean(seconds),
    min: min(seconds),
    max: max(seconds),
  };
}

/**
 * Era spans from a /v1/eras page: item 0 is the era in progress (with its
 * start block), the rest are settled, newest first. Settled era k spans
 * [settledAtBlock(k−1), settledAtBlock(k)), so n settled entries give n−1
 * whole eras; only the contiguous run ending at the newest settled era is
 * used, since a missing entry leaves a boundary unknown. Returns the whole
 * eras oldest first (at most `limit`), and the open era when present.
 */
export function eraSpans(items, field, limit = ERAS_SHOWN) {
  const settled = items
    .filter((item) => field(item, 'settled') === true)
    .map((item) => ({ era: field(item, 'era'), settledAt: field(item, 'settledAtBlock') }))
    .sort((a, b) => a.era - b.era);
  // Keep the contiguous run that ends at the newest settled era.
  let start = settled.length - 1;
  while (start > 0 && settled[start - 1].era === settled[start].era - 1) start -= 1;
  const run = settled.slice(start);
  const whole = [];
  for (let i = 1; i < run.length; i += 1) {
    whole.push({ era: run[i].era, start: run[i - 1].settledAt, end: run[i].settledAt });
  }
  const current = items.find((item) => field(item, 'settled') === false) ?? null;
  const open = current ? { era: field(current, 'era'), start: field(current, 'startBlock') } : null;
  return { whole: whole.slice(-limit), open, settled: run };
}

/**
 * Counts newest-first events (with `blockNumber`) into era spans. A span is
 * only kept when the events on hand cover all of it: when the list was cut
 * short (`complete` false) the oldest event fetched is the floor, and the
 * index's own first block is always one. Spans below the floor are dropped
 * and `historyFrom` says where the kept history begins.
 */
export function bucketByEra(spans, open, events, { complete = true, indexFrom = null } = {}) {
  let floor = Number.isFinite(indexFrom) ? indexFrom : -Infinity;
  const oldest = events.length ? Math.min(...events.map((e) => e.blockNumber)) : null;
  if (!complete && oldest !== null) floor = Math.max(floor, oldest);
  const kept = spans.filter((span) => span.start >= floor).map((span) => ({ ...span, count: 0 }));
  const dropped = spans.length - kept.length;
  const soFar = open ? { ...open, count: 0 } : null;
  for (const event of events) {
    const b = event.blockNumber;
    const span = kept.find((s) => b >= s.start && b < s.end);
    if (span) span.count += 1;
    else if (soFar && b >= soFar.start) soFar.count += 1;
  }
  return {
    buckets: kept,
    open: soFar,
    dropped,
    historyFrom: kept.length ? kept[0].start : soFar?.start ?? null,
  };
}

/** The settled eras' emission, oldest first, as numbers for a scale and as plancks for the figure. */
export function emissionSeries(items, field, cmnNumber, limit = ERAS_SHOWN) {
  return items
    .filter((item) => field(item, 'settled') === true)
    .map((item) => ({
      era: field(item, 'era'),
      settledAt: field(item, 'settledAtBlock'),
      plancks: String(field(item, 'totalEmissionPlancks')),
    }))
    .sort((a, b) => a.era - b.era)
    .slice(-limit)
    .map((entry) => ({ ...entry, cmn: cmnNumber(entry.plancks) }));
}

/**
 * The cumulative count of registered agents over block number, from the
 * start of the index to now. Agents registered before the index began are
 * not in it as events, so they are the baseline: today's total, less the
 * registrations the index saw, plus the departures it saw. Throws when the
 * numbers cannot reconcile (a negative baseline), rather than drawing one.
 */
export function agentSteps({ registrations, unstakes, totalNow, indexFrom, nowBlock }) {
  const deltas = [
    ...registrations.map((b) => ({ block: b, delta: 1 })),
    ...unstakes.map((b) => ({ block: b, delta: -1 })),
  ].sort((a, b) => a.block - b.block || b.delta - a.delta);
  const baseline = totalNow - registrations.length + unstakes.length;
  if (!Number.isFinite(baseline) || baseline < 0) {
    throw new Error('registrations and departures in the index do not reconcile with the total');
  }
  const start = deltas.length ? Math.min(indexFrom, deltas[0].block) : indexFrom;
  const points = [{ block: start, count: baseline }];
  let running = baseline;
  for (const { block, delta } of deltas) {
    running += delta;
    points.push({ block, count: running });
  }
  const end = Number.isFinite(nowBlock) ? Math.max(nowBlock, points[points.length - 1].block) : null;
  if (end !== null && end > points[points.length - 1].block) points.push({ block: end, count: running });
  return { baseline, points, registrations: registrations.length, unstakes: unstakes.length, total: running, start, end };
}

/** The drawing frame inside a strip: room at the bottom for the end labels. */
export function plotFrame(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  const left = 1;
  const right = width - 1;
  const top = 6;
  const bottom = height - 16;
  return { width, height, left, right, top, bottom, innerWidth: right - left, innerHeight: bottom - top };
}

/** The ceiling of a y scale: never zero, and a little above the tallest value. */
export function yCeiling(values, floor = 1) {
  const top = max(values) ?? 0;
  return Math.max(floor, top * 1.08);
}

// ── SVG ───────────────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, className = '') {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (className) node.setAttribute('class', className);
  return node;
}

function label(x, y, content, anchor = 'start', className = 'plot-label') {
  const node = el('text', { x, y, 'text-anchor': anchor }, className);
  node.textContent = content;
  return node;
}

const fix = (n) => Number(n.toFixed(2));

/** One strip: its plot box, its reading, and the state needed to redraw it. */
class Strip {
  constructor(root, ctx, key) {
    this.ctx = ctx;
    this.key = key;
    this.target = ctx.reading(key, root);
    this.plot = this.target?.querySelector('[data-plot]') ?? null;
    this.drawn = null; // the last draw function, re-run on resize
    this.dataKey = null; // identity of the data last drawn, to move only on change
    this.cancel = () => {};
    if (this.plot && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        if (this.drawn) this.draw(this.drawn, { animate: false });
      }).observe(this.plot);
    }
  }

  size() {
    const width = this.plot?.clientWidth || DEFAULT_WIDTH;
    const height = this.plot?.clientHeight || DEFAULT_HEIGHT;
    return plotFrame(width, height);
  }

  /** Replaces the plot with a fresh SVG built by `build(frame, svg, group)`; reveals it when the data changed. */
  draw(build, { animate = true, dataKey = null } = {}) {
    if (!this.plot) return;
    this.drawn = build;
    const frame = this.size();
    const svg = el('svg', {
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      role: 'img',
      'aria-label': '',
    });
    const clipId = `history-${this.key}-reveal`;
    const clip = el('clipPath', { id: clipId });
    const window_ = el('rect', { x: 0, y: 0, width: frame.width, height: frame.height });
    clip.append(window_);
    const defs = el('defs');
    defs.append(clip);
    svg.append(defs);
    const group = el('g', { 'clip-path': `url(#${clipId})` });
    const summary = build(frame, svg, group) ?? '';
    svg.append(group);
    svg.setAttribute('aria-label', summary);
    this.plot.replaceChildren(svg);

    this.cancel();
    const changed = dataKey !== null && dataKey !== this.dataKey;
    if (dataKey !== null) this.dataKey = dataKey;
    if (!animate || !changed) return;
    this.cancel = this.ctx.motion.tween(REVEAL_MS, (t) => {
      // The first frame's timestamp can precede the tween's start, so t is clamped here.
      window_.setAttribute('width', String(frame.width * Math.min(1, Math.max(0, t))));
    });
  }

  /** No figure and no plot: the box shows only the reason in its label. */
  clear(reason) {
    this.dataKey = null;
    this.draw(() => reason, { animate: false });
  }
}

// ── the instrument ────────────────────────────────────────────────────────────

export function init(root, ctx) {
  const { formatInteger, formatCmn, cmnNumber } = ctx.format;
  const strips = {
    blockTime: new Strip(root, ctx, 'blockTime'),
    agreements: new Strip(root, ctx, 'agreementsPerEra'),
    emission: new Strip(root, ctx, 'emissionPerEra'),
    agents: new Strip(root, ctx, 'agentsOverTime'),
  };
  const records = { eras: null, agreements: null, registrations: null, unstakes: null, agents: null };

  /**
   * Shows a strip from one or more records. The first is the provenance
   * record; a failure in any of them replaces the figure and the plot with
   * the reason. Renders only once every record it needs has arrived.
   */
  function show(strip, needed, render) {
    if (needed.some((record) => record === null)) return;
    const failed = needed.find((record) => !record.ok);
    if (failed) {
      ctx.readout.showError(strip.target, failed);
      strip.clear(`unavailable: ${failed.error}`);
      return;
    }
    let reason = null;
    const ok = ctx.readout.apply(strip.target, needed[0], (data, record) => {
      try {
        render(data, record);
      } catch (error) {
        reason = error.message;
        throw error;
      }
    });
    if (!ok) strip.clear(`unavailable: ${reason ?? 'the response could not be read'}`);
  }

  /** A field reader for a record other than the provenance one, naming that record in any failure. */
  function readerOf(record) {
    return (value, path) => {
      try {
        return ctx.field(value, path);
      } catch (error) {
        throw new Error(`${record.label}: ${error.message}`);
      }
    };
  }

  // ── 1 · block time ──
  function showBlockTime(record) {
    const strip = strips.blockTime;
    show(strip, [record], (data) => {
      const items = ctx.field(data, 'items');
      const series = blockIntervals(items, ctx.field);
      const stats = intervalStats(series.points);
      if (!stats) {
        ctx.readout.showAbsent(strip.target, record, 'no two consecutive blocks with timestamps in the page');
        strip.clear('No block times to show yet.');
        return;
      }
      const s = (n) => n.toFixed(1);
      ctx.readout.showValue(strip.target, record, {
        value: s(stats.last),
        unit: ' s',
        extra:
          `mean ${s(stats.mean)} s, min ${s(stats.min)}, max ${s(stats.max)} over ${formatInteger(series.blocks)} blocks` +
          (series.skipped ? ` · ${series.skipped} pair${series.skipped === 1 ? '' : 's'} skipped, no timestamp` : ''),
      });
      const summary =
        `Seconds between consecutive blocks from block ${formatInteger(series.first)} to ${formatInteger(series.last)}: ` +
        `the latest gap is ${s(stats.last)} seconds, the mean ${s(stats.mean)}, ranging from ${s(stats.min)} to ${s(stats.max)}, ` +
        `against a target of ${NOMINAL_BLOCK_S}.`;
      strip.draw(
        (frame, svg, g) => {
          const x = scaleLinear()
            .domain([series.points[0].number, series.points[series.points.length - 1].number])
            .range([frame.left, frame.right]);
          const y = scaleLinear()
            .domain([0, yCeiling([...series.points.map((p) => p.seconds), NOMINAL_BLOCK_S * 2])])
            .range([frame.bottom, frame.top]);
          const shape = line()
            .x((p) => x(p.number))
            .y((p) => y(p.seconds))
            .curve(curveLinear);
          const fill = area()
            .x((p) => x(p.number))
            .y0(frame.bottom)
            .y1((p) => y(p.seconds));
          g.append(el('path', { d: fill(series.points) }, 'plot-area'));
          g.append(el('line', { x1: frame.left, x2: frame.right, y1: fix(y(NOMINAL_BLOCK_S)), y2: fix(y(NOMINAL_BLOCK_S)) }, 'plot-axis'));
          g.append(el('line', { x1: frame.left, x2: frame.right, y1: frame.bottom, y2: frame.bottom }, 'plot-axis'));
          g.append(el('path', { d: shape(series.points) }, 'plot-line'));
          const last = series.points[series.points.length - 1];
          g.append(el('circle', { cx: fix(x(last.number)), cy: fix(y(last.seconds)), r: 2.5 }, 'plot-dot'));
          svg.append(label(frame.left + 3, fix(y(NOMINAL_BLOCK_S)) - 4, `${NOMINAL_BLOCK_S} s target`, 'start', 'plot-label plot-note'));
          svg.append(label(frame.left, frame.height - 3, `#${formatInteger(series.first)}`));
          svg.append(label(frame.right, frame.height - 3, `#${formatInteger(series.last)}`, 'end'));
          return summary;
        },
        { dataKey: `${series.first}:${series.last}:${series.skipped}` },
      );
    });
  }

  // ── 2 · agreements per era ──
  function showAgreements() {
    const strip = strips.agreements;
    const events = records.agreements;
    const eras = records.eras;
    show(strip, [events, eras], (data, record) => {
      const items = record.items;
      const field = readerOf(eras);
      const spans = eraSpans(field(eras.data, 'items'), field);
      const indexFrom = field(eras.data, 'settledHistoryFrom');
      if (spans.whole.length === 0) {
        ctx.readout.showAbsent(
          strip.target,
          record,
          `fewer than two settled eras in the index, which begins at block #${formatInteger(indexFrom)}`,
        );
        strip.clear('No whole era to count yet.');
        return;
      }
      const list = items.map((item) => ({ blockNumber: ctx.field(item, 'blockNumber') }));
      const { buckets, open, dropped, historyFrom } = bucketByEra(spans.whole, spans.open, list, {
        complete: record.complete,
        indexFrom,
      });
      if (buckets.length === 0) {
        ctx.readout.showAbsent(
          strip.target,
          record,
          `the events fetched do not reach back a whole era; history from block #${formatInteger(historyFrom)}`,
        );
        strip.clear('No whole era the fetched events cover.');
        return;
      }
      const lastSettled = buckets[buckets.length - 1];
      const firstEra = buckets[0].era;
      const extra = [
        `eras ${formatInteger(firstEra)}–${formatInteger(lastSettled.era)}`,
        open ? `${formatInteger(open.count)} so far in era ${formatInteger(open.era)}` : '',
        dropped ? `history from block #${formatInteger(historyFrom)}` : '',
        `era boundaries from ${eras.label}`,
      ]
        .filter(Boolean)
        .join(' · ');
      ctx.readout.showValue(strip.target, record, {
        value: lastSettled.count,
        unit: ` in era ${formatInteger(lastSettled.era)}`,
        extra,
        motion: ctx.motion,
      });
      const busiest = buckets.reduce((a, b) => (b.count > a.count ? b : a), buckets[0]);
      const summary =
        `Agreements opened in each of the last ${buckets.length} settled eras, ${formatInteger(firstEra)} to ${formatInteger(lastSettled.era)}` +
        (open ? `, plus ${formatInteger(open.count)} so far in era ${formatInteger(open.era)}` : '') +
        `: the last settled era had ${formatInteger(lastSettled.count)}; the busiest, era ${formatInteger(busiest.era)}, had ${formatInteger(busiest.count)}.`;
      const bars = open ? [...buckets, { ...open, open: true }] : buckets;
      strip.draw(
        (frame, svg, g) => {
          drawBars(frame, svg, g, bars, {
            value: (b) => b.count,
            isLast: (b) => b === lastSettled,
            leftLabel: `era ${formatInteger(firstEra)}`,
            rightLabel: open ? `era ${formatInteger(open.era)} so far` : `era ${formatInteger(lastSettled.era)}`,
          });
          return summary;
        },
        { dataKey: bars.map((b) => `${b.era}=${b.count}`).join(',') },
      );
    });
  }

  // ── 3 · emission per era ──
  function showEmission() {
    const strip = strips.emission;
    const eras = records.eras;
    show(strip, [eras], (data, record) => {
      const items = ctx.field(data, 'items');
      const series = emissionSeries(items, ctx.field, cmnNumber);
      if (series.length === 0) {
        const indexFrom = ctx.field(data, 'settledHistoryFrom');
        ctx.readout.showAbsent(strip.target, record, `no settled era in the index, which begins at block #${formatInteger(indexFrom)}`);
        strip.clear('No settled era to show yet.');
        return;
      }
      const last = series[series.length - 1];
      ctx.readout.showValue(strip.target, record, {
        value: formatCmn(last.plancks),
        unit: ' CMN',
        extra: `era ${formatInteger(last.era)} · settled at #${formatInteger(last.settledAt)}`,
      });
      const summary =
        `CMN issued at each era settlement, eras ${formatInteger(series[0].era)} to ${formatInteger(last.era)}: ` +
        `the last, era ${formatInteger(last.era)}, issued ${formatCmn(last.plancks)} CMN` +
        (series.every((e) => e.cmn === 0) ? '; every era shown issued none.' : '.');
      strip.draw(
        (frame, svg, g) => {
          drawBars(frame, svg, g, series, {
            value: (e) => e.cmn,
            isLast: (e) => e === last,
            leftLabel: `era ${formatInteger(series[0].era)}`,
            rightLabel: `era ${formatInteger(last.era)}`,
          });
          if (series.every((e) => e.cmn === 0)) {
            // Empty bars are the record, not a missing one: say so on the plate.
            svg.append(label(frame.left + 3, frame.top + 8, '0 CMN in every era shown', 'start', 'plot-label plot-note'));
          }
          return summary;
        },
        { dataKey: series.map((e) => `${e.era}=${e.plancks}`).join(',') },
      );
    });
  }

  /** Bars on a band scale with a baseline, a tick under each band, and the end labels. */
  function drawBars(frame, svg, g, entries, { value, isLast, leftLabel, rightLabel }) {
    const x = scaleBand()
      .domain(entries.map((_, i) => i))
      .range([frame.left, frame.right])
      .paddingInner(0.3)
      .paddingOuter(0.05);
    const y = scaleLinear().domain([0, yCeiling(entries.map(value))]).range([frame.bottom, frame.top]);
    entries.forEach((entry, i) => {
      const v = value(entry);
      const top = y(v);
      const classes = ['plot-bar', isLast(entry) ? 'is-last' : '', entry.open ? 'is-open' : ''].filter(Boolean).join(' ');
      g.append(
        el(
          'rect',
          { x: fix(x(i)), y: fix(top), width: fix(x.bandwidth()), height: fix(Math.max(0, frame.bottom - top)) },
          classes,
        ),
      );
      const cx = fix(x(i) + x.bandwidth() / 2);
      svg.append(el('line', { x1: cx, x2: cx, y1: frame.bottom, y2: frame.bottom + 3 }, 'plot-axis plot-tick'));
    });
    svg.append(el('line', { x1: frame.left, x2: frame.right, y1: frame.bottom, y2: frame.bottom }, 'plot-axis'));
    svg.append(label(frame.left, frame.height - 3, leftLabel));
    svg.append(label(frame.right, frame.height - 3, rightLabel, 'end'));
  }

  // ── 4 · agents over time ──
  function showAgents() {
    const strip = strips.agents;
    const { registrations, unstakes, agents, eras } = records;
    show(strip, [registrations, unstakes, agents, eras], (data, record) => {
      if (!record.complete) {
        throw new Error('the index holds more registrations than this page fetched');
      }
      if (!unstakes.complete) {
        throw new Error(`${unstakes.label}: the index holds more departures than this page fetched`);
      }
      const agentsField = readerOf(agents);
      const erasField = readerOf(eras);
      const unstakesField = readerOf(unstakes);
      if (agentsField(agents.data, 'truncated') === true) {
        throw new Error(`${agents.label}: the agent list was cut short, so the total is not exact`);
      }
      const totalNow = agentsField(agents.data, 'total');
      const indexFrom = erasField(eras.data, 'settledHistoryFrom');
      const current = erasField(eras.data, 'items').find((item) => erasField(item, 'settled') === false);
      // The newest block the eras record knows: where the series ends, labelled "now".
      const nowBlock = current ? erasField(current, 'startBlock') + erasField(current, 'blocksElapsed') : null;
      const series = agentSteps({
        registrations: record.items.map((item) => ctx.field(item, 'blockNumber')),
        unstakes: unstakes.items.map((item) => unstakesField(item, 'blockNumber')),
        totalNow,
        indexFrom,
        nowBlock,
      });
      const left = `#${formatInteger(series.start)}`;
      const departures = series.unstakes === 0 ? 'none has left' : `${formatInteger(series.unstakes)} left`;
      ctx.readout.showValue(strip.target, record, {
        value: totalNow,
        unit: totalNow === 1 ? ' agent' : ' agents',
        motion: ctx.motion,
        extra:
          `${formatInteger(series.registrations)} registration${series.registrations === 1 ? '' : 's'} since block ${left} (start of the index); ` +
          `${formatInteger(series.baseline)} agent${series.baseline === 1 ? '' : 's'} predate it; ${departures} · total from ${agents.label}`,
      });
      const summary =
        `Registered agents over time, from block ${formatInteger(series.start)}, the start of the index, to now: ` +
        `${formatInteger(series.baseline)} at the start, ${formatInteger(totalNow)} now, after ${formatInteger(series.registrations)} ` +
        `registration${series.registrations === 1 ? '' : 's'} and ${formatInteger(series.unstakes)} departure${series.unstakes === 1 ? '' : 's'}.`;
      strip.draw(
        (frame, svg, g) => {
          const points = series.points;
          const lastBlock = points[points.length - 1].block;
          const x = scaleLinear().domain([series.start, Math.max(lastBlock, series.start + 1)]).range([frame.left, frame.right]);
          const y = scaleLinear().domain([0, yCeiling(points.map((p) => p.count))]).range([frame.bottom, frame.top]);
          const step = line()
            .x((p) => x(p.block))
            .y((p) => y(p.count))
            .curve(curveStepAfter);
          const fill = area()
            .x((p) => x(p.block))
            .y0(frame.bottom)
            .y1((p) => y(p.count))
            .curve(curveStepAfter);
          g.append(el('path', { d: fill(points) }, 'plot-area'));
          g.append(el('line', { x1: frame.left, x2: frame.right, y1: frame.bottom, y2: frame.bottom }, 'plot-axis'));
          g.append(el('path', { d: step(points) }, 'plot-line'));
          const end = points[points.length - 1];
          g.append(el('circle', { cx: fix(x(end.block)), cy: fix(y(end.count)), r: 2.5 }, 'plot-dot'));
          svg.append(label(frame.left, frame.height - 3, left));
          svg.append(label(frame.right, frame.height - 3, series.end === null ? `#${formatInteger(lastBlock)}` : 'now', 'end'));
          // The series starts at the left and low, so the top-left corner is free for the baseline note.
          svg.append(
            label(frame.left + 3, frame.top + 8, `${formatInteger(series.baseline)} registered before the index`, 'start', 'plot-label plot-note'),
          );
          return summary;
        },
        { dataKey: `${series.start}:${series.baseline}:${series.points.map((p) => `${p.block}=${p.count}`).join(',')}` },
      );
    });
  }

  // ── data ──
  ctx.watch('blocks', showBlockTime, INTERVAL_MS);
  ctx.watch(
    'eras',
    (record) => {
      records.eras = record;
      showAgreements();
      showEmission();
      showAgents();
    },
    INTERVAL_MS,
  );
  ctx.watchAll(
    'agreementsCreated',
    (record) => {
      records.agreements = record;
      showAgreements();
    },
    INTERVAL_MS,
    { maxPages: 5 },
  );
  ctx.watchAll(
    'registrations',
    (record) => {
      records.registrations = record;
      showAgents();
    },
    INTERVAL_MS,
    { maxPages: 3 },
  );
  ctx.watchAll(
    'unstakes',
    (record) => {
      records.unstakes = record;
      showAgents();
    },
    INTERVAL_MS,
    { maxPages: 1 },
  );
  ctx.watch(
    'agents',
    (record) => {
      records.agents = record;
      showAgents();
    },
    INTERVAL_MS,
  );
}
