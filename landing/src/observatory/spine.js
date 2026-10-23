// The margin Spine: one horizontal tick per block, newest on top, on the
// chrome's dotted rail. Fed by the page bus — a head as it arrives (live or
// polled) and the finalized head — and redrawn on nothing else. The newest
// tick is the one lit thing; ticks at or below the finalized head turn sage;
// every tenth block carries its number. A hidden tab adds nothing; on return
// the next head rebuilds the top of the column.
//
// Each tick names its author, resolved from the block's own BABE pre-runtime
// digest (scale.js babePreDigestOf, decoded once by pulse.js and carried on
// the head bus): the authority index, the slot and the claim kind, on the
// tick's title and data-author, and the newest one in the Spine's label.
// Motion (brief §4): a new tick is born at 0 and warms (the chrome's
// is-born), and the column shifts down one pitch over --t-shift; under
// reduced motion it appears in place.

export const TICKS = 100;
/** The presenter's comb: 240 ticks across 1,600 px, newest at the right. */
export const COMB_TICKS = 240;

/** The comb Spine, fed by the same bus: a tick appended at the right per block, final ticks marked, nothing else. */
function initComb(doc, ctx) {
  const comb = doc.querySelector('[data-spine-comb]');
  if (!comb) return null;
  let finalized = null;
  const markFinal = () => {
    if (finalized === null) return;
    for (const li of comb.children) if (Number(li.dataset.block) <= finalized) li.classList.add('is-final');
  };
  const onHead = ({ number }) => {
    if (!Number.isFinite(number) || doc.hidden) return;
    const last = comb.lastElementChild;
    if (last && Number(last.dataset.block) >= number) return;
    const li = doc.createElement('li');
    li.className = 'nw-spine-tick is-newest';
    li.dataset.block = String(number);
    last?.classList.remove('is-newest');
    comb.append(li);
    while (comb.children.length > COMB_TICKS) comb.firstElementChild.remove();
    markFinal();
  };
  ctx.bus.on('head', onHead);
  ctx.bus.on('poll', onHead);
  ctx.bus.on('finalized', ({ number }) => {
    if (!Number.isFinite(number)) return;
    finalized = number;
    markFinal();
  });
  return comb;
}

export function init(doc, ctx) {
  initComb(doc, ctx);
  const spine = doc.querySelector('[data-spine]');
  if (!spine) return null;
  const { formatInteger } = ctx.format;
  const baseLabel = spine.getAttribute('aria-label') ?? '';
  let finalized = null;

  const markFinal = () => {
    if (finalized === null) return;
    for (const li of spine.children) {
      if (Number(li.dataset.block) <= finalized) li.classList.add('is-final');
    }
  };

  /** "block 1,163,442 · BABE authority 3 · primary slot 293,912,345", from the pre-digest; null when the head carried none. */
  const authorLine = (number, author) =>
    author && Number.isInteger(author.authorityIndex)
      ? `block ${formatInteger(number)} · BABE authority ${formatInteger(author.authorityIndex)} · ${author.kind} slot ${formatInteger(author.slot)}`
      : null;

  const onHead = ({ number, author = null }) => {
    if (!Number.isFinite(number) || doc.hidden) return;
    const top = spine.firstElementChild;
    if (top && Number(top.dataset.block) >= number) return;
    const li = doc.createElement('li');
    const reduced = Boolean(ctx.motion?.reduced?.());
    li.className = `nw-spine-tick is-newest${reduced ? '' : ' is-born'}`;
    li.dataset.block = String(number);
    const line = authorLine(number, author);
    if (line) {
      li.dataset.author = String(author.authorityIndex);
      li.title = line;
      spine.setAttribute('aria-label', `${baseLabel}; newest ${line}`);
    }
    if (number % 10 === 0) {
      const label = doc.createElement('span');
      label.className = 'nw-spine-number nw-label';
      label.textContent = formatInteger(number);
      li.append(label);
    }
    top?.classList.remove('is-newest');
    if (!reduced && top) {
      // Shift one pitch: start where the column was, then ease down by the new tick's height.
      spine.classList.add('is-shifting');
      spine.prepend(li);
      void spine.offsetHeight;
      spine.classList.remove('is-shifting');
    } else {
      spine.prepend(li);
    }
    if (!reduced && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => li.classList.remove('is-born'));
    else li.classList.remove('is-born');
    while (spine.children.length > TICKS) spine.lastElementChild.remove();
    markFinal();
  };

  ctx.bus.on('head', onHead);
  ctx.bus.on('poll', onHead);
  ctx.bus.on('finalized', ({ number }) => {
    if (!Number.isFinite(number)) return;
    finalized = number;
    markFinal();
  });
  return { spine };
}
