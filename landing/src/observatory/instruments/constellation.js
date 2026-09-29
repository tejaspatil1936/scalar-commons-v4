// 03 · Agent constellation. NOT YET BUILT — this stub keeps the bundle whole
// and shows an honest placeholder until the instrument is implemented.
export function init(root, ctx) {
  const note = root.querySelector('.constellation-note');
  if (note) note.textContent = 'Constellation: not yet built.';
  for (const key of ['agents', 'activeAgreements', 'openDisputes', 'slashes', 'messages']) {
    ctx.readout.showAbsent(ctx.reading(key, root), null, 'instrument not yet built');
  }
}
