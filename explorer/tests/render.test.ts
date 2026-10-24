import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect } from 'vitest';

import * as chrome from '../src/chrome-templates.js';
import { FAVICON_SVG } from '../src/favicon.js';
import {
  amount,
  renderAccount,
  renderActivity,
  renderBlock,
  renderBlocks,
  renderError,
  renderExtrinsic,
  renderHome,
  renderNothingFound,
  type Live,
  type PageContext,
} from '../src/render.js';
import { readChromeStylesheet } from '../src/server.js';
import type { AccountView, ActivityEntry, BlockView, ChainInfo, ExtrinsicView } from '../src/types.js';

/**
 * The explorer's pages on the shared chrome (SITE-REDESIGN.md §5.5): page
 * structure, the chrome mirror, links that go somewhere, plain words, and no
 * hand-typed figures.
 */

const root = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const HASH = `0x${'ab'.repeat(32)}`;
const NOW = '2026-10-23T12:00:00.000Z';
const INFO: ChainInfo = { chain: 'Scalar Commons Local Testnet', specName: 'scalar-commons', specVersion: 309, tokenSymbol: 'CMN', tokenDecimals: 12, ss58Format: 42, genesisHash: `0x${'ff'.repeat(32)}` };
const CTX: PageContext = { info: INFO, renderedAt: NOW, block: 1_166_000 };
const ok = <T>(value: T): Live<T> => ({ value, stale: false, at: NOW, reason: null });

const ENTRY: ActivityEntry = { id: '1165990-2', blockNumber: 1_165_990, extrinsicIndex: 1, timestampMs: BigInt(Date.parse(NOW) - 90_000), kind: 'dispute', section: 'escrow', method: 'DisputeOpened', agents: [ALICE], fields: [{ name: 'buyer', value: ALICE, kind: 'account' }, { name: 'amount', value: '5000000000000', kind: 'balance' }] };
const BLOCK: BlockView = {
  number: 1_165_995,
  hash: HASH,
  parentHash: HASH,
  stateRoot: HASH,
  extrinsicsRoot: HASH,
  timestampMs: BigInt(Date.parse(NOW) - 30_000),
  specVersion: 309,
  extrinsics: [{ index: 0, section: 'timestamp', method: 'set', hash: HASH, isSigned: false, signer: null, outcome: { kind: 'success' } }],
  detail: {
    renderedAt: NOW,
    best: 1_166_000,
    finalized: { value: true, source: { method: 'RPC', url: 'x', fetchedAt: NOW, block: 1, raw: null }, reason: null },
    author: { value: ALICE, source: { method: 'RPC', url: 'x', fetchedAt: NOW, block: 1, raw: null }, reason: null },
    slot: { value: null, source: { method: 'RPC', url: 'x', fetchedAt: NOW, block: 1, raw: null }, reason: null },
    era: { value: 1, source: { method: 'RPC', url: 'x', fetchedAt: NOW, block: 1, raw: null }, reason: null },
    session: { value: 1, source: { method: 'RPC', url: 'x', fetchedAt: NOW, block: 1, raw: null }, reason: null },
    weight: { value: '0', source: { method: 'RPC', url: 'x', fetchedAt: NOW, block: 1, raw: null }, reason: null },
    events: [{ index: 0, section: 'system', method: 'ExtrinsicSuccess', fields: [], extrinsicIndex: 0 }],
  },
};
const EXTRINSIC: ExtrinsicView = {
  block: { number: 1_165_995, hash: HASH },
  index: 1,
  hash: HASH,
  section: 'agents',
  method: 'send_heartbeat',
  isSigned: true,
  signer: ALICE,
  nonce: 7,
  tip: 0n,
  lengthBytes: 100,
  args: [{ name: 'agent_id', type: 'u32', value: '3' }],
  events: [{ index: 2, section: 'transactionPayment', method: 'TransactionFeePaid', fields: [{ name: 'who', value: ALICE, type: 'T::AccountId' }, { name: 'actual_fee', value: '1,234,567,890', type: 'BalanceOf<T>' }, { name: 'tip', value: '0', type: 'BalanceOf<T>' }] }],
  outcome: { kind: 'success' },
  accounts: [ALICE],
};
const ACCOUNT: AccountView = { address: ALICE, publicKey: HASH, free: 1_084_514_632_607_691n, reserved: 0n, frozen: 0n, nonce: 4, at: { number: 1_166_000, hash: HASH } };

const PAGES: Record<string, string> = {
  home: renderHome({ ctx: CTX, heads: ok({ best: 1_166_000, finalized: 1_165_997 }), agents: ok(204), lastEmission: ok({ amount: 0n, era: 172 }), blocks: ok([{ number: 1_165_999, hash: HASH, timestampMs: Date.parse(NOW) - 6000, author: ALICE, extrinsics: 1, events: 2 }]), activity: ok([ENTRY]) }),
  blocks: renderBlocks({ ctx: CTX, page: 2, total: 669_404, finalized: 1_165_997, rows: [{ number: 1_165_999, hash: HASH, timestampMs: Date.parse(NOW) - 6000, author: null, extrinsics: 1, events: 2 }], listAt: NOW }),
  block: renderBlock(BLOCK, 'extrinsics', CTX),
  blockEvents: renderBlock(BLOCK, 'events', CTX),
  extrinsic: renderExtrinsic(EXTRINSIC, CTX),
  account: renderAccount({ ctx: CTX, view: ACCOUNT, tab: 'activity', page: 1, agent: { name: 'swarm-7', stake: 10n ** 16n, registeredAt: 12, lastHeartbeat: 1_165_900, active: true, operatorRun: true }, list: ok({ total: 1, items: [ENTRY] }) }),
  activity: renderActivity({ ctx: CTX, agent: null, kind: null, page: 1, total: 989_476, historyFrom: 496_606, entries: [ENTRY], listAt: NOW }),
  search: renderNothingFound('nothing-here', CTX),
  error400: renderError(400, '“x” is not a block number or a block hash.', CTX),
  error404: renderError(404, 'There is no page at this address.', CTX),
  error504: renderError(504, 'The indexer did not answer in time.', CTX),
};

const text = (html: string): string => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('every explorer page', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name}: one h1, landmarks, skip link, title, description, canonical, og tags, favicon`, () => {
      expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
      expect(html).toContain('<main id="main">');
      expect(html).toContain('<header class="sc-header">');
      expect(html).toContain('<footer class="sc-footer">');
      expect(html).toContain('class="sc-skip" href="#main"');
      expect(html).toMatch(/<title>[^<]+ — Scalar Commons<\/title>/);
      expect(html).toMatch(/<meta name="description" content="[^"]+">/);
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/explorer\.scalarnet\.io\/[^"]*">/);
      for (const p of ['og:title', 'og:description', 'og:image', 'og:url']) expect(html).toContain(`property="${p}"`);
      expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
      expect(html).toContain('<html lang="en">');
    });

    it(`${name}: the site header with Explorer current, and the same footer`, () => {
      expect(html).toContain('<a href="https://explorer.scalarnet.io/" aria-current="page">Explorer</a>');
      expect(html).toContain('href="https://scalarnet.io/network"');
      expect(html).toContain('href="https://scalarnet.io/docs/guide/run-an-agent">Get started');
      expect(html).toContain('Testnet — tokens have no value and the chain may be reset.');
      expect(html).toMatch(/<span data-read>(Read from the node|List from the indexer|This page read nothing)[^<]*<\/span><\/p>/);
    });

    it(`${name}: no legacy chrome, no reload, no internal address, no "Local Testnet"`, () => {
      expect(html).not.toMatch(/nw-|Nightwatch|http-equiv="refresh"|127\.0\.0\.1|localhost|Local Testnet/);
      expect(html).not.toMatch(/text-transform|letter-spacing/);
    });

    it(`${name}: every link and button goes somewhere`, () => {
      for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
        expect(href).not.toBe('');
        expect(href).not.toBe('#');
        expect(href).toMatch(/^(\/|https:\/\/|#main$)/);
      }
      for (const [tag] of html.matchAll(/<button\b[^>]*>/g)) expect(tag).toMatch(/type="submit"|data-copy=/);
    });

    it(`${name}: plain words — no exclamation marks, no raw ISO times`, () => {
      expect(text(html)).not.toContain('!');
      expect(text(html)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    });
  }
});

describe('page content (§5.5)', () => {
  it('home: the search field first, four stats, latest blocks and activity with View all, About this chain', () => {
    const html = PAGES.home!;
    const main = html.slice(html.indexOf('<main'));
    expect(main.indexOf('role="search"')).toBeLessThan(main.indexOf('sc-stats'));
    expect(main).toContain('placeholder="Search by block number, block hash, extrinsic (block-index) or address"');
    for (const label of ['Block height', 'Finalized', 'Registered agents', 'Last era emission']) expect(main).toContain(`<span class="sc-stat-label">${label}</span>`);
    expect(main).toContain('Latest blocks');
    expect(main).toContain('Latest activity');
    expect(main).toContain('href="/blocks"');
    expect(main).toContain('href="/activity"');
    expect(main).toContain('About this chain');
    expect(main).toContain('Scalar Commons testnet');
  });

  it('home: an unread figure is "Unavailable" with the warning callout, never zero; a kept one is Stale', () => {
    const failed: Live<number> = { value: null, stale: false, at: null, reason: 'The indexer did not answer in time.' };
    const stale: Live<number> = { value: 204, stale: true, at: NOW, reason: 'The indexer did not answer in time.' };
    const html = renderHome({ ctx: CTX, heads: ok({ best: 1, finalized: 1 }), agents: stale, lastEmission: { ...failed, value: null }, blocks: { ...failed, value: null }, activity: { ...failed, value: null } });
    expect(html).toContain('sc-callout-warning');
    expect(html).toContain('Unavailable');
    expect(html).toContain('>Stale</span>');
    expect(html).toContain('values are from 23 Oct 2026, 12:00 UTC');
  });

  it('blocks: 25 per page with Previous and Next, and every column', () => {
    const html = PAGES.blocks!;
    for (const c of ['Block', 'Age', 'Hash', 'Author', 'Extrinsics', 'Events', 'Finalized']) expect(html).toContain(`>${c}</th>`);
    expect(html).toContain('href="/blocks"');
    expect(html).toContain('href="/blocks?page=3"');
    expect(html).toContain('Showing 26–26 of 669,404');
  });

  it('block: breadcrumb, key/value table with Author and Finalized, tabs in the URL, previous and next', () => {
    const html = PAGES.block!;
    expect(html).toContain('<nav class="sc-crumbs" aria-label="Breadcrumb"><a href="/">Explorer</a>');
    expect(html).toContain('Block 1,165,995');
    for (const k of ['Number', 'Hash', 'Parent', 'Timestamp', 'Author', 'Finalized', 'Extrinsics', 'Events', 'State root']) expect(html).toContain(`<th scope="row">${k}</th>`);
    expect(html).toContain('>Finalized</span>');
    expect(html).toContain('href="/block/1165995?tab=events"');
    expect(html).toContain('href="/block/1165994">Previous block');
    expect(html).toContain('href="/block/1165996">Next block');
    expect(PAGES.blockEvents).toContain('aria-selected="true">Events');
  });

  it('extrinsic: call in plain words and raw, Result, Fee, Nonce, Arguments, Events', () => {
    const html = PAGES.extrinsic!;
    expect(html).toContain('Agents: send heartbeat');
    expect(html).toContain('agents.send_heartbeat');
    expect(html).toContain('>Succeeded</span>');
    expect(html).toContain('<th scope="row">Fee</th>');
    expect(html).toContain('<th scope="row">Nonce</th>');
    expect(html).toContain('id="arguments">Arguments');
    expect(html).toContain('id="events">Events');
  });

  it('an empty first page shows its one-sentence empty state and no "Showing 0–0 of 0" pager', () => {
    const account = renderAccount({ ctx: CTX, view: ACCOUNT, tab: 'activity', page: 1, agent: null, list: ok({ total: 0, items: [] }) });
    const activity = renderActivity({ ctx: CTX, agent: ALICE, kind: null, page: 1, total: 0, historyFrom: 496_606, entries: [], listAt: NOW });
    for (const html of [account, activity]) {
      expect(html).not.toContain('sc-pagination');
      expect(html).not.toContain('Showing 0');
    }
    expect(PAGES.activity).toContain('sc-pagination');
  });

  it('extrinsic events: balance fields in CMN with the planck title, account fields linked', () => {
    const html = PAGES.extrinsic!;
    const events = html.slice(html.indexOf('id="events">Events'));
    expect(events).toContain('Actual fee <span class="sc-num" title="1,234,567,890 plancks">&lt; 0.01 CMN</span>');
    expect(events).toContain('Tip <span class="sc-num" title="0 plancks">0.00 CMN</span>');
    expect(events).toContain(`href="/account/${ALICE}"`);
    expect(events).not.toMatch(/>1,234,567,890</);
  });

  it('event fields: a decoded struct reads as words, never as raw JSON', () => {
    const view: ExtrinsicView = { ...EXTRINSIC, events: [{ index: 3, section: 'system', method: 'ExtrinsicSuccess', fields: [{ name: 'dispatch_info', value: '{"weight":{"refTime":"125,000,000","proofSize":"1,493"},"class":"Mandatory","paysFee":"Yes"}' }] }] };
    const html = renderExtrinsic(view, CTX);
    const events = html.slice(html.indexOf('id="events">Events'));
    expect(events).toContain('Dispatch info <span class="sc-small" title="');
    expect(events).toContain('Weight: ref time 125,000,000, proof size 1,493; class: Mandatory; pays fee: Yes</span>');
    expect(events).not.toMatch(/>[^<]*\{"/);
  });

  it('account: full address with copy, balances with two decimals and planck title, Agent card, tabs', () => {
    const html = PAGES.account!;
    expect(html).toContain(`<span class="sc-mono ex-wrap">${ALICE}</span>`);
    expect(html).toContain(`data-copy="${ALICE}"`);
    expect(html).toContain('title="1,084,514,632,607,691 plancks">1,084.51 CMN');
    expect(html).toContain('<h2 class="sc-h3">Agent</h2>');
    expect(html).toContain('>Operator-run</span>');
    expect(html).toContain(`href="/account/${ALICE}?tab=activity"`);
  });

  it('activity: plain event words with a Dispute badge, chips, intro without raw counts', () => {
    const html = PAGES.activity!;
    expect(html).toContain('Dispute opened');
    expect(html).toContain('>Dispute</span>');
    expect(html).toContain('Agent events, newest first. History reaches back to block');
    expect(html).toContain('href="/activity?kind=dispute"');
    expect(html).not.toContain('escrow.DisputeOpened');
  });

  it("search: \"Nothing found for '…'\" with the field and the four formats", () => {
    const html = PAGES.search!;
    expect(html).toContain('Nothing found for &#39;nothing-here&#39;');
    expect(html).toContain('role="search"');
    expect(html.match(/<li>/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('errors: a plain title, one sentence, the search field', () => {
    expect(PAGES.error404).toContain('Page not found');
    expect(PAGES.error504).toContain('The indexer did not answer in time.');
    for (const html of [PAGES.error400!, PAGES.error404!, PAGES.error504!]) expect(html).toContain('role="search"');
  });

  it('amounts: two decimals in text, the full planck value in the title', () => {
    expect(amount(5_000_000_000_000n, INFO)).toBe('<span class="sc-num" title="5,000,000,000,000 plancks">5.00 CMN</span>');
    expect(amount(1_234_567n, INFO)).toBe('<span class="sc-num" title="1,234,567 plancks">&lt; 0.01 CMN</span>');
    expect(amount(0n, INFO)).toContain('>0.00 CMN<');
  });
});

describe('the chrome mirror', () => {
  it('chrome-templates.ts renders the same markup as landing/src/chrome/templates.mjs', async () => {
    const mjs = (await import(/* @vite-ignore */ pathToFileURL(root('landing/src/chrome/templates.mjs')).href)) as Record<string, (...a: unknown[]) => string>;
    const ts = chrome as unknown as Record<string, (...a: unknown[]) => string>;
    const cases: [string, unknown[]][] = [
      ['icon', ['search']],
      ['button', [{ text: 'View all', href: '/blocks', variant: 'text' }]],
      ['card', [{ title: 'T', body: 'B', action: { text: 'Go', href: '/x' } }]],
      ['stat', [{ label: 'L', value: 'V', caption: 'C' }]],
      ['stats', [[{ label: 'L', value: 'V' }], { label: 'G' }]],
      ['table', [{ columns: [{ label: 'A' }, { label: 'B', align: 'right' }], rows: [['a', 'b']], caption: 'c' }]],
      ['kvTable', [[['K', 'V']]]],
      ['badge', ['Finalized']],
      ['tabs', [[{ label: 'A', href: '/a', current: true }]]],
      ['chips', [[{ label: 'All', href: '/activity', current: true }]]],
      ['searchField', [{ action: '/search', placeholder: 'P', label: 'L' }]],
      ['copyButton', ['v']],
      ['codeBlock', ['code']],
      ['callout', [{ variant: 'warning', body: 'b' }]],
      ['pagination', [{ prevHref: '/a', nextHref: null, from: 1, to: 25, total: 100 }]],
      ['emptyState', ['None.']],
      ['skeleton', []],
      ['address', [ALICE, { href: '/account/x' }]],
      ['breadcrumb', [[{ text: 'Explorer', href: '/' }, { text: 'Block' }]]],
      ['section', [{ id: 's', title: 'T', body: 'b' }]],
      ['header', [{ current: 'explorer', site: 'https://scalarnet.io' }]],
      ['formatInt', [1234567]],
      ['formatUtc', [NOW]],
      ['truncateMiddle', [ALICE]],
    ];
    for (const [name, args] of cases) {
      expect(typeof mjs[name], name).toBe('function');
      expect(ts[name]!(...args), name).toBe(mjs[name]!(...args));
    }
  });

  it('serves the synced chrome: tokens, fonts, components, and only token colours in the explorer rules', () => {
    const css = readChromeStylesheet(fileURLToPath(new URL('../src/chrome/', import.meta.url)));
    expect(css).toContain('--accent:    #1457d6');
    expect(css).toContain('inter-latin-wght-normal.woff2');
    expect(css).toContain('.sc-header');
    const tokens = new Set([...readFileSync(root('landing/src/chrome/tokens.css'), 'utf8').matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase()));
    const explorerRules = css.slice(css.indexOf('/* explorer: page-scoped'));
    expect(explorerRules.length).toBeGreaterThan(0);
    for (const [hex] of explorerRules.matchAll(/#[0-9a-f]{3,8}\b/gi)) expect(tokens.has(hex.toLowerCase())).toBe(true);
    expect(explorerRules).not.toMatch(/rgb|hsl|text-transform|letter-spacing|animation|box-shadow|gradient/);
    for (const [, value] of explorerRules.matchAll(/(?:margin|padding|gap)[a-z-]*:\s*([^;]+);/g)) expect(value).toMatch(/^(calc\()?[-\d* (]*var\(--s-[1-9]\)/);
  });

  it('serves the same favicon as the site', () => {
    expect(FAVICON_SVG).toBe(readFileSync(root('landing/public/favicon.svg'), 'utf8'));
  });
});

describe('no hand-typed figures in the explorer templates (§7)', () => {
  /** Every string and template literal's visible text: interpolations and tags removed. */
  function literalTexts(source: string): string[] {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const out: string[] = [];
    for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'/g)) {
      let s = m[1] ?? m[2] ?? '';
      // drop ${…} interpolations (balanced braces)
      let result = '';
      for (let i = 0; i < s.length; i += 1) {
        if (s[i] === '$' && s[i + 1] === '{') {
          let depth = 0;
          for (; i < s.length; i += 1) {
            if (s[i] === '{') depth += 1;
            else if (s[i] === '}') {
              depth -= 1;
              if (depth === 0) break;
            }
          }
          result += ' ';
        } else result += s[i];
      }
      s = result.replace(/<[^>]*>?/g, ' ').replace(/^[^<]*>/, ' ');
      out.push(s);
    }
    return out;
  }
  /** Literals that are not visible figures: regex replacements, padding, CSS widths, file names, MIME types. */
  const ALLOWED = [/^\$\d( \$\d)?$/, /^0$/, /^\d+ch$/, /\.woff2$/, /^font\/woff2$/, /^en-US$/];

  for (const file of ['src/render.ts', 'src/chrome-templates.ts']) {
    it(`${file}: no digit in any visible text a template writes`, () => {
      const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
      // Names are not figures: URLs, the SS58 format, the 0x hex prefix.
      const offenders = literalTexts(source)
        .map((t) => t.trim())
        .filter((t) => !ALLOWED.some((re) => re.test(t)))
        .filter((t) => /\d/.test(t.replace(/https?:\/\/\S+/g, '').replace(/\bSS58\b/g, '').replace(/\b0x\b/g, '')));
      expect(offenders).toEqual([]);
    });
  }
});
