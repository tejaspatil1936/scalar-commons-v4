// Presenter mode: `/observatory?present=1`. The page keeps every instrument
// live and shows one screen at a time over the sky, each filling the
// viewport, advancing every ADVANCE_MS or on the arrow keys; space pauses
// the advance and Escape leaves presenter mode in place. The first screen is
// the hero — the wordmark, the block height, the agents working now — and
// each one after it is one instrument with its figures set for a room. The
// nav, the provenance lines and the footer are hidden by the stylesheet
// (`html[data-present]`); the status bar stays, since it is the one line a
// room needs to see. Nothing here fetches: the instruments run exactly as
// they do on the ordinary page.
//
// The timer is one setTimeout re-armed after each advance, cleared while the
// tab is hidden, so a projector left on a hidden tab does nothing until it
// is shown again.

export const ADVANCE_MS = 20_000;

/** Whether the URL asks for presenter mode. Pure; tested. */
export function wantsPresenter(search) {
  return /(?:^\?|[?&])present=1(?:&|$)/.test(search ?? '');
}

/** The next index after a key, or null when the key is not one of ours. Pure; tested. */
export function stepFor(key, index, count) {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case 'Enter':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * What a key asks for: `{ go }` to a screen, `{ pause }` to toggle the
 * advance (space), `{ exit }` to leave presenter mode (Escape); null when the
 * key is not ours. Pure; tested.
 */
export function keyAction(key, index, count) {
  if (key === 'Escape') return { exit: true };
  if (key === ' ') return { pause: true };
  const go = stepFor(key, index, count);
  return go === null ? null : { go };
}

export function init(doc, ctx) {
  const html = doc.documentElement;
  if (!html.hasAttribute('data-present')) return null;
  const screens = [...doc.querySelectorAll('[data-present-screen]')];
  if (screens.length === 0) return null;

  const counter = doc.createElement('p');
  counter.className = 'present-counter mono';
  counter.setAttribute('aria-live', 'off');
  doc.body.append(counter);

  let index = 0;
  let timer = null;
  let paused = false;

  function arm() {
    clearTimeout(timer);
    timer = null;
    if (doc.hidden || paused) return;
    timer = setTimeout(() => show((index + 1) % screens.length), ADVANCE_MS);
  }

  function count() {
    counter.textContent = `${index + 1} / ${screens.length}${paused ? ' · paused' : ''}`;
  }

  function show(next) {
    index = next;
    screens.forEach((screen, k) => {
      const active = k === index;
      screen.toggleAttribute('data-present-active', active);
      screen.setAttribute('aria-hidden', active ? 'false' : 'true');
      if (active) {
        // A list or a command set collapsed on the ordinary page is open on a
        // screen nobody can click; the explanations and footnotes stay folded,
        // since a room reads the figures.
        for (const details of screen.querySelectorAll('details:not(.means):not(.notes)')) details.open = true;
        screen.scrollTop = 0;
      }
    });
    const heading = screens[index].querySelector('h2, h1')?.textContent ?? '';
    count();
    ctx?.announce?.(`Showing ${heading}`);
    arm();
  }

  function pause() {
    paused = !paused;
    count();
    ctx?.announce?.(paused ? 'Paused' : 'Advancing');
    arm();
  }

  /** Leaves presenter mode in place: the ordinary page returns, the URL loses its flag, nothing reloads. */
  function exit() {
    clearTimeout(timer);
    timer = null;
    doc.removeEventListener('keydown', onKey);
    for (const screen of screens) {
      screen.removeAttribute('data-present-active');
      screen.removeAttribute('aria-hidden');
    }
    html.removeAttribute('data-present');
    counter.remove();
    const win = doc.defaultView;
    try {
      const url = new URL(win.location.href);
      url.searchParams.delete('present');
      win.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // No history to rewrite (a document without a window): the attribute is gone, which is what matters.
    }
    ctx?.announce?.('Presenter mode off');
  }

  function onKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const action = keyAction(event.key, index, screens.length);
    if (action === null) return;
    event.preventDefault();
    if (action.exit) exit();
    else if (action.pause) pause();
    else show(action.go);
  }
  doc.addEventListener('keydown', onKey);

  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) {
      clearTimeout(timer);
      timer = null;
    } else arm();
  });

  show(0);
  return { show, next: () => show((index + 1) % screens.length), current: () => index, pause, exit, paused: () => paused };
}
