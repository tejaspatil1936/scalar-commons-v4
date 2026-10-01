// Boot for /observatory: one shared context, then the instruments in order of
// what the reader sees first. The hero starts immediately; the rest yield to
// the browser between them so the page never blocks on an instrument. The
// status bar listens to the hero, so it starts right after it; the sky
// (`?sky=1`) and presenter mode (`?present=1`), when the URL asks for them,
// are wired last, once every section exists.

import { createContext } from './context.js';
import { relativeTime } from './format.js';
import * as pulse from './instruments/pulse.js';
import * as era from './instruments/era-dial.js';
import * as constellation from './instruments/constellation.js';
import * as validators from './instruments/validator-ring.js';
import * as history from './instruments/history.js';
import * as upgrades from './instruments/upgrade-rail.js';
import * as posture from './instruments/posture.js';
import * as verify from './instruments/verify.js';
import * as statusbar from './statusbar.js';
import * as presenter from './presenter.js';
import * as sky from './sky.js';

const INSTRUMENTS = [
  ['pulse', pulse],
  ['era', era],
  ['constellation', constellation],
  ['validators', validators],
  ['history', history],
  ['upgrades', upgrades],
  ['posture', posture],
  ['verify', verify],
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

async function boot() {
  const ctx = createContext();
  ctx.start();

  for (const [name, instrument] of INSTRUMENTS) {
    const root = document.querySelector(`[data-instrument="${name}"]`);
    if (!root) continue;
    try {
      instrument.init(root, ctx);
    } catch (error) {
      markFailed(root, error);
    }
    if (name === 'pulse') {
      try {
        const bar = statusbar.init(document.querySelector('[data-reading="networkStatus"]'), ctx);
        // A stalled chain emits no events, so the bar cannot notice a stall
        // from events alone. main.js is the only module allowed to hold an
        // interval (see observatory.test.mjs), so the prompt lives here and
        // stops while the tab is hidden.
        if (bar?.tick) {
          setInterval(() => {
            if (document.hidden) return;
            bar.tick();
          }, statusbar.STALL_CHECK_MS);
        }
      } catch (error) {
        console.error(error);
      }
      continue; // the hero is first; everything else yields
    }
    await yieldToBrowser();
  }

  lastMerge(ctx);
  try {
    // `?sky=1` only; off by default. A sky that cannot start must not take the page with it.
    sky.init(document, ctx);
  } catch (error) {
    console.error(error);
  }
  presenter.init(document, ctx);
}

/** "Last merge to master: N hours ago" — from the public GitHub API, retried each minute on failure. */
function lastMerge(ctx) {
  const target = ctx.reading('lastMerge');
  if (!target) return;
  let record = null;
  const render = () => {
    ctx.readout.apply(target, record, (data) => {
      const date = Date.parse(ctx.field(data, '0.commit.committer.date'));
      if (Number.isNaN(date)) throw new Error('commit date is not a date');
      ctx.readout.showValue(target, record, { value: relativeTime(date, ctx.now()) });
      const prov = target.querySelector('.reading-prov');
      const commit = document.createElement('a');
      commit.href = ctx.field(data, '0.html_url');
      commit.target = '_blank';
      commit.rel = 'noopener';
      commit.className = 'mono';
      commit.textContent = String(ctx.field(data, '0.sha')).slice(0, 7);
      prov.append(' · commit ', commit);
    });
  };
  const load = async () => {
    record = await ctx.fetch(ctx.SOURCES.lastMerge);
    render();
  };
  load();
  setInterval(() => {
    if (document.hidden) return;
    if (record?.ok) render();
    else load();
  }, 60_000);
}

boot();
