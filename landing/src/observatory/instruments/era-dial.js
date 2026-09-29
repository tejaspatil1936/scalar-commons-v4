// 02 · Era dial. NOT YET BUILT — this stub keeps the bundle whole and shows
// an honest placeholder until the instrument is implemented.
export function init(root, ctx) {
  const dial = root.querySelector('[data-role="dial"]');
  if (dial) dial.textContent = 'Era dial: not yet built.';
  for (const key of ['era', 'eraSettlement', 'eraCountdown', 'lastSettled']) {
    ctx.readout.showAbsent(ctx.reading(key, root), null, 'instrument not yet built');
  }
}
