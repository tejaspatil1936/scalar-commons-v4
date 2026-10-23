import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createIndexerClient, createIndexerReader } from '../src/activity.js';
import type { ExplorerChain } from '../src/chain.js';
import { band, curvePaths, reading, tag, topBar, NAV } from '../src/chrome-templates.js';
import { renderAccount, renderActivity, renderBlock, renderError, renderExtrinsic, renderHome } from '../src/render.js';
import { parseRoute, searchPath } from '../src/routes.js';
import { createExplorerServer, readChromeStylesheet, defaultChromeDir } from '../src/server.js';
import type { AccountView, ActivityView, BlockView, ChainInfo, ExtrinsicView, HomeView, Read } from '../src/types.js';

/**
 * The Nightwatch chrome on the explorer: the shell, the stylesheet and font
 * routes, the readings with their receipts, the search field, and the Bands.
 * Everything here is a pure function of a view model, so a page is asserted
 * from fixtures; the live suite covers decoding against a real node.
 */

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const AT = '2026-10-23T12:00:00.000Z';

const CHAIN: ChainInfo = {
  chain: 'Scalar Commons Local Testnet',
  specName: 'scalar-commons',
  specVersion: 309,
  tokenSymbol: 'CMN',
  tokenDecimals: 12,
  ss58Format: 42,
  genesisHash: `0x${'ff'.repeat(32)}`,
};

const ok = <T>(value: T, url: string, method = 'STORAGE'): Read<T> => ({ value, source: { method, url, fetchedAt: AT, block: 42, raw: null }, reason: null });
const failed = <T>(url: string, reason: string): Read<T> => ({ value: null, source: { method: 'RPC', url, fetchedAt: AT, block: 42, raw: null }, reason });

describe('chrome templates', () => {
  it('throws for a Reading without a source: no figure ships without an origin', () => {
    expect(() => reading({ label: 'Best', figure: '42', source: { method: '', url: '', fetchedAt: null, block: null, raw: null } })).toThrow(/no source/);
  });

  it('renders the reading as label · leader · figure · stub · receipt, naming the storage item', () => {
    const html = reading({ label: 'Issuance', figure: '18,000,000,000 CMN', source: { method: 'STORAGE', url: 'balances.totalIssuance', fetchedAt: AT, block: 42, raw: null } });
    expect(html).toContain('class="nw-reading"');
    expect(html).toContain('class="nw-leader"');
    expect(html).toContain('class="nw-stub"');
    expect(html).toContain('STORAGE balances.totalIssuance');
    expect(html).toContain('fetched 2026-10-23 12:00:00 UTC · block 42');
  });

  it('renders the built tag without a dot, and every other tag with its state dot', () => {
    expect(tag({ state: 'built', text: 'AS OF 2026-10-23 12:00:00 UTC' })).not.toContain('nw-dot');
    expect(tag({ state: 'dispute', text: 'IN DISPUTE' })).toContain('nw-dot');
  });

  it('links the nav to the site absolutely, with the explorer current and the wordmark to the site root', () => {
    const html = topBar({ current: 'explorer' });
    expect(html).toContain('href="https://scalarnet.io/observatory"');
    expect(html).toContain('href="https://scalarnet.io/docs/"');
    expect(html).toContain('href="https://explorer.scalarnet.io" aria-current="page"');
    expect(html).toContain('class="nw-wordmark" href="https://scalarnet.io/"');
    expect(NAV.map((n) => n.label)).toEqual(['Observatory', 'Pulse', 'Explorer', 'Docs', 'Oversight', 'Faucet']);
  });

  it('renders a band and escapes its text', () => {
    expect(band({ text: '404 · <b>' })).toBe('<div class="nw-band" role="status">404 · &lt;b&gt;</div>');
  });

  it('computes straight-segment curve paths that close on the baseline', () => {
    const paths = curvePaths([0, 2, 1], 400, 120);
    expect(paths?.pathLine).toMatch(/^M0,120L200,12L400,66$/);
    expect(paths?.pathArea).toMatch(/L0,120Z$/);
    expect(curvePaths([1], 400, 120)).toBeNull();
  });
});

const HOME: HomeView = {
  chain: CHAIN,
  head: { number: 42, hash: `0x${'aa'.repeat(32)}` },
  readings: {
    renderedAt: AT,
    headAgeMs: 4_000,
    finalized: ok({ number: 40, hash: `0x${'ab'.repeat(32)}` }, 'chain_getFinalizedHead', 'RPC'),
    era: ok({ number: 7, elapsed: 120, length: 3_600 }, 'agents.eraNumber · emissions.eraStartBlock · emissions.eraDuration'),
    session: failed('session.currentIndex · babe.epochDuration · babe.epochStart', 'runtime exposes no babe.epochStart storage'),
    validators: ok(3, 'session.validators'),
    issuance: ok(18_000_000_000_000_000_000_000n, 'balances.totalIssuance'),
    recent: ok(
      [
        {
          number: 42,
          hash: `0x${'aa'.repeat(32)}`,
          timestampMs: 1_787_086_860_000n,
          author: BOB,
          extrinsics: [{ index: 0, section: 'timestamp', method: 'set', hash: `0x${'11'.repeat(32)}`, isSigned: false, signer: null, outcome: { kind: 'success' } }],
          events: [{ index: 0, section: 'system', method: 'ExtrinsicSuccess', fields: [], extrinsicIndex: 0 }],
        },
      ],
      'chain_getBlock × 16 · system.events',
      'RPC',
    ),
    pending: failed('author_pendingExtrinsics', 'RPC call is unsafe to be called externally'),
  },
  indexer: ok({ syncedHeight: 40 }, 'api.scalarnet.io/v1/status', 'GET'),
};

describe('renderHome in the chrome', () => {
  const html = renderHome(HOME);

  it('serves the shell: the linked stylesheet, the preloads, the bar, the lamp and the footer disclaimer', () => {
    expect(html).toContain('<link rel="stylesheet" href="/chrome.css">');
    expect(html).toContain('href="/fonts/martian-mono-latin-wght-normal.woff2" as="font"');
    expect(html).toContain('class="nw-bar"');
    expect(html).toContain('data-lamp data-state="normal" data-lit="true"');
    expect(html).toContain('block 42 · finality 2 · normal');
    expect(html).toContain('Testnet — the token has no value and the chain may be reset.');
    expect(html).not.toContain('<script');
  });

  it('posts the search field to the search route', () => {
    expect(html).toMatch(/<form class="nw-search" method="get" action="\/search">/);
    expect(html).toContain('placeholder="block number, hash, extrinsic, address, agent name"');
  });

  it('fills the six readings from the node with their storage names and the AS OF tag', () => {
    expect(html).toContain('AS OF 2026-10-23 12:00:00 UTC');
    expect(html).toContain('7 · 120 / 3,600');
    expect(html).toContain('STORAGE agents.eraNumber · emissions.eraStartBlock · emissions.eraDuration');
    expect(html).toContain('18,000,000,000 CMN');
    expect(html).toContain('STORAGE session.validators');
  });

  it('renders a failed read as unavailable with the reason, never a guess', () => {
    expect(html).toContain('runtime exposes no babe.epochStart storage');
    expect(html).toContain('RPC call is unsafe to be called externally');
    expect(html).toContain('is-unavailable');
  });

  it('draws the explorer Spine and the ledgers from the blocks read', () => {
    expect(html).toContain('nw-spine--explorer');
    expect(html).toContain('data-block="42"');
    expect(html).toContain('timestamp.set');
    expect(html).toContain('system.ExtrinsicSuccess');
  });

  it('states the indexer line from /v1/status', () => {
    expect(html).toContain('indexer api.scalarnet.io · syncedHeight 40 · 2 behind');
  });

  it('renders the indexer line as unavailable when the index could not be reached', () => {
    const down = renderHome({ ...HOME, indexer: failed('api.scalarnet.io/v1/status', 'fetch failed') });
    expect(down).toContain('unavailable · fetch failed');
  });

  it('renders a stalled lamp, unlit, when the newest block is over 30 s old', () => {
    const stale = renderHome({ ...HOME, readings: { ...HOME.readings!, headAgeMs: 120_000 } });
    expect(stale).toContain('data-state="stalled" data-lit="false"');
    expect(stale).toContain('2 min ago · stalled');
  });
});

const BLOCK: BlockView = {
  number: 42,
  hash: `0x${'aa'.repeat(32)}`,
  parentHash: `0x${'bb'.repeat(32)}`,
  stateRoot: `0x${'cc'.repeat(32)}`,
  extrinsicsRoot: `0x${'dd'.repeat(32)}`,
  timestampMs: 1_787_086_860_000n,
  specVersion: 309,
  extrinsics: [
    { index: 0, section: 'timestamp', method: 'set', hash: `0x${'11'.repeat(32)}`, isSigned: false, signer: null, outcome: { kind: 'success' } },
    { index: 1, section: 'balances', method: 'transferKeepAlive', hash: `0x${'22'.repeat(32)}`, isSigned: true, signer: ALICE, outcome: { kind: 'failed', reason: 'balances.InsufficientBalance' } },
  ],
  detail: {
    renderedAt: AT,
    best: 44,
    finalized: ok(true, 'chain_getFinalizedHead', 'RPC'),
    author: ok(BOB, 'chain_getBlock · header.digest (BABE pre-runtime)', 'RPC'),
    slot: ok('123456', 'chain_getBlock · header.digest (BABE pre-runtime)', 'RPC'),
    era: ok(7, 'agents.eraNumber'),
    session: ok(14, 'session.currentIndex'),
    weight: failed('system.blockWeight', 'runtime exposes no system.blockWeight storage'),
    events: [
      { index: 0, section: 'system', method: 'ExtrinsicSuccess', fields: [{ name: 'dispatchInfo', value: '{}' }], extrinsicIndex: 0 },
      { index: 1, section: 'balances', method: 'Transfer', fields: [{ name: 'from', value: ALICE }], extrinsicIndex: 1 },
    ],
  },
};

describe('renderBlock in the chrome', () => {
  const html = renderBlock(BLOCK, CHAIN);

  it('sets the number at figure-xl with the finality tag, prev and next', () => {
    expect(html).toContain('<h1 class="nw-figure nw-figure--xl">42</h1>');
    expect(html).toContain('FINALIZED');
    expect(html).toContain('href="/block/41"');
    expect(html).toContain('href="/block/43"');
  });

  it('marks an unfinalized block BEST · not final in the live state', () => {
    const best = renderBlock({ ...BLOCK, detail: { ...BLOCK.detail!, finalized: ok(false, 'chain_getFinalizedHead', 'RPC') } }, CHAIN);
    expect(best).toContain('data-state="live"><span class="nw-dot" aria-hidden="true"></span>BEST · not final');
  });

  it('renders the receipt readings: author, slot, era · session, weight unavailable with its reason', () => {
    expect(html).toContain(BOB);
    expect(html).toContain('123456');
    expect(html).toContain('7 · 14');
    expect(html).toContain('runtime exposes no system.blockWeight storage');
    expect(html).toContain('2 extrinsics · 2 events');
  });

  it('lists extrinsics as sheet rows and groups events under their extrinsic with raw JSON', () => {
    expect(html).toContain('nw-ledger--sheet');
    expect(html).toContain('Extrinsics · 2');
    expect(html).toContain('Events · 2');
    expect(html).toContain('extrinsic <a href="/extrinsic/42/1">42-1</a>');
    expect(html).toContain('▸ raw');
    expect(html).toContain('class="nw-raw"');
  });
});

const EXTRINSIC: ExtrinsicView = {
  block: { number: 42, hash: `0x${'aa'.repeat(32)}` },
  index: 1,
  hash: `0x${'22'.repeat(32)}`,
  section: 'escrow',
  method: 'disputeDelivery',
  isSigned: true,
  signer: ALICE,
  nonce: 7,
  tip: 0n,
  lengthBytes: 138,
  args: [{ name: 'provider', type: 'AccountId', value: BOB }],
  events: [],
  outcome: { kind: 'failed', reason: 'escrow.NotDelivered' },
  accounts: [ALICE, BOB],
  renderedAt: AT,
  disputeTerms: {
    bountyBps: ok(200, 'escrow.disputeBountyBps · runtime/src/lib.rs:1297', 'META'),
    burnBps: ok(0, 'escrow.disputeBurnBps · runtime/src/lib.rs:1299', 'META'),
    settles: ok('oracle', 'escrow.disputeTimeout · runtime/src/lib.rs:1295–1299', 'META'),
  },
};

describe('renderExtrinsic in the chrome', () => {
  const html = renderExtrinsic(EXTRINSIC, CHAIN);

  it('titles the call, copies the hash and tags the outcome in the dispute state', () => {
    expect(html).toContain('<h1 class="nw-h2">escrow.disputeDelivery</h1>');
    expect(html).toContain(`data-copy="${EXTRINSIC.hash}"`);
    expect(html).toContain('data-state="dispute"><span class="nw-dot" aria-hidden="true"></span>FAILED · escrow.NotDelivered');
    expect(renderExtrinsic({ ...EXTRINSIC, outcome: { kind: 'success' } }, CHAIN)).toContain('SUCCEEDED');
  });

  it('renders the decoded CALL block with raw, and no sentence the formatter did not build', () => {
    expect(html).toContain('class="nw-code nw-copyable"');
    expect(html).toContain(`provider: AccountId = ${BOB}`);
    expect(html).toContain('▸ raw');
  });

  it('adds WHAT HAPPENS NEXT for escrow.disputeDelivery from the runtime constants, citing the runtime lines', () => {
    expect(html).toContain('What happens next');
    expect(html).toContain('2% · 200 bps');
    expect(html).toContain('0% · 0 bps');
    expect(html).toContain('META escrow.disputeBountyBps · runtime/src/lib.rs:1297');
    expect(html).toContain('oracle');
    expect(renderExtrinsic({ ...EXTRINSIC, section: 'balances', method: 'transfer', disputeTerms: undefined }, CHAIN)).not.toContain('What happens next');
  });
});

const ACCOUNT: AccountView = {
  address: ALICE,
  publicKey: `0x${'ee'.repeat(32)}`,
  free: 1_000_000_000_000n,
  reserved: 0n,
  frozen: 0n,
  nonce: 0,
  at: { number: 42, hash: `0x${'aa'.repeat(32)}` },
  roles: {
    renderedAt: AT,
    agentName: ok('swarm-0007', 'agents.agentMetadata'),
    agentStake: ok(500_000_000_000_000n, 'agents.agentStake'),
    bonded: ok(null, 'staking.bonded'),
    validator: ok(false, 'session.validators'),
  },
  history: ok([], 'api.scalarnet.io/v1/accounts/x/extrinsics', 'GET'),
};

describe('renderAccount in the chrome', () => {
  const html = renderAccount(ACCOUNT, CHAIN);

  it('names the account by its on-chain agent name, tags AGENT and OPERATOR-RUN for a swarm- name', () => {
    expect(html).toContain('swarm-0007');
    expect(html).toContain('is-operator');
    expect(html).toContain('>AGENT<');
    expect(html).toContain('OPERATOR-RUN');
    expect(html).not.toContain('VALIDATOR STASH');
    expect(html).toContain(`data-copy="${ALICE}"`);
  });

  it('renders four balance readings, the total derived with its computation named', () => {
    expect(html).toContain('free + reserved');
    expect(html.match(/STORAGE system.account/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('says so when the index holds nothing for the address', () => {
    expect(html).toContain('No activity in the index for this address.');
  });

  it('draws the history as a rail when the index holds rows, and tags a validator stash', () => {
    const validator = renderAccount(
      {
        ...ACCOUNT,
        roles: { ...ACCOUNT.roles!, agentName: ok(null, 'agents.agentMetadata'), agentStake: ok(null, 'agents.agentStake'), bonded: ok(BOB, 'staking.bonded'), validator: ok(true, 'session.validators') },
        history: ok([{ blockNumber: 40, index: 1, section: 'balances', method: 'transfer', timestampMs: 1_787_086_860_000n, success: true }], 'x', 'GET'),
      },
      CHAIN,
    );
    expect(validator).toContain('VALIDATOR STASH');
    expect(validator).toContain('BONDED');
    expect(validator).toContain('class="nw-rail');
    expect(validator).toContain('href="/extrinsic/40/1"');
  });
});

const ACTIVITY: ActivityView = {
  agent: ALICE,
  offset: 0,
  limit: 50,
  total: 1,
  historyFrom: 100,
  entries: [
    { id: '120-4', blockNumber: 120, extrinsicIndex: 2, timestampMs: 1_787_086_860_000n, kind: 'dispute', section: 'escrow', method: 'DeliveryDisputed', agents: [ALICE, BOB], fields: [] },
  ],
  agentReadings: {
    renderedAt: AT,
    name: null,
    earnedAllTime: failed('api/v1/agents/x', '/v1/agents/x carries no all-time earnings field'),
    earnedThisEra: ok(12_500_000_000_000n, 'api/v1/agents/x', 'GET'),
    agreementsOpen: ok(2, 'api/v1/agents/x', 'GET'),
    inDispute: ok(1, 'api/v1/agents/x/escrows', 'GET'),
    counterparties: ok([{ address: BOB, count: 2 }], 'api/v1/agents/x/escrows', 'GET'),
    earningsByEra: ok([{ era: 5, amount: 1_000_000_000_000n }, { era: 6, amount: 3_000_000_000_000n }], 'api/v1/eras', 'GET'),
    decayed: false,
    cooldown: true,
  },
};

describe('renderActivity, agent-scoped, in the chrome', () => {
  const html = renderActivity(ACTIVITY, CHAIN);

  it('renders the five readings, leaving an absent field as a leader to nothing with its receipt', () => {
    expect(html).toContain('12.5 CMN');
    expect(html).toContain('carries no all-time earnings field');
    expect(html).toContain('COOLDOWN');
  });

  it('draws EARNINGS BY ERA as an SVG curve with the pooled light and a table fallback', () => {
    expect(html).toContain('class="nw-curve"');
    expect(html).toContain('stop-color="#ffe3a3"');
    expect(html).toContain('<td>era 6</td><td>3 CMN</td>');
  });

  it('lists counterparties with share bars and the feed as a watch-log rail', () => {
    expect(html).toContain('class="nw-share" style="width:100%"');
    expect(html).toContain('Watch-log');
    expect(html).toContain('is-newest');
  });

  it('keeps the unscoped feed as a ledger', () => {
    const feed = renderActivity({ ...ACTIVITY, agent: null, agentReadings: undefined }, CHAIN);
    expect(feed).toContain('class="nw-ledger ');
    expect(feed).not.toContain('Watch-log');
  });
});

describe('renderError as a Band', () => {
  it('renders 404 as a band and a 502 as an alarm band', () => {
    expect(renderError(404, 'no such page: /x', CHAIN)).toContain('<div class="nw-band" role="status">404 · no such page: /x</div>');
    expect(renderError(502, 'the node did not answer', CHAIN)).toContain('nw-band--alarm');
  });
});

describe('search and chrome routes', () => {
  it('routes the search field, the stylesheet and the two fonts', () => {
    expect(parseRoute(searchPath('42'))).toEqual({ kind: 'search', query: '42' });
    expect(parseRoute('/search?q=%20hello%20')).toEqual({ kind: 'search', query: 'hello' });
    expect(parseRoute('/chrome.css')).toEqual({ kind: 'chrome' });
    expect(parseRoute('/fonts/martian-mono-latin-wght-normal.woff2')).toEqual({ kind: 'font', name: 'martian-mono-latin-wght-normal.woff2' });
    expect(parseRoute('/fonts/evil.woff2')).toEqual({ kind: 'notFound' });
  });

  it('reads the stylesheet as tokens + chrome + print, byte-for-byte from the synced copy', () => {
    const dir = defaultChromeDir();
    const css = readChromeStylesheet(dir);
    expect(css).toContain('--pine-0: #0f1f18');
    expect(css).toContain('.nw-reading');
    expect(css).toContain('@media print');
    const landing = fileURLToPath(new URL('../../landing/src/chrome/chrome.css', import.meta.url));
    expect(readFileSync(new URL('chrome.css', `file://${dir}`), 'utf8')).toBe(readFileSync(landing, 'utf8'));
  });
});

describe('the chrome over HTTP', () => {
  let indexer: Server;
  let explorer: Server;
  let base: string;
  const seen: string[] = [];

  const chain = {
    chainInfo: () => CHAIN,
    eventFieldTypes: () => null,
    home: async () => HOME,
    account: async (address: string) => ({ ...ACCOUNT, address }),
    block: async () => {
      throw new Error('not in this test');
    },
    findExtrinsic: async () => null,
  } as unknown as ExplorerChain;

  beforeAll(async () => {
    indexer = createServer((request, response) => {
      seen.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.url?.startsWith('/v1/status')) {
        response.end(JSON.stringify({ indexer: { syncedHeight: 40 } }));
      } else if (request.url?.startsWith('/v1/agents?')) {
        response.end(JSON.stringify({ items: [{ address: BOB, name: 'swarm-0007' }] }));
      } else if (request.url?.includes('/extrinsics')) {
        response.end(JSON.stringify({ items: [{ blockNumber: 40, index: 1, section: 'balances', method: 'transfer', timestampMs: null, success: true }] }));
      } else {
        response.end(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0, historyFrom: null }));
      }
    });
    await new Promise<void>((resolve) => indexer.listen(0, '127.0.0.1', resolve));
    const indexerUrl = `http://127.0.0.1:${(indexer.address() as AddressInfo).port}`;
    explorer = createExplorerServer({
      chain,
      activity: createIndexerClient({ baseUrl: indexerUrl }),
      indexer: createIndexerReader({ baseUrl: indexerUrl }),
      onError: () => {},
    });
    await new Promise<void>((resolve) => explorer.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(explorer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => explorer.close(() => resolve()));
    await new Promise<void>((resolve) => indexer.close(() => resolve()));
  });

  it('serves the stylesheet and the fonts beside it', async () => {
    const css = await fetch(`${base}/chrome.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(await css.text()).toContain('url("fonts/martian-mono-latin-wght-normal.woff2")');
    const font = await fetch(`${base}/fonts/instrument-sans-latin-wght-normal.woff2`);
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await fetch(`${base}/fonts/nope.woff2`)).status).toBe(404);
  });

  it('resolves the search field: number → block, address → account, agent name → activity, else a 404 band', async () => {
    const number = await fetch(`${base}${searchPath('42')}`, { redirect: 'manual' });
    expect(number.status).toBe(302);
    expect(number.headers.get('location')).toBe('/block/42');
    const account = await fetch(`${base}${searchPath(ALICE)}`, { redirect: 'manual' });
    expect(account.headers.get('location')).toBe(`/account/${ALICE}`);
    const agent = await fetch(`${base}${searchPath('swarm-0007')}`, { redirect: 'manual' });
    expect(agent.headers.get('location')).toBe(`/activity?agent=${BOB}`);
    const nothing = await fetch(`${base}${searchPath('nothing-here')}`);
    expect(nothing.status).toBe(404);
    expect(await nothing.text()).toContain('class="nw-band"');
  });

  it('reads the indexer line for the home page and the history for an account page', async () => {
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('indexer api.scalarnet.io · syncedHeight 40 · 2 behind');
    const account = await fetch(`${base}/account/${ALICE}`);
    expect(account.status).toBe(200);
    expect(await account.text()).toContain('href="/extrinsic/40/1"');
    expect(seen.some((url) => url === `/v1/accounts/${ALICE}/extrinsics?limit=50`)).toBe(true);
  });

  it('404s an unknown path as a band', async () => {
    const response = await fetch(`${base}/not-a-view`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('404 · no such page: /not-a-view');
  });
});
