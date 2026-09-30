// Presenter mode: `/observatory?present=1`. The page keeps every instrument
// live and shows one at a time, each filling the viewport, advancing every
// ADVANCE_MS or on the arrow keys. The nav, the provenance lines and the
// footer are hidden by the stylesheet (`html[data-present]`); the status bar
// stays, since it is the one line a room needs to see. Nothing here fetches:
// the instruments run exactly as they do on the ordinary page.
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
    case ' ':
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

export function init(doc, ctx) {
  const html = doc.documentElement;
  if (!html.hasAttribute('data-present')) return null;
  const sections = [...doc.querySelectorAll('main > section.instrument-section')];
  if (sections.length === 0) return null;

  const counter = doc.createElement('p');
  counter.className = 'present-counter mono';
  counter.setAttribute('aria-live', 'off');
  doc.body.append(counter);

  let index = 0;
  let timer = null;

  function arm() {
    clearTimeout(timer);
    timer = null;
    if (doc.hidden) return;
    timer = setTimeout(() => show((index + 1) % sections.length), ADVANCE_MS);
  }

  function show(next) {
    index = next;
    sections.forEach((section, k) => {
      const active = k === index;
      section.toggleAttribute('data-present-active', active);
      section.setAttribute('aria-hidden', active ? 'false' : 'true');
      if (active) {
        // Anything collapsed on the ordinary page is open on a screen nobody can click.
        for (const details of section.querySelectorAll('details')) details.open = true;
        section.scrollTop = 0;
      }
    });
    const heading = sections[index].querySelector('h2')?.textContent ?? '';
    counter.textContent = `${index + 1} / ${sections.length}`;
    ctx?.announce?.(`Showing ${heading}`);
    arm();
  }

  doc.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = stepFor(event.key, index, sections.length);
    if (next === null) return;
    event.preventDefault();
    show(next);
  });

  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) {
      clearTimeout(timer);
      timer = null;
    } else arm();
  });

  show(0);
  return { show, next: () => show((index + 1) % sections.length), current: () => index };
}
