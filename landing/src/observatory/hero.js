// The first screen's block height: the left of its three figures. The other
// two — agents registered and agreements open — are the constellation's
// readings, since the constellation (framed beside them) makes those reads.
// Nothing here fetches on its own schedule: the height is the chain pulse's
// head, carried on the page bus with its record, live (`head`) or polled
// (`poll`), and shown with that record like any other reading. A failed read
// replaces the figure with "unavailable" and its reason; nothing is kept.

export function init(root, ctx) {
  if (!root) return null;
  const height = ctx.reading('heroHeight', root);
  const onNumber = ({ record, number }) => {
    if (!height) return;
    if (!record?.ok) {
      ctx.readout.showError(height, record);
      return;
    }
    if (Number.isFinite(number)) ctx.readout.showValue(height, record, { value: number, motion: ctx.motion });
  };
  ctx.bus.on('head', onNumber);
  ctx.bus.on('poll', onNumber);
  return { height };
}
