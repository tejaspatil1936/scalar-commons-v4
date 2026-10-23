// The feed at the right of /pulse: the accessible version of the Waterfall.
// Every live event as one plain sentence, newest first, eight kept, each
// exactly the sentence + a link to its block on the explorer + "n s ago". The
// sentences are the model's (tested word for word); this file only puts them
// on the page in order of when they happened, keeps their ages current, and
// says so when the feed is down or the swarm is quiet. The list is a real
// `<ol aria-live="polite">`, throttled to one announcement per 30 s: after an
// announced line the list goes `aria-live="off"` until the half minute has
// passed, so a busy block is read as one line, not thirty. Nothing is written
// here that the chain did not do: no sample lines, no filler.

import { ageText, explorerHref, sentence } from './model.js';
import { formatInteger } from '../observatory/format.js';
import { feedDown } from './wiring.js';

/** How many lines the feed keeps, newest first. */
export const FEED_LINES = 8;
/** One announcement per half minute. */
export const ANNOUNCE_MS = 30_000;

/** The words under the heading while nothing has happened for an hour: the brief's, around the last block. */
export const quietText = (lastBlock) => `no agent events in the last hour · last at block ${formatInteger(lastBlock)}`;

export function init(root, ctx, feed) {
  const list = root.querySelector('[data-feed-lines]');
  const note = root.querySelector('[data-feed-note]');
  const lines = []; // newest first: { li, age, at, parties }
  let downReason = null; // while the feed is unavailable or behind the chain
  let quietBlock = null; // the last event's block while the swarm is quiet
  let announcedAt = null; // when the list last spoke

  function render() {
    const now = ctx.now();
    for (const line of lines) line.age.textContent = ageText(line.at, now);
    if (announcedAt !== null && now - announcedAt >= ANNOUNCE_MS && list.getAttribute('aria-live') !== 'polite') list.setAttribute('aria-live', 'polite');
    if (!note) return;
    if (downReason) {
      note.hidden = false;
      note.textContent = `live feed unavailable — ${downReason}`;
    } else if (quietBlock !== null) {
      note.hidden = false;
      note.textContent = quietText(quietBlock);
    } else {
      note.hidden = true;
      note.textContent = '';
    }
  }

  /** Adds a line where its instant belongs: newest first, whether it arrives live or from the index's record. */
  function push({ event, row, parties, at }) {
    const li = document.createElement('li');
    li.dataset.kind = row.kind;
    const text = document.createElement('span');
    text.textContent = sentence(event, feed.names(), ctx.format.formatCmn);
    const a = document.createElement('a');
    a.className = 'nw-quiet';
    a.href = explorerHref(event);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `block ${formatInteger(event.blockNumber)}`;
    const age = document.createElement('span');
    age.className = 'pulse-feed-age';
    li.append(text, ' · ', a, ' · ', age);
    const index = lines.findIndex((line) => line.at <= at);
    const now = ctx.now();
    if (list.getAttribute('aria-live') === 'polite') announcedAt = now;
    if (index === -1) {
      list.append(li);
      lines.push({ li, age, at, parties });
    } else {
      list.insertBefore(li, lines[index].li);
      lines.splice(index, 0, { li, age, at, parties });
    }
    while (lines.length > FEED_LINES) lines.pop().li.remove();
    // The next line within the half minute is shown, not spoken.
    list.setAttribute('aria-live', 'off');
    render();
  }

  feed.on('status', (status) => {
    downReason = feedDown(status.state) ? (status.reason ?? 'no source answered') : null;
    render();
  });

  render();
  return {
    push,
    tick: render,
    /** The quiet state: null ends it, a block number says where the last event was. */
    quiet(lastBlock) {
      quietBlock = lastBlock ?? null;
      render();
    },
    count: () => lines.length,
  };
}
