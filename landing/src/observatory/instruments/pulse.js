// 01 · Chain pulse. Blocks arriving in real time as ticks on a stream, with
// the finalized region shaded behind a marker that slides forward as
// validators agree.
//
// Data: a WebSocket subscription to `chain_subscribeNewHeads` and
// `chain_subscribeFinalizedHeads`, so a tick appears the moment the node
// announces a block, seeded from `/v1/blocks` so the stream is alive on first
// paint. If the socket cannot be opened the hero polls `/v1/status` every 6 s
// and says so. A fork (two heads at one height, or a head below the best) is
// drawn as a superseded tick rather than hidden.
//
// Motion: on each new block the train shifts one slot with a 200 ms ease and
// the new tick slides in from the right; the finality marker slides when the
// finalized head moves. Nothing animates between blocks.

import { babePreDigestOf } from '../scale.js';

const KEEP = 240; // blocks retained in the model
const STATUS_POLL_MS = 6_000; // the fallback when the socket is down
const STATUS_ANNOUNCE_MS = 30_000; // screen-reader summary, at most this often
const CADENCE_WINDOW = 60; // blocks the rhythm is computed over
const FINALITY_SAMPLES = 20;

function headerNumber(header) {
  const n = header?.number;
  if (typeof n === 'string' && /^0x[0-9a-f]+$/i.test(n)) return parseInt(n, 16);
  if (typeof n === 'number') return n;
  throw new Error('header has no block number');
}

/** Identity of a header without its hash: height plus state root. */
function headerId(header) {
  if (typeof header?.stateRoot !== 'string') throw new Error('header has no state root');
  return `${headerNumber(header)}:${header.stateRoot}`;
}

/** Blocks per minute and the mean interval, from the last `CADENCE_WINDOW` block times. */
export function cadenceOf(blocks) {
  const timed = blocks.filter((b) => !b.superseded && Number.isFinite(b.at)).slice(-CADENCE_WINDOW);
  if (timed.length < 2) return null;
  const span = timed[timed.length - 1].at - timed[0].at;
  if (span <= 0) return null;
  const intervalMs = span / (timed.length - 1);
  return { perMinute: 60_000 / intervalMs, intervalMs, blocks: timed.length };
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The model: a bounded, ordered set of recent blocks with fork handling. Pure; tested. */
export class Stream {
  constructor() {
    this.blocks = []; // ascending by number; superseded blocks kept, flagged
    this.best = null;
    this.finalized = null;
    this.finalitySamples = [];
  }

  /** Adds an indexed block (has a timestamp) without disturbing live ones. */
  seed({ number, id, at }) {
    if (this.blocks.some((b) => b.number === number)) return;
    this.blocks.push({ number, id, at, live: false, superseded: false });
    this.blocks.sort((a, b) => a.number - b.number);
    this.trim();
    if (this.best === null || number > this.best) this.best = number;
  }

  /** A new best head. Returns what changed so the view can animate it. */
  head({ number, id, at }) {
    let superseded = 0;
    for (const block of this.blocks) {
      if (block.superseded) continue;
      if (block.number > number || (block.number === number && block.id !== id)) {
        block.superseded = true;
        superseded += 1;
      }
    }
    const existing = this.blocks.find((b) => b.number === number && b.id === id);
    let added = false;
    if (existing) {
      existing.superseded = false;
    } else {
      this.blocks.push({ number, id, at, live: true, superseded: false });
      this.blocks.sort((a, b) => a.number - b.number);
      added = true;
    }
    this.trim();
    const advanced = this.best === null || number > this.best;
    this.best = number;
    return { added, advanced, superseded };
  }

  finalize(number, now) {
    const advanced = this.finalized === null || number > this.finalized;
    if (!advanced) return { advanced: false };
    for (const block of this.blocks) {
      if (block.live && !block.superseded && block.number <= number && block.number > (this.finalized ?? -1)) {
        this.finalitySamples.push(now - block.at);
      }
    }
    if (this.finalitySamples.length > FINALITY_SAMPLES) {
      this.finalitySamples.splice(0, this.finalitySamples.length - FINALITY_SAMPLES);
    }
    this.finalized = number;
    return { advanced: true };
  }

  trim() {
    if (this.blocks.length > KEEP) this.blocks.splice(0, this.blocks.length - KEEP);
  }

  /** Non-superseded blocks, newest first. */
  chain() {
    return this.blocks.filter((b) => !b.superseded).reverse();
  }

  lag() {
    if (this.best === null || this.finalized === null) return null;
    return Math.max(0, this.best - this.finalized);
  }

  /** Seconds a block takes to become final: measured when possible, else lag × interval. */
  finalitySeconds(cadence) {
    const measured = median(this.finalitySamples);
    if (measured !== null && this.finalitySamples.length >= 3) return { seconds: measured / 1000, measured: true };
    const lag = this.lag();
    if (lag === null || !cadence) return null;
    return { seconds: (lag * cadence.intervalMs) / 1000, measured: false };
  }
}

export function init(root, ctx) {
  const canvas = root.querySelector('.pulse-canvas');
  const live = root.querySelector('.live');
  const liveText = live?.querySelector('.live-text');
  const dot = live?.querySelector('.pulse-dot');
  const status = root.querySelector('.pulse-status');
  const targets = {
    best: ctx.reading('bestBlock', root),
    finalized: ctx.reading('finalizedBlock', root),
    lag: ctx.reading('finalityLag', root),
    cadence: ctx.reading('cadence', root),
  };

  const stream = new Stream();
  let headRecord = null; // provenance of the best-block figure
  let finalRecord = null; // provenance of the finalized figure
  let blocksRecord = null; // the index page the stream was seeded from
  let liveCount = 0;
  let mode = 'waiting';
  let stopPolling = null;
  let announcedAt = 0;

  // ── view state ──
  const box = ctx.fitCanvas(canvas, () => draw());
  let slide = 0; // 1 → 0 while the train shifts for a new block
  let markerFrom = null; // finality marker x during its slide
  let markerTo = null;
  let markerT = 1;
  let cancelSlide = () => {};
  let cancelMarker = () => {};

  function setMode(next, text) {
    mode = next;
    if (live) live.dataset.live = next;
    if (liveText) liveText.textContent = text;
  }

  function beat() {
    if (!dot || ctx.motion.reduced()) return;
    dot.classList.remove('beat');
    void dot.offsetWidth;
    dot.classList.add('beat');
  }

  // ── readouts ──
  function showReadouts() {
    const cadence = cadenceOf(stream.blocks);
    if (headRecord && stream.best !== null) {
      ctx.readout.showValue(targets.best, headRecord, { value: stream.best, motion: ctx.motion });
    }
    if (finalRecord && stream.finalized !== null) {
      ctx.readout.showValue(targets.finalized, finalRecord, { value: stream.finalized, motion: ctx.motion });
      const lag = stream.lag();
      if (lag !== null) {
        ctx.readout.showValue(targets.lag, finalRecord, {
          value: lag,
          unit: lag === 1 ? ' block' : ' blocks',
          motion: ctx.motion,
        });
      }
    }
    if (cadence) ctx.bus.emit('cadence', { ...cadence, record: blocksRecord });
    if (blocksRecord && cadence) {
      const finality = stream.finalitySeconds(cadence);
      const within = finality
        ? `final within ${finality.measured ? '' : 'about '}${Math.round(finality.seconds)} s`
        : '';
      ctx.readout.showValue(targets.cadence, blocksRecord, {
        value: cadence.perMinute.toFixed(1),
        unit: ' blocks per minute',
        sub: within,
        extra: `${cadence.blocks} block times${liveCount ? `, ${liveCount} observed live` : ''}${
          finality?.measured ? ' · finality measured' : ''
        }`,
      });
    }
    announce(cadence);
  }

  function announce(cadence) {
    if (!status || ctx.now() - announcedAt < STATUS_ANNOUNCE_MS) return;
    if (stream.best === null) return;
    announcedAt = ctx.now();
    const parts = [`Block ${ctx.format.formatInteger(stream.best)} produced.`];
    if (stream.finalized !== null) parts.push(`Block ${ctx.format.formatInteger(stream.finalized)} final.`);
    if (cadence) parts.push(`${cadence.perMinute.toFixed(0)} blocks per minute.`);
    status.textContent = parts.join(' ');
  }

  // ── drawing ──
  function layout(width) {
    const slot = Math.max(36, Math.min(64, Math.floor(width / 18)));
    const rightPad = slot * 0.75;
    const visible = Math.floor((width - rightPad) / slot);
    return { slot, rightPad, visible, labelEvery: slot < 48 ? 3 : 2 };
  }

  function draw() {
    const { context: g, width, height } = box();
    const { slot, rightPad, visible, labelEvery } = layout(width);
    const baseline = Math.round(height * 0.64) + 0.5;
    const tickHeight = height * 0.3;
    const chain = stream.chain();
    const font = ctx.theme.font('mono');
    const colour = (name) => ctx.theme.color(name);

    g.clearRect(0, 0, width, height);
    const xOf = (k) => width - rightPad - k * slot + slide * slot;

    // The finalized region: shaded behind a marker at the boundary.
    let markerX = null;
    if (stream.finalized !== null && chain.length) {
      const k = chain.findIndex((b) => b.number <= stream.finalized);
      const boundary = k === -1 ? xOf(chain.length) : xOf(k) + slot / 2;
      markerX = markerT < 1 && markerFrom !== null ? markerFrom + (markerTo - markerFrom) * markerT : boundary;
      markerTo = boundary;
      g.fillStyle = colour('settled');
      g.globalAlpha = ctx.theme.isDark() ? 0.13 : 0.1;
      g.fillRect(0, baseline - tickHeight - 18, Math.max(0, markerX), tickHeight + 22);
      g.globalAlpha = 1;
      g.strokeStyle = colour('settled');
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(markerX) + 0.5, 8);
      g.lineTo(Math.round(markerX) + 0.5, height - 4);
      g.stroke();
      g.fillStyle = colour('text-dim');
      g.font = `500 10px ${font}`;
      g.textAlign = 'right';
      g.textBaseline = 'top';
      g.fillText(`FINAL · ${ctx.format.formatInteger(stream.finalized)}`, markerX - 5, 8);
    }

    // Baseline.
    g.strokeStyle = colour('border');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, baseline);
    g.lineTo(width, baseline);
    g.stroke();

    // Superseded blocks: drawn at their height's slot, in the slashed colour.
    g.setLineDash([2, 3]);
    g.strokeStyle = colour('slashed');
    for (const block of stream.blocks) {
      if (!block.superseded || stream.best === null) continue;
      const k = chain.findIndex((b) => b.number === block.number);
      if (k === -1 || k > visible) continue;
      const x = Math.round(xOf(k) + 4) + 0.5;
      g.beginPath();
      g.moveTo(x, baseline - tickHeight * 0.7);
      g.lineTo(x, baseline);
      g.stroke();
    }
    g.setLineDash([]);

    // Ticks, newest at the right.
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let k = 0; k < Math.min(chain.length, visible + 2); k += 1) {
      const block = chain[k];
      const x = Math.round(xOf(k)) + 0.5;
      const final = stream.finalized !== null && block.number <= stream.finalized;
      const fade = final ? 1 : Math.max(0.45, 1 - k * 0.055);
      g.globalAlpha = k === 0 && slide > 0 ? 1 - slide * 0.6 : 1;
      g.strokeStyle = final ? colour('settled') : colour('live');
      g.lineWidth = k === 0 ? 2 : 1.25;
      if (!final) {
        g.globalAlpha *= fade;
      }
      if (k === 0 && !final) {
        g.shadowColor = colour('live-glow');
        g.shadowBlur = 14;
      }
      g.beginPath();
      g.moveTo(x, baseline - tickHeight * (k === 0 ? 1.15 : 1));
      g.lineTo(x, baseline);
      g.stroke();
      g.shadowBlur = 0;
      g.globalAlpha = 1;
      // A label needs room on both sides; one that would be cut by the plate's
      // edge is left off rather than printed half.
      if ((k === 0 || k % labelEvery === 0) && x > 28) {
        g.fillStyle = k === 0 ? colour('text') : colour('text-dim');
        g.font = `${k === 0 ? 500 : 400} 11px ${font}`;
        g.fillText(ctx.format.formatInteger(block.number), x, baseline + 8);
      }
    }
  }

  function animateArrival() {
    cancelSlide();
    if (ctx.motion.reduced()) {
      slide = 0;
      draw();
      return;
    }
    slide = 1;
    cancelSlide = ctx.motion.tween(200, (t) => {
      slide = 1 - t;
      draw();
    });
  }

  function animateMarker() {
    cancelMarker();
    if (ctx.motion.reduced() || markerTo === null) {
      markerT = 1;
      draw();
      return;
    }
    markerFrom = markerFrom === null || markerT >= 1 ? markerTo : markerFrom + (markerTo - markerFrom) * markerT;
    // Compute the new target first, then slide to it.
    const { width } = box();
    const { slot, rightPad } = layout(width);
    const chain = stream.chain();
    const k = chain.findIndex((b) => b.number <= stream.finalized);
    markerTo = k === -1 ? width - rightPad - chain.length * slot : width - rightPad - k * slot + slot / 2;
    markerT = 0;
    cancelMarker = ctx.motion.tween(200, (t) => {
      markerT = t;
      draw();
    });
  }

  // ── data ──
  function onHead(record) {
    const header = record.data;
    const number = headerNumber(header);
    const id = headerId(header);
    const now = ctx.now();
    const change = stream.head({ number, id, at: now });
    headRecord = record;
    liveCount += change.added ? 1 : 0;
    let author = null;
    try {
      author = babePreDigestOf(header);
    } catch (error) {
      author = { error: error.message };
    }
    ctx.bus.emit('head', { record, number, header, author, forked: change.superseded > 0, arrivedAt: now });
    if (mode !== 'live') setMode('live', 'Live');
    if (change.advanced) beat();
    showReadouts();
    if (change.advanced && change.added) animateArrival();
    else draw();
  }

  function onFinalized(record) {
    const number = headerNumber(record.data);
    const change = stream.finalize(number, ctx.now());
    finalRecord = record;
    ctx.bus.emit('finalized', { record, number });
    showReadouts();
    if (change.advanced) animateMarker();
  }

  function onStatus(record) {
    // Polling fallback: /v1/status has no headers, so ticks are placed by height alone.
    if (!record.ok) {
      setMode('down', 'Not updating · last request failed');
      ctx.readout.showError(targets.best, record);
      ctx.readout.showError(targets.finalized, record);
      ctx.readout.showError(targets.lag, record);
      // Polled: no header and no author, so the bus carries the record and nothing else.
      ctx.bus.emit('head', { record, number: null, header: null, author: null, forked: false, arrivedAt: ctx.now() });
      draw();
      return;
    }
    try {
      const best = ctx.field(record.data, 'chain.bestBlock');
      const finalized = ctx.field(record.data, 'chain.finalizedBlock');
      const change = stream.head({ number: best, id: `${best}:status`, at: ctx.now() });
      const fin = stream.finalize(finalized, ctx.now());
      headRecord = record;
      finalRecord = record;
      if (mode === 'polling') setMode('polling', 'Polling · live stream unavailable');
      ctx.bus.emit('head', { record, number: best, header: null, author: null, forked: false, arrivedAt: ctx.now() });
      ctx.bus.emit('finalized', { record, number: finalized });
      showReadouts();
      if (change.advanced) beat();
      if (change.advanced && change.added) animateArrival();
      else if (fin.advanced) animateMarker();
      else draw();
    } catch (error) {
      ctx.readout.showError(targets.best, record, error.message);
      ctx.readout.showError(targets.finalized, record, error.message);
      ctx.readout.showError(targets.lag, record, error.message);
    }
  }

  function startPolling() {
    if (stopPolling) return;
    setMode('polling', 'Polling · live stream unavailable');
    stopPolling = ctx.watch('status', onStatus, STATUS_POLL_MS);
  }

  function stopPollingIfAny() {
    if (!stopPolling) return;
    stopPolling();
    stopPolling = null;
  }

  ctx.bus.on('socket', ({ state, attempts }) => {
    if (state === 'open') {
      stopPollingIfAny();
      if (mode !== 'live') setMode('live', 'Live');
    } else if (state === 'failed' || (state === 'closed' && attempts >= 1)) {
      startPolling();
    } else if (state === 'paused') {
      setMode('paused', 'Paused while this tab is hidden');
    }
  });

  ctx.bus.on('visibility', ({ hidden }) => {
    if (hidden) return;
    // Fill the gap the hidden interval left, from the index.
    seed();
  });

  async function seed() {
    const [statusRecord, blocks] = await Promise.all([ctx.fetch(ctx.SOURCES.status), ctx.fetch(ctx.SOURCES.blocks)]);
    if (blocks.ok) {
      try {
        const items = ctx.field(blocks.data, 'items');
        for (const item of items) {
          const number = ctx.field(item, 'number');
          const at = item.timestampMs === null || item.timestampMs === undefined ? NaN : Number(item.timestampMs);
          stream.seed({ number, id: `${number}:${ctx.field(item, 'hash')}`, at });
        }
        blocksRecord = blocks;
      } catch (error) {
        ctx.readout.showError(targets.cadence, blocks, error.message);
      }
    } else {
      ctx.readout.showError(targets.cadence, blocks);
    }
    if (headRecord === null || finalRecord === null) {
      // Nothing has arrived over the socket yet: show the indexed position now.
      if (statusRecord.ok) {
        try {
          const best = ctx.field(statusRecord.data, 'chain.bestBlock');
          const finalized = ctx.field(statusRecord.data, 'chain.finalizedBlock');
          if (stream.best === null || best > stream.best) stream.seed({ number: best, id: `${best}:status`, at: NaN });
          stream.finalize(finalized, ctx.now());
          headRecord ??= statusRecord;
          finalRecord ??= statusRecord;
          ctx.bus.emit('head', { record: statusRecord, number: best, header: null, author: null, forked: false, arrivedAt: ctx.now() });
          ctx.bus.emit('finalized', { record: statusRecord, number: finalized });
        } catch (error) {
          ctx.readout.showError(targets.best, statusRecord, error.message);
        }
      } else {
        ctx.readout.showError(targets.best, statusRecord);
        ctx.readout.showError(targets.finalized, statusRecord);
        ctx.readout.showError(targets.lag, statusRecord);
      }
    }
    showReadouts();
    draw();
  }

  seed();
  ctx.subscribe('newHeads', (record) => {
    try {
      onHead(record);
    } catch (error) {
      ctx.readout.showError(targets.best, record, error.message);
    }
  });
  ctx.subscribe('finalizedHeads', (record) => {
    try {
      onFinalized(record);
    } catch (error) {
      ctx.readout.showError(targets.finalized, record, error.message);
    }
  });
  ctx.bus.on('theme', () => draw());
  draw();
}
