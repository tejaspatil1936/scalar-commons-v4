// Figures never collide and never wrap (round-2 contract §2.5). A row of
// Readings already takes one figure size from how many share it; when a live
// figure still outgrows its column, the whole row drops one size step
// (data-step="1"), so every figure in it stays on one baseline at one size.
// Checked after each figure changes and on resize; nothing is measured on a
// script-free page, whose as-built figures are sized to fit at build time.
const overflows = (row) =>
  [...row.querySelectorAll('.nw-reading-figure')].some((fig) => {
    const column = fig.closest('.nw-reading') ?? fig.parentElement;
    return fig.scrollWidth > column.clientWidth + 1;
  });

export function fitRow(row) {
  if (row.dataset.step === '1') {
    row.removeAttribute('data-step');
    if (!overflows(row)) return false;
  }
  if (overflows(row)) {
    row.dataset.step = '1';
    return true;
  }
  return false;
}

export function initFit(root = document) {
  const rows = [...root.querySelectorAll('.nw-row')].filter((r) => r.querySelector('.nw-reading-figure'));
  if (!rows.length || typeof MutationObserver === 'undefined') return null;
  let pending = false;
  const all = () => {
    pending = false;
    rows.forEach(fitRow);
  };
  const soon = () => {
    if (pending) return;
    pending = true;
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(all);
  };
  const observer = new MutationObserver(soon);
  for (const row of rows) observer.observe(row, { childList: true, characterData: true, subtree: true });
  root.defaultView?.addEventListener?.('resize', soon);
  globalThis.addEventListener?.('resize', soon);
  soon();
  return { stop: () => observer.disconnect() };
}
