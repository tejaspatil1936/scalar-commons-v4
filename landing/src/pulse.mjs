// /pulse — the page frame, as a string, in the Ledger chrome. One screen
// at 1440×900 with nothing below the bottom strip and no footer: the top bar
// with Pulse current and the lamp, three Readings, the Waterfall with the
// feed at its right, the legend row, and the bottom strip (Height · Finalized
// · Era, the disclaimer, F fullscreen). Every figure slot is an empty live
// Reading the script fills with its provenance; the page ships no number of
// its own, and every sentence on it is the brief's, model.js's or the chain's.

import { DISCLAIMER, band, head, reading, topBar, utc, escapeHtml } from './chrome-legacy/templates.mjs';
import { API_ORIGIN, SOURCES } from './observatory/data.js';
import { EVENTS } from './pulse/model.js';
import { EXTRA } from './pulse/strip.js';

export { DISCLAIMER };
/** The page's one-sentence description: the caption the page has always carried, true of every glyph the Waterfall draws. */
export const CAPTION = 'Every light is a real transaction on the Scalar Commons test network.';

/** The legend: one glyph per kind that draws, named by model.js's own words (oracle answers come from two events, one name). */
export const LEGEND = EVENTS.filter((row) => row.kind !== 'resolved')
  .filter((row, i, all) => all.findIndex((r) => r.kind === row.kind) === i)
  .map((row) => [row.kind, row.describe]);

/** The three figures, in order: key, label (brief §5.3), the source they are counted from. */
export const FIGURES = [
  ['activeAgents', 'Agents active in the last ten minutes', 'messagesSent'],
  ['eventsPerMinute', 'Events in the last minute', 'messagesSent'],
  ['messagesHour', 'Messages in the last hour', 'messagesSent'],
];

/** The bottom strip's three, in order: key, label, source. */
export const STRIP = [
  ['bestBlock', 'Height', 'status'],
  ['finalizedBlock', 'Finalized', 'status'],
  ['era', 'Era', 'era'],
];

/** The words the noscript band says, around the build's UTC. */
export const SCRIPTS_OFF = (builtAt) => `Scripts are off. Every figure on this page is from the build, ${utc(builtAt)}, and carries its source. Nothing will move.`;

/** A Reading's source from data.js: the declared endpoint; the live page fills the time and block. */
export function sourceOf(name, computed = null) {
  const declared = SOURCES[name];
  if (!declared || declared.kind !== 'api') throw new Error(`pulse: "${name}" is not an api source in data.js`);
  return { method: 'GET', url: `${API_ORIGIN}${declared.path}`, fetchedAt: null, block: null, raw: null, computed };
}

function readings() {
  return FIGURES.map(([key, label, source]) => reading({ key, label, size: 'm', live: true, stack: true, state: 'connecting', source: sourceOf(source, EXTRA[key]), className: 'pulse-figure' })).join('\n');
}

function stage() {
  return `  <div class="pulse-stage">
    <figure class="pulse-waterfall" id="waterfall">
      <div class="pulse-band" data-band hidden>${band({ text: '' })}</div>
      <canvas class="pulse-canvas" data-waterfall aria-hidden="true"></canvas>
    </figure>
    <aside class="pulse-feed" aria-labelledby="feed-h">
      <h2 class="pulse-feed-head nw-label" id="feed-h"><span class="nw-lamp-dot" data-feed-dot aria-hidden="true"></span>LIVE</h2>
      <p class="pulse-feed-note nw-small" data-feed-note hidden></p>
      <ol class="pulse-feed-lines nw-small" data-feed-lines aria-live="polite"></ol>
    </aside>
  </div>`;
}

function legend() {
  const items = LEGEND.map(([kind, name]) => `      <li><canvas class="pulse-legend-glyph" data-legend="${escapeHtml(kind)}" width="24" height="12" aria-hidden="true"></canvas>${escapeHtml(name)}</li>`).join('\n');
  return `  <ul class="pulse-legend nw-label" aria-label="Legend">
${items}
      <li class="pulse-operators" data-operators></li>
  </ul>`;
}

function strip() {
  const left = STRIP.map(([key, label, source]) => reading({ key, label, size: 'm', live: true, state: 'connecting', source: sourceOf(source), className: 'pulse-strip-reading' })).join('\n');
  return `  <footer class="pulse-strip">
    <div class="nw-row pulse-strip-left">
${left}
    </div>
    <div class="pulse-strip-right">
      <p class="nw-small pulse-disclaimer">${DISCLAIMER}</p>
      <button type="button" class="nw-quiet pulse-fullscreen" aria-pressed="false" aria-keyshortcuts="F">F fullscreen</button>
    </div>
  </footer>`;
}

/** The whole page, as a string. `css` is the assembled stylesheet to inline; `facts` is chain-facts.json (the build's UTC). */
export function renderPulse({ css = null, facts }) {
  const builtAt = facts?.provenance?.fetchedAt;
  if (!builtAt) throw new Error('pulse: chain-facts.json names no provenance.fetchedAt for the scripts-off band');
  return `<!doctype html>
<html lang="en">
<head>
${head({
  title: 'Pulse — Scalar Commons',
  description: CAPTION,
  css,
  scripts: ['pulse.js'],
})}
</head>
<body class="pulse-body">
${topBar({ current: 'pulse' })}
<noscript>${band({ text: SCRIPTS_OFF(builtAt) })}</noscript>
<main class="pulse" aria-labelledby="pulse-h">
  <h1 class="nw-visually-hidden" id="pulse-h">Pulse</h1>
  <section class="nw-row pulse-readings" aria-label="Now">
${readings()}
  </section>
${stage()}
${legend()}
${strip()}
</main>
<p class="sr-status nw-visually-hidden" aria-live="polite"></p>
</body>
</html>
`;
}
