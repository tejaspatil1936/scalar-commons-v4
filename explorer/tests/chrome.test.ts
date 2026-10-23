import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createIndexerReader } from '../src/activity.js';
import type { ExplorerChain } from '../src/chain.js';
import * as explorer from '../src/chrome-templates.js';
import { createExplorerServer, defaultChromeDir, readChromeStylesheet } from '../src/server.js';
import { parseRoute } from '../src/routes.js';
import type { ChainInfo, HomeView } from '../src/types.js';

/**
 * The explorer's chrome is a mirror of the landing's (SITE-REDESIGN.md §3):
 * `chrome-templates.ts` must produce the same markup and class names as
 * `landing/src/chrome/templates.mjs`, from the same inputs, so `chrome.css`
 * draws both the same. The landing module is the reference and is imported
 * as is; nothing about the chrome is asserted twice.
 */

const landingPath = fileURLToPath(new URL('../../landing/src/chrome/templates.mjs', import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Templates = Record<string, (...args: any[]) => string> & { ICONS: string[]; BADGES: Record<string, string>; DISCLAIMER: string };
let landing: Templates;
beforeAll(async () => {
  landing = (await import(landingPath)) as Templates;
});

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const AT = '2026-10-23T12:00:00.000Z';
const facts = { provenance: { specName: 'scalar-commons', specVersion: 309, readAtBlock: 1166072 } };
const SITE = 'https://scalarnet.io';

const CHAIN: ChainInfo = {
  chain: 'Scalar Commons Local Testnet',
  specName: 'scalar-commons',
  specVersion: 309,
  tokenSymbol: 'CMN',
  tokenDecimals: 12,
  ss58Format: 42,
  genesisHash: `0x${'ff'.repeat(32)}`,
};

describe('chrome-templates.ts mirrors landing/src/chrome/templates.mjs, markup for markup', () => {
  it('renders the same header, footer, head and page from the same inputs', () => {
    expect(explorer.header({ current: 'explorer', site: SITE })).toBe(landing.header!({ current: 'explorer', site: SITE }));
    expect(explorer.footer({ facts, builtAt: AT, site: SITE })).toBe(landing.footer!({ facts, builtAt: AT, site: SITE }));
    const headOpts = { title: 'Blocks', description: 'The blocks.', path: '/blocks', cssHref: '/chrome.css', scripts: ['/chrome.js'], origin: explorer.EXPLORER_ORIGIN };
    expect(explorer.head(headOpts)).toBe(landing.head!(headOpts));
    const pageOpts = { ...headOpts, current: 'explorer', site: SITE, facts, builtAt: AT, body: '<p>x</p>' };
    expect(explorer.page(pageOpts)).toBe(landing.page!(pageOpts));
  });

  it('renders every component the same: buttons, cards, stats, tables, badges, tabs, chips, search, code, callouts, pagination, addresses, breadcrumbs, icons', () => {
    expect(explorer.button({ text: 'Next', href: '/blocks?offset=25', variant: 'secondary' })).toBe(landing.button!({ text: 'Next', href: '/blocks?offset=25', variant: 'secondary' }));
    expect(explorer.button({ text: 'View all', href: '/blocks', variant: 'text' })).toBe(landing.button!({ text: 'View all', href: '/blocks', variant: 'text' }));
    expect(explorer.card({ title: 'Agent', body: 'x', action: { text: 'Go', href: '/' } })).toBe(landing.card!({ title: 'Agent', body: 'x', action: { text: 'Go', href: '/' } }));
    const statsIn = [{ label: 'Block height', value: '1,166,072', caption: 'x', key: 'height' }, { label: 'Finalized', value: null }];
    expect(explorer.stats(statsIn, { label: 'Now' })).toBe(landing.stats!(statsIn, { label: 'Now' }));
    const tableIn = { columns: [{ label: 'Block' }, { label: 'Extrinsics', align: 'right' as const }], rows: [['1', '2']], caption: 'Blocks', id: 't' };
    expect(explorer.table(tableIn)).toBe(landing.table!(tableIn));
    expect(explorer.table({ ...tableIn, rows: [], empty: 'None.' })).toBe(landing.table!({ ...tableIn, rows: [], empty: 'None.' }));
    expect(explorer.kvTable([['Symbol', 'CMN']], { caption: 'Token' })).toBe(landing.kvTable!([['Symbol', 'CMN']], { caption: 'Token' }));
    for (const word of Object.keys(landing.BADGES)) expect(explorer.badge(word)).toBe(landing.badge!(word));
    expect(explorer.BADGES).toEqual(landing.BADGES);
    expect(() => explorer.badge('Cool')).toThrow(/status word/);
    const tabsIn = [{ label: 'Extrinsics', href: '?tab=extrinsics', current: true }, { label: 'Events', href: '?tab=events' }];
    expect(explorer.tabs(tabsIn, { label: 'Block' })).toBe(landing.tabs!(tabsIn, { label: 'Block' }));
    const chipsIn = [{ label: 'All', href: '/activity', current: true }, { label: 'Disputes', href: '/activity?kind=dispute' }];
    expect(explorer.chips(chipsIn)).toBe(landing.chips!(chipsIn));
    const searchIn = { action: '/search', placeholder: 'Search', label: 'Search the chain', value: 'q' };
    expect(explorer.searchField(searchIn)).toBe(landing.searchField!(searchIn));
    expect(explorer.codeBlock('curl -s x')).toBe(landing.codeBlock!('curl -s x'));
    expect(explorer.callout({ variant: 'warning', title: 'T', body: 'B' })).toBe(landing.callout!({ variant: 'warning', title: 'T', body: 'B' }));
    const pagIn = { prevHref: null, nextHref: '?offset=25', from: 1, to: 25, total: 989474 };
    expect(explorer.pagination(pagIn)).toBe(landing.pagination!(pagIn));
    expect(explorer.address(ALICE, { href: '/account/x' })).toBe(landing.address!(ALICE, { href: '/account/x' }));
    expect(explorer.address(`0x${'ab'.repeat(32)}`, { head: 8, tail: 6 })).toBe(landing.address!(`0x${'ab'.repeat(32)}`, { head: 8, tail: 6 }));
    const crumbs = [{ text: 'Explorer', href: '/' }, { text: 'Block 42' }];
    expect(explorer.breadcrumb(crumbs)).toBe(landing.breadcrumb!(crumbs));
    expect(explorer.ICONS).toEqual(landing.ICONS);
    for (const name of landing.ICONS) expect(explorer.icon(name, { className: 'sc-icon-sm' })).toBe(landing.icon!(name, { className: 'sc-icon-sm' }));
    expect(explorer.emptyState('No disputes are open.')).toBe(landing.emptyState!('No disputes are open.'));
    expect(explorer.skeleton('8ch')).toBe(landing.skeleton!('8ch'));
    expect(explorer.copyButton(ALICE, 'Copy address')).toBe(landing.copyButton!(ALICE, 'Copy address'));
    expect(explorer.link({ href: 'https://github.com/x', text: 'GitHub' })).toBe(landing.link!({ href: 'https://github.com/x', text: 'GitHub' }));
    expect(explorer.section({ id: 's', title: 'T', intro: 'i', body: 'b' })).toBe(landing.section!({ id: 's', title: 'T', intro: 'i', body: 'b' }));
    expect(explorer.DISCLAIMER).toBe(landing.DISCLAIMER);
  });

  it('formats integers, UTC times and truncated hashes as the landing does', () => {
    expect(explorer.formatInt(1166072)).toBe(landing.formatInt!(1166072));
    expect(explorer.formatInt(18_000_000_000_000_000_000_000n)).toBe('18,000,000,000,000,000,000,000');
    expect(explorer.formatUtc(AT)).toBe('23 Oct 2026, 12:00 UTC');
    expect(explorer.formatUtc(AT)).toBe(landing.formatUtc!(AT));
    expect(explorer.formatDate(AT)).toBe('23 Oct 2026');
    expect(explorer.truncateMiddle(ALICE)).toBe('5Grwva…utQY');
    expect(explorer.truncateMiddle(ALICE)).toBe(landing.truncateMiddle!(ALICE));
    expect(explorer.escapeHtml(`<a href="x">it's & more</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; more&lt;/a&gt;');
  });

  it('adds one sentence to the footer line when told what the page read, and nothing else', () => {
    const line = explorer.footer({ facts, builtAt: AT, site: SITE, read: 'Read from the node at block 1,166,072.' });
    expect(line).toContain(`${explorer.DISCLAIMER} Runtime scalar-commons 309. Page built 23 Oct 2026, 12:00 UTC from block 1,166,072. Read from the node at block 1,166,072.</p>`);
    expect(line.replace(' Read from the node at block 1,166,072.', '')).toBe(landing.footer!({ facts, builtAt: AT, site: SITE }));
  });

  it('serves the same favicon as the landing and the one copy behaviour', () => {
    expect(explorer.FAVICON_SVG).toBe(readFileSync(fileURLToPath(new URL('../../landing/public/favicon.svg', import.meta.url)), 'utf8'));
    expect(explorer.CHROME_JS).toContain("closest?.('[data-copy]')");
    expect(explorer.CHROME_JS).toContain('navigator.clipboard.writeText');
    expect(explorer.CHROME_JS).toContain("'Copied'");
  });
});

describe('the stylesheet and the routes that serve the chrome', () => {
  it('reads tokens + fonts + chrome, byte for byte the landing source', () => {
    const dir = defaultChromeDir();
    const css = readChromeStylesheet(dir);
    const src = (name: string): string => readFileSync(fileURLToPath(new URL(`../../landing/src/chrome/${name}`, import.meta.url)), 'utf8');
    expect(css).toBe(['tokens.css', 'fonts.css', 'chrome.css'].map(src).join('\n'));
    expect(css).toContain('--accent:    #1457d6;');
    expect(css).toContain('.sc-table ');
    expect(css).not.toContain('print.css');
    expect(css).not.toMatch(/Source Serif|IBM Plex|nw-/);
  });

  it('routes the stylesheet, the script, the favicon and the two fonts', () => {
    expect(parseRoute('/chrome.css')).toEqual({ kind: 'chrome' });
    expect(parseRoute('/chrome.js')).toEqual({ kind: 'script' });
    expect(parseRoute('/favicon.svg')).toEqual({ kind: 'favicon' });
    expect(parseRoute('/fonts/inter-latin-wght-normal.woff2')).toEqual({ kind: 'font', name: 'inter-latin-wght-normal.woff2' });
    expect(parseRoute('/fonts/jetbrains-mono-latin-400-normal.woff2')).toEqual({ kind: 'font', name: 'jetbrains-mono-latin-400-normal.woff2' });
    expect(parseRoute('/fonts/ibm-plex-mono-latin-400-normal.woff2')).toEqual({ kind: 'notFound' });
  });
});

describe('the chrome over HTTP', () => {
  let indexer: Server;
  let server: Server;
  let base: string;

  const HOME: HomeView = { chain: CHAIN, head: { number: 42, hash: `0x${'aa'.repeat(32)}` } };
  const chain = {
    chainInfo: () => CHAIN,
    eventFieldTypes: () => null,
    home: async () => HOME,
    heads: async () => ({ best: 42, finalized: 40 }),
  } as unknown as ExplorerChain;

  beforeAll(async () => {
    indexer = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.url?.startsWith('/v1/agents?')) response.end(JSON.stringify({ total: 204, limit: 1, offset: 0, items: [{}] }));
      else if (request.url?.startsWith('/v1/emissions')) response.end(JSON.stringify({ lastSettledEra: 172, lastEraEmissionPlancks: '0' }));
      else response.end(JSON.stringify({ total: 0, limit: 10, offset: 0, items: [], historyFrom: null }));
    });
    await new Promise<void>((resolve) => indexer.listen(0, '127.0.0.1', resolve));
    server = createExplorerServer({ chain, indexer: createIndexerReader({ baseUrl: `http://127.0.0.1:${(indexer.address() as AddressInfo).port}` }), onError: () => {} });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => indexer.close(() => resolve()));
  });

  it('serves the stylesheet, the script, the favicon and the fonts beside it', async () => {
    const css = await fetch(`${base}/chrome.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(await css.text()).toContain('url("fonts/inter-latin-wght-normal.woff2")');
    const js = await fetch(`${base}/chrome.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(await js.text()).toContain('data-copy');
    const icon = await fetch(`${base}/favicon.svg`);
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(await icon.text()).toContain('<svg');
    const font = await fetch(`${base}/fonts/jetbrains-mono-latin-400-normal.woff2`);
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await fetch(`${base}/fonts/nope.woff2`)).status).toBe(404);
  });

  it('wraps every page in the shared chrome: linked stylesheet, favicon, canonical on the explorer origin, header with Explorer current, footer, no meta refresh', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<link rel="stylesheet" href="/chrome.css">');
    expect(html).toContain('<script type="module" src="/chrome.js"></script>');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('<link rel="canonical" href="https://explorer.scalarnet.io/">');
    expect(html).toContain('<title>Explorer — Scalar Commons</title>');
    expect(html).toMatch(/<meta name="description" content="[^"]+">/);
    expect(html).toContain('href="https://explorer.scalarnet.io/" aria-current="page">Explorer</a>');
    expect(html).toContain('class="sc-wordmark" href="https://scalarnet.io/">Scalar Commons</a>');
    expect(html).toContain('href="https://scalarnet.io/docs/guide/run-an-agent">Get started</a>');
    expect(html).toContain('<footer class="sc-footer">');
    expect(html).toContain('<main id="main">');
    expect(html).toContain('<a class="sc-skip" href="#main">Skip to content</a>');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain('color-scheme');
    expect(html).not.toMatch(/nw-|AS BUILT|⌘K|Sources/);
  });
});
