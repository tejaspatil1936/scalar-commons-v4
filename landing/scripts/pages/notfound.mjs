// /404 (SITE-REDESIGN.md §5.4): one page, no script file. nginx serves it at
// any unknown path (`error_page 404 /404.html`), so the inlined chrome's font
// URLs are made absolute. The `chromeCss` the build loop passes is the
// transitional Ledger chrome and is ignored: this page imports the plain one.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderNotFound } from '../../src/notfound.mjs';
import { inlineChrome } from './faucet.mjs';

export default async function buildNotFound({ outDir, facts, transform }) {
  const css = await inlineChrome(transform);
  writeFileSync(join(outDir, '404.html'), renderNotFound({ facts, css, builtAt: new Date().toISOString() }));
  console.log(`built ${outDir}/404.html`);
}
