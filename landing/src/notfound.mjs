// /404 — "Nothing is logged at this address." Three Readings: the path the
// reader asked for (filled in the browser from location.pathname), the closest
// built page by edit distance (from the route list the build embeds; omitted
// when nothing is close), and the way out. The words are the brief's; every
// figure is a Reading with its source.
import { band, footer, head, reading, topBar } from './chrome/templates.mjs';

export const SENTENCE = 'Nothing is logged at this address.';

/** Every path the build serves, for the closest-page reading. */
export const ROUTES = ['/', '/observatory', '/pulse', '/faucet', '/oversight', '/docs/', '/status.json', '/posture.json'];

export function renderNotFound({ facts, css, routes = ROUTES }) {
  const now = facts.provenance.fetchedAt;
  const client = { method: 'CLIENT', url: 'location.pathname', fetchedAt: null, block: null, raw: null };
  const built = { method: 'BUILD', url: 'the built route list', fetchedAt: now, block: facts.provenance.readAtBlock, raw: null, computed: 'the nearest route by edit distance' };
  return `<!doctype html>
<html lang="en">
<head>
${head({ title: 'Not found — Scalar Commons', description: SENTENCE, css, scripts: ['404.js'], boot: true })}
</head>
<body>
${topBar({ current: 'none' })}
<main class="nw-frame nw-section" data-routes="${routes.join(' ')}">
  <p class="nw-figure nw-figure--xl nw-dim">404</p>
  <p class="nw-h3">${SENTENCE}</p>
  <div class="nw-stack nw-notfound">
${reading({ key: 'askedFor', label: 'You asked for', figure: null, live: true, size: 'body', state: 'live', source: client })}
${reading({ key: 'closest', label: 'Closest page', figure: null, live: true, size: 'body', state: 'record', source: built })}
${reading({ key: 'or', label: 'Or', figure: 'search the docs · ⌘K', size: 'body', href: 'https://scalarnet.io/docs/', state: 'record', source: { method: 'LINK', url: 'https://scalarnet.io/docs/', fetchedAt: now, block: facts.provenance.readAtBlock, raw: null } })}
  </div>
  <noscript>${band({ text: `Scripts are off. Every figure on this page is from the build, ${now}, and carries its source. Nothing will move.` })}</noscript>
</main>
${footer({ facts: { genesisHash: facts.provenance.genesisHash, specVersion: facts.provenance.specVersion, nodeVersion: facts.provenance.nodeVersion ?? null, builtAt: now, block: facts.provenance.readAtBlock } })}
</body>
</html>
`;
}
