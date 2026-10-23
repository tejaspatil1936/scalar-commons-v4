// The margin Spine: one horizontal tick per block, newest on top, on the
// chrome's dotted rail. Fed by the page bus — a head as it arrives (live or
// polled) and the finalized head — and redrawn on nothing else. The newest
// tick is the one lit thing; ticks at or below the finalized head turn sage;
// every tenth block carries its number. A hidden tab adds nothing; on return
// the next head rebuilds the top of the column.

export const TICKS = 100;

export function init(doc, ctx) {
  const spine = doc.querySelector('[data-spine]');
  if (!spine) return null;
  const { formatInteger } = ctx.format;
  let finalized = null;

  const markFinal = () => {
    if (finalized === null) return;
    for (const li of spine.children) {
      if (Number(li.dataset.block) <= finalized) li.classList.add('is-final');
    }
  };

  const onHead = ({ number }) => {
    if (!Number.isFinite(number) || doc.hidden) return;
    const top = spine.firstElementChild;
    if (top && Number(top.dataset.block) >= number) return;
    const li = doc.createElement('li');
    li.className = 'nw-spine-tick is-newest';
    li.dataset.block = String(number);
    if (number % 10 === 0) {
      const label = doc.createElement('span');
      label.className = 'nw-spine-number nw-label';
      label.textContent = formatInteger(number);
      li.append(label);
    }
    top?.classList.remove('is-newest');
    spine.prepend(li);
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
