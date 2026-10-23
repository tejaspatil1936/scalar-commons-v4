// A live figure that changed: only the digits that changed warm and cool. No
// odometer, no tween. Each character is a span so the comparison is per digit.
export function setFigure(el, next, { reduced = false } = {}) {
  const text = String(next);
  const prev = el.getAttribute('data-text') ?? '';
  el.setAttribute('data-text', text);
  const spans = text.split('').map((ch, i) => {
    const changed = prev !== '' && prev[prev.length - text.length + i] !== ch;
    return `<span class="nw-digit${changed && !reduced ? ' is-warm' : ''}">${ch === ' ' ? '&nbsp;' : ch}</span>`;
  });
  el.innerHTML = spans.join('');
  if (!reduced) requestAnimationFrame(() => setTimeout(() => el.querySelectorAll('.is-warm').forEach((s) => s.classList.remove('is-warm')), 120));
}
