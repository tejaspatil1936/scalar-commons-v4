// Whether a recorded endpoint is one a visitor's browser may be asked to reach.
//
// The record names the node it was read from. When that is a public https://
// or wss:// address the page re-reads every message from it in the browser;
// when it is anything else — plain http://, a loopback or private address, a
// bare host name — the page shows the recorded values and says so, and never
// tries. A page served to the public must not open connections to 127.0.0.1
// (SITE-REDESIGN.md Appendix A, item 23). Pure: no DOM, no network, shared by
// the renderer and the page script so the two can never disagree about which
// case they are in.

const PRIVATE_HOST = /^(?:localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

/** True for a public https:// or wss:// URL; false for anything a visitor could not reach. */
export function isPublicEndpoint(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  // A single-label name (a LAN host, a container) is not a public address either.
  if (!host.includes('.') && !host.includes(':')) return false;
  return !PRIVATE_HOST.test(host);
}
