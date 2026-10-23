// The two retired addresses (SITE-REDESIGN.md §4): /observatory and /pulse
// became /network. Each is a plain page in the chrome that sends the browser
// on with a meta refresh and says where, with a link, for anyone whose
// browser does not follow it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderRedirect } from '../../src/network.mjs';
import { chromeCss as plainChrome } from '../../src/chrome/assets.mjs';

export const REDIRECTS = [
  { file: 'observatory.html', path: '/observatory', title: 'Observatory', to: '/network', label: 'Network' },
  { file: 'pulse.html', path: '/pulse', title: 'Pulse', to: '/network#activity', label: 'Network: activity' },
];

export default async function buildRedirects({ outDir, facts, transform }) {
  const css = (await transform(plainChrome(), { loader: 'css', minify: true })).code.trim();
  for (const r of REDIRECTS) writeFileSync(join(outDir, r.file), renderRedirect({ ...r, facts, css, builtAt: new Date().toISOString() }));
  console.log(`built ${REDIRECTS.map((r) => r.file).join(', ')} (redirects to /network)`);
}
