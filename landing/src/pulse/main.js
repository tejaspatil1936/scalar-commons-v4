// Boot for /pulse: one shared context (the observatory's — one socket, one
// poller, one motion policy), the live feed, the Waterfall, the readings and
// the feed's sentences, wired together here and nowhere else. This is the
// only module on the page allowed a timer: one tick a second, stopped while
// the tab is hidden, that keeps the feed's ages, the minute-and-hour figures
// and the quiet state current. Everything that reaches the network goes
// through the context, which pauses it all when the tab is hidden; the
// Waterfall is paused with it and rebuilt from the index on return.

import { createContext } from '../observatory/context.js';
import { createLamp, initChrome } from '../chrome/behaviour/index.js';
import { isOperatorRun } from '../observatory/instruments/agent-field.js';
import { createFeed, headNumber, nameOf } from './feed.js';
import { createWaterfall, drawLegendGlyph } from './waterfall.js';
import { HOUR_MS, agreementKeyOf } from './model.js';
import { bannerText } from './wiring.js';
import { showValue } from './readings.js';
import * as strip from './strip.js';
import * as ticker from './ticker.js';

const TICK_MS = 1_000;
const ERA_INTERVAL_MS = 30_000;

function boot() {
  const ctx = createContext();
  ctx.start();
  initChrome(document);

  const root = document.querySelector('.pulse');
  const canvas = root.querySelector('[data-waterfall]');
  const bandHost = root.querySelector('[data-band]');
  const bandText = bandHost?.querySelector('.nw-band');
  const feedDot = root.querySelector('[data-feed-dot]');
  const operators = root.querySelector('[data-operators]');
  const fullscreenButton = root.querySelector('.pulse-fullscreen');
  const lampEl = document.querySelector('[data-lamp]');
  const lamp = lampEl ? createLamp(lampEl, { rpc: ctx.RPC_URL }) : null;

  const feed = createFeed(ctx);
  const figures = strip.init(root.querySelector('.pulse-readings'), ctx, feed);
  const lines = ticker.init(root.querySelector('.pulse-feed'), ctx, feed);
  const waterfall = canvas?.getContext?.('2d') ? createWaterfall(canvas, { ctx }) : null;
  const readingOf = (key) => ctx.reading(key, root);
  const reduced = () => ctx.motion.reduced();

  for (const legend of root.querySelectorAll('[data-legend]')) drawLegendGlyph(legend, legend.dataset.legend);

  let lastEventAt = null; // the newest event's instant, live or from the hour
  let lastEventBlock = null;
  let seeded = false;

  // ── the lamp and the strip's heads ──
  ctx.bus.on('socket', ({ state }) => lamp?.update({ open: state === 'open' }));
  ctx.subscribe('newHeads', (record) => {
    if (!record.ok) return;
    const number = headNumber(record.data, ctx.field);
    lamp?.update({ open: true, block: number });
    waterfall?.block(number);
    showValue(readingOf('bestBlock'), record, { value: number, block: number, reduced: reduced() });
  });
  ctx.subscribe('finalizedHeads', (record) => {
    if (!record.ok) return;
    const number = headNumber(record.data, ctx.field);
    lamp?.update({ finalized: number });
    showValue(readingOf('finalizedBlock'), record, { value: number, block: number, reduced: reduced() });
  });
  ctx.watch(
    'era',
    (record) => {
      if (!record.ok) return;
      const era = ctx.field(record.data, 'era');
      showValue(readingOf('era'), record, { value: era, block: feed.head(), reduced: reduced() });
    },
    ERA_INTERVAL_MS,
  );

  // ── the feed's state: the lamp's dot, the band, the glyphs' ink ──
  feed.on('status', (status) => {
    const text = bannerText(status, ctx.format.formatInteger);
    if (bandHost && bandText) {
      bandText.textContent = text;
      bandHost.hidden = text === '';
    }
    const behind = status.state === 'stale' && Number.isFinite(status.head) && Number.isFinite(status.indexed) ? status.head - status.indexed : 0;
    lamp?.update({ indexBehind: behind });
    waterfall?.setState(status.state === 'live' ? 'live' : status.state === 'connecting' ? 'connecting' : 'behind');
    feedDot?.setAttribute('data-lit', String(status.state === 'live'));
    if (text) ctx.announce(text);
  });

  // ── the columns and the operator count (counted, never typed) ──
  feed.on('agents', ({ record, items }) => {
    if (!record.ok) return;
    waterfall?.setAgents(items, feed.names());
    if (operators) {
      const run = items.filter((agent) => isOperatorRun(nameOf(agent))).length;
      operators.textContent = `${ctx.format.formatInteger(run)}/${ctx.format.formatInteger(items.length)} operator-run`;
    }
  });

  // ── the index's last hour seeds the feed's lines (history, with true ages; never animated) ──
  feed.on('hour', ({ events, error }) => {
    if (error) return;
    for (const { event, at } of events) {
      if (lastEventAt === null || at > lastEventAt) {
        lastEventAt = at;
        lastEventBlock = event.blockNumber;
      }
    }
    if (seeded) return;
    seeded = true;
    // The index's record is what the Waterfall draws while connecting (at 40 %) and what it is rebuilt from.
    for (const item of events) waterfall?.event({ ...item, key: agreementKeyOf(item.event) });
    for (const item of events.slice(-ticker.FEED_LINES)) lines.push(item);
  });

  feed.on('event', (live) => {
    const key = agreementKeyOf(live.event);
    waterfall?.event({ ...live, key });
    lines.push(live);
    if (lastEventAt === null || live.at > lastEventAt) {
      lastEventAt = live.at;
      lastEventBlock = live.event.blockNumber;
    }
  });

  // ── the tab, the keys, the button ──
  ctx.bus.on('visibility', ({ hidden }) => {
    if (hidden) waterfall?.pause();
    else waterfall?.resume();
  });
  ctx.motion.onChange(() => waterfall?.rebuild());

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch((error) => console.error(error));
    else document.documentElement.requestFullscreen?.().catch((error) => console.error(error));
  }
  document.addEventListener('fullscreenchange', () => {
    fullscreenButton?.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  });
  fullscreenButton?.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^(input|textarea|select)$/i.test(event.target?.tagName ?? '')) return;
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  // The one timer on the page: ages, the minute-and-hour figures and the quiet state move with the clock, not only with events.
  setInterval(() => {
    if (document.hidden) return;
    figures.tick();
    const quiet = lastEventAt !== null && ctx.now() - lastEventAt > HOUR_MS;
    lines.quiet(quiet ? lastEventBlock : null);
    lines.tick();
  }, TICK_MS);

  feed.start();
}

if (typeof document !== 'undefined' && document.querySelector('.pulse')) boot();
