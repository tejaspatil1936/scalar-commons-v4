// 05 · History strips. NOT YET BUILT — this stub keeps the bundle whole and
// shows an honest placeholder until the instrument is implemented.
export function init(root, ctx) {
  for (const key of ['blockTime', 'agreementsPerEra', 'emissionPerEra', 'agentsOverTime']) {
    ctx.readout.showAbsent(ctx.reading(key, root), null, 'instrument not yet built');
  }
}
