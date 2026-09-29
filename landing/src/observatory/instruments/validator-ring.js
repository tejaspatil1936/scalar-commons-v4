// 04 · Validator ring. NOT YET BUILT — this stub keeps the bundle whole and
// shows an honest placeholder until the instrument is implemented.
export function init(root, ctx) {
  const note = root.querySelector('.ring-note');
  if (note) note.textContent = 'Validator ring: not yet built.';
  for (const key of ['validators', 'nodeHealth']) {
    ctx.readout.showAbsent(ctx.reading(key, root), null, 'instrument not yet built');
  }
}
