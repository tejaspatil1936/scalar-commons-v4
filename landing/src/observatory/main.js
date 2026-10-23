// Boot for /observatory: the chrome's behaviour first, then one shared
// context, then the instruments in order of what the reader sees first. The
// chain pulse starts immediately and draws the river strip along the first
// screen's foot as well as its own plate; the lamp in the bar, the margin
// Spine and the hero's height listen to it, so they start right after it;
// the agent field, framed in the hero, and the last hour's row come next
// (the network graph is fetched only when its switch is turned on); the rest
// yield to the browser between them so the page never blocks on an
// instrument. Presenter mode (the P key or the Present button — never a URL
// flag) is wired last, once every section exists.

import { initChrome, createLamp } from '../chrome/behaviour/index.js';
import { createContext } from './context.js';
import * as pulse from './instruments/pulse.js';
import * as agentField from './instruments/agent-field.js';
import * as lastHour from './instruments/last-hour.js';
import * as messaging from './instruments/messaging.js';
import * as daybar from './daybar.js';
import * as economy from './instruments/economy.js';
import * as validators from './instruments/validator-ring.js';
import * as history from './instruments/history.js';
import * as upgrades from './instruments/upgrade-rail.js';
import * as posture from './instruments/posture.js';
import * as verify from './instruments/verify.js';
import * as spine from './spine.js';
import * as presenter from './presenter.js';
import * as hero from './hero.js';
import * as sources from './sources.js';
import { STALL_CHECK_MS } from './statusbar.js';
import { indexBehind } from './hour.js';

/** How often the lamp re-reads the index's position: the hour's own /v1/status cadence (hour.js), so the poll is shared. */
const LAMP_STATUS_MS = 30_000;

/** Each instrument and the element it draws into, in boot order. */
const INSTRUMENTS = [
  ['pulse', pulse, '#chain'],
  ['agent-field', agentField, '.hero'],
  ['last-hour', lastHour, '.hero'],
  ['messaging', messaging, '.hero'],
  ['daybar', daybar, '#economy'],
  ['economy', economy, '#economy'],
  ['validators', validators, '#validators'],
  ['history', history, '#history'],
  ['upgrades', upgrades, '#upgrades'],
  ['posture', posture, '#verify'],
  ['verify', verify, '#verify'],
];

function yieldToBrowser() {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 250 });
    else setTimeout(resolve, 0);
  });
}

/** Marks an instrument that threw during init: the failure is shown, not hidden. */
function markFailed(root, error) {
  console.error(error);
  const note = document.createElement('p');
  note.className = 'instrument-failed';
  note.setAttribute('role', 'alert');
  note.textContent = `This instrument could not start: ${error.message}`;
  root.querySelector('.instrument')?.replaceChildren(note);
}

/**
 * The lamp in the bar: lit only while the socket is open and the last block
 * is under 30 s old. Fed by the page bus — a head (live or polled), a
 * finalized head, the socket's state — and nothing else.
 */
function lamp(ctx) {
  const el = document.querySelector('[data-lamp]');
  if (!el) return null;
  const handle = createLamp(el);
  ctx.bus.on('head', ({ number }) => handle.update({ block: number }));
  ctx.bus.on('poll', ({ number, finalized }) => handle.update({ block: number, finalized: Number.isFinite(finalized) ? finalized : undefined }));
  ctx.bus.on('finalized', ({ number }) => handle.update({ finalized: number }));
  // Index behind (round 2 §4): the indexer's own report on /v1/status — finalized blocks it has not synced yet — shared with the hour's poll.
  ctx.watch(
    'status',
    (record) => {
      if (!record?.ok) return;
      try {
        handle.update({ indexBehind: indexBehind(record.data, ctx.field) });
      } catch {
        // A status body without the two heights says nothing about the index; the lamp keeps its last word.
      }
    },
    LAMP_STATUS_MS,
  );
  ctx.bus.on('socket', ({ state }) => {
    handle.update({ open: state === 'open' });
    // Disconnected: every live stub goes sage with `as of <UTC>`; the next read relights it.
    if (state !== 'open') ctx.readout.markStale(document);
  });
  return handle;
}

async function boot() {
  initChrome(document);
  const ctx = createContext();
  ctx.start();
  let river = null; // the chain pulse's handle: its tick re-reads the rate, so a stall is said without a new block

  for (const [name, instrument, selector] of INSTRUMENTS) {
    const root = document.querySelector(selector);
    if (!root) continue;
    try {
      if (name === 'pulse') river = instrument.init(root, ctx, { strip: document.querySelector('.hero-river') });
      else instrument.init(root, ctx);
    } catch (error) {
      markFailed(root, error);
    }
    if (name === 'pulse') {
      for (const start of [() => hero.init(document.querySelector('.hero'), ctx), () => spine.init(document, ctx), () => lamp(ctx)]) {
        try {
          start();
        } catch (error) {
          console.error(error);
        }
      }
      // A stalled chain emits no events, so the river cannot notice a stall
      // from events alone. main.js is the only module allowed to hold an
      // interval (see observatory.test.mjs), so the prompt lives here and
      // stops while the tab is hidden.
      if (river?.tick) {
        setInterval(() => {
          if (document.hidden) return;
          river.tick();
        }, STALL_CHECK_MS);
      }
      continue; // the first screen is first; everything else yields
    }
    await yieldToBrowser();
  }

  sources.init(document, ctx);
  presenter.init(document, ctx);
}


boot();
