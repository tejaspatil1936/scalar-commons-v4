// The pure parts of the page's wiring, kept apart from main.js so they can be
// tested without a window: the device-pixel ceiling, an agent's role from the
// open agreements, and the banner's words for each state of the feed.

/**
 * The most device pixels this page draws per CSS pixel. force-graph sizes
 * its canvas by window.devicePixelRatio; a 3× phone would push every frame
 * of 2,000 nodes through nine times the pixels of 1×, for detail no eye
 * sees in a moving field. Two is the ceiling, set before the graph is made.
 */
export const MAX_DPR = 2;

export function capDevicePixelRatio(win, max = MAX_DPR) {
  const real = win.devicePixelRatio || 1;
  if (real <= max) return real;
  try {
    Object.defineProperty(win, 'devicePixelRatio', { get: () => max, configurable: true });
  } catch (error) {
    console.error(error);
  }
  return max;
}

/** What an agent does, from the open agreements: provider if it provides in any, buyer if it buys, else agent. */
export function roleOf(address, links) {
  let buys = false;
  for (const link of links) {
    if (link.provider === address) return 'provider';
    if (link.buyer === address) buys = true;
  }
  return buys ? 'buyer' : 'agent';
}

/** The banner's words for a feed state; empty when the feed is live. */
export function bannerText({ state, reason, head, indexed }, formatInteger = String) {
  if (state === 'unavailable') return `live feed unavailable — ${reason ?? 'no source answered'}`;
  if (state === 'stale') {
    const behind = Number.isFinite(head) && Number.isFinite(indexed) ? head - indexed : null;
    return behind === null
      ? `live feed paused — ${reason ?? 'the index is behind the chain'}`
      : `live feed paused — the index is ${formatInteger(behind)} blocks behind the chain`;
  }
  return '';
}
