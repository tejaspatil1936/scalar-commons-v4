import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createIndexerClient, createIndexerReader } from '../src/activity.js';
import type { ExplorerChain } from '../src/chain.js';
import { band, curve, curvePaths, reading, tag, topBar, NAV } from '../src/chrome-templates.js';
import { eventGlyphs, figureWidthPx, plainSentence, PULSE_EVENTS, readingRow, readingRows, renderAccount, renderActivity, renderBlock, renderError, renderExtrinsic, renderHome } from '../src/render.js';
import { parseRoute, searchPath } from '../src/routes.js';
import { createExplorerServer, readChromeStylesheet, defaultChromeDir } from '../src/server.js';
import type { AccountView, ActivityView, BlockView, ChainInfo, ExtrinsicView, HomeView, Read } from '../src/types.js';
import { heartbeatMultiplier } from '../src/types.js';

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

  it('marks every tag with its state mark — the built AS OF tag included — and only a key without one', () => {
    expect(tag({ state: 'built', text: 'AS OF 2026-10-23 12:00:00 UTC' })).toContain('<span class="nw-dot" aria-hidden="true"></span>AS OF');
    expect(tag({ state: 'dispute', text: 'IN DISPUTE' })).toContain('nw-dot');
    expect(tag({ state: 'kbd', text: '⌘K' })).not.toContain('nw-dot');
    expect(tag({ state: 'built', text: 'AS BUILT', detail: '2026-10-23' })).toContain('<span class="nw-tag-detail"> · 2026-10-23</span>');
  });

  it('wraps Sources and ⌘K in the bar controls, inside the right of the bar', () => {
    const html = topBar({ current: 'explorer' });
    expect(html).toMatch(/<div class="nw-bar-right">[\s\S]*<div class="nw-bar-controls">[\s\S]*nw-sources[\s\S]*⌘K<\/span>\s*<\/div>\s*<\/div>/);
  });

  it('draws curve ticks without hue: a dispute dashed, a slash an X, each with its word', () => {
    const html = curve({ id: 't', width: 100, height: 40, pathLine: 'M0,0L100,40', pathArea: 'M0,0L100,40L0,40Z', ticks: [{ x: 10, state: 'dispute' }, { x: 50, state: 'slash' }], alt: 'test' });
    expect(html).toContain('<line class="nw-curve-tick" data-state="dispute" x1="10" x2="10"');
    expect(html.match(/data-state="slash"/g)?.length).toBe(2);
    expect(html).toContain('<text class="nw-curve-word" x="16" y="39">dispute</text>');
    expect(html).toContain('<text class="nw-curve-word" x="56" y="39">slash</text>');
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
    expect(html).toContain('href="/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font"');
    expect(html).toContain('class="nw-bar"');
    expect(html).toContain('data-lamp data-state="normal" data-lit="true"');
    expect(html).toContain('block 42 · fin 2</span>');
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
    expect(html).toContain('18,000,000,000<span class="nw-unit">CMN</span>');
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

  it('tags DECAYED only once the head is past the last heartbeat by more than the runtime grace period', () => {
    const at = (lastHeartbeat: number): string =>
      renderAccount({ ...ACCOUNT, roles: { ...ACCOUNT.roles!, heartbeat: ok({ lastHeartbeat, best: 1_000, grace: 100, decay: 900 }, 'agents.lastHeartbeat · agents.heartbeatGracePeriod · agents.heartbeatDecayPeriod') } }, CHAIN);
    expect(html).not.toContain('DECAYED');
    // Exactly at the grace period the multiplier is still 100 %.
    expect(at(900)).not.toContain('>DECAYED<');
    expect(at(900)).toContain('multiplier 100 %');
    const decayed = at(899);
    expect(decayed).toContain('<span class="nw-dot" aria-hidden="true"></span>DECAYED</span>');
    expect(decayed).toContain('best 1000 − 899 = 101 blocks · grace 100 · decay 900 · multiplier 100 %');
    // Far past grace + decay the multiplier sits on its 10 % floor.
    expect(at(0)).toContain('multiplier 10 %');
    expect(at(0)).toContain('STORAGE agents.lastHeartbeat · agents.heartbeatGracePeriod · agents.heartbeatDecayPeriod');
  });

  it('computes the heartbeat multiplier as the pallet does (100 within grace, linear to a 10 % floor)', () => {
    expect(heartbeatMultiplier({ lastHeartbeat: 0, best: 100, grace: 100, decay: 900 })).toBe(100);
    expect(heartbeatMultiplier({ lastHeartbeat: 0, best: 101, grace: 100, decay: 900 })).toBe(100);
    expect(heartbeatMultiplier({ lastHeartbeat: 0, best: 110, grace: 100, decay: 900 })).toBe(99);
    expect(heartbeatMultiplier({ lastHeartbeat: 0, best: 550, grace: 100, decay: 900 })).toBe(55);
    expect(heartbeatMultiplier({ lastHeartbeat: 0, best: 5_000, grace: 100, decay: 900 })).toBe(10);
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

  it('draws EARNINGS BY ERA as an SVG curve with a flat ink pool (no gradient) and a table fallback', () => {
    expect(html).toContain('class="nw-curve"');
    expect(html).toContain('class="nw-curve-pool"');
    expect(html).not.toContain('linearGradient');
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
    expect(parseRoute('/fonts/ibm-plex-mono-latin-400-normal.woff2')).toEqual({ kind: 'font', name: 'ibm-plex-mono-latin-400-normal.woff2' });
    expect(parseRoute('/fonts/evil.woff2')).toEqual({ kind: 'notFound' });
  });

  it('reads the stylesheet as tokens + chrome + print, byte-for-byte from the synced copy', () => {
    const dir = defaultChromeDir();
    const css = readChromeStylesheet(dir);
    expect(css).toContain('--paper:   #0b0b0b;');
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
    expect(await css.text()).toContain('url("fonts/ibm-plex-mono-latin-400-normal.woff2")');
    const font = await fetch(`${base}/fonts/source-serif-4-latin-opsz-normal.woff2`);
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

describe('layout faults seen at 1440 px against the public node', () => {
  it('renders the six home readings as two .nw-row rows of three (one figure size a row), issuance as whole CMN with the unit at label size', () => {
    const html = renderHome(HOME);
    const rows = html.match(/<div class="nw-row"[^>]*>/g) ?? [];
    expect(rows.length).toBe(2);
    expect(html).not.toContain('nw-row x-wrap');
    expect(html.match(/nw-reading nw-reading--stack/g)?.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('18,000,000,000<span class="nw-unit">CMN</span>');
    expect(html).toContain('18000000000000000000000 plancks · whole CMN');
  });

  it('steps a row down at render when a figure would spill its column (Plex Mono is 0.6 em a glyph)', () => {
    // Round 3's scale: three in a row sit at --figure-m (36 px); '172 · 311 / 3,600' is 17 × 21.6 + 28 = 395 px,
    // more than a third of the frame (384 px), so the row steps down one size — the rule doing its job.
    expect(readingRow(['<span data-reading-value>1,163,615</span>', '<span data-reading-value>1,163,613</span>', '<span data-reading-value>172 · 311 / 3,600</span>'])).toBe(
      '<div class="nw-row" data-step="1">\n<span data-reading-value>1,163,615</span>\n<span data-reading-value>1,163,613</span>\n<span data-reading-value>172 · 311 / 3,600</span>\n</div>',
    );
    // Shorter figures in a row of three stay at --figure-m.
    expect(readingRow(['1,163,615', '1,163,613', '8'].map((f) => `<span data-reading-value>${f}</span>`))).toContain('<div class="nw-row">');
    const wide = ['1,099.999891842778', '0', '0', '1,099.999891842778'].map((f) => `<span data-reading-value>${f}<span class="nw-unit">CMN</span></span>`);
    expect(readingRow(wide)).toContain('<div class="nw-row" data-step="1">');
    // 18 glyphs at 36 px is 417 px, more than a quarter of the 1,200 px frame (282 px).
    expect(figureWidthPx('1,099.999891842778', null, 'm')).toBeCloseTo(18 * 21.6 + 28);
    // Two in a row on a phone sit at --figure-m; a 21-glyph balance spills the 350 px column and drops to --figure-s.
    expect(readingRow(['1,000,000.12345678901', '0'].map((f) => `<span data-reading-value>${f}</span>`))).toContain('data-step-m="1"');
  });

  it('splits Readings into rows of half as many when a figure spills even a step down, never cutting a figure', () => {
    const fig = (f: string): string => `<span data-reading-value>${f}<span class="nw-unit">CMN</span></span>`;
    // 22 glyphs at --figure-s (24 px) with the unit and stub is 379 px: over a quarter of the frame (282 px).
    const html = readingRows(['995,008,924.86145069865', '170', '10,000', '995,009,094.86145069865'].map(fig));
    expect(html.match(/<div class="nw-row"/g)?.length).toBe(2);
    expect(html.startsWith('<div class="x-rows">')).toBe(true);
    // Short figures stay in one row of four.
    expect(readingRows(['1,000', '0', '0', '1,000'].map(fig)).match(/<div class="nw-row"/g)?.length).toBe(1);
  });

  it('prints the spine row time as HH:MM:SS with the full UTC on the title, and never truncates the block number', () => {
    const html = renderHome(HOME);
    expect(html).toContain('title="2026-08-18 21:01:00 UTC">21:01:00</span>');
    // Number, time and extrinsic count at their full width; the author takes what is left (ellipsis); the event column keeps its count.
    expect(html).toContain('.nw-spine--explorer .nw-spine-tick{grid-template-columns:max-content max-content max-content minmax(0,1fr) max-content;column-gap:var(--s-3)}');
    expect(html).toContain('.nw-spine--explorer .nw-spine-tick>span{min-width:0;white-space:nowrap}');
    expect(html).toContain('<div class="x-col-4">');
  });

  it('renders every hash-bearing reading stacked and full-width so a 66-character hash never sets the page width', () => {
    const block = renderBlock(BLOCK, CHAIN);
    for (const label of ['Hash', 'Parent', 'State root', 'Extrinsics root']) {
      expect(block).toMatch(new RegExp(`<div class="x-col-12"><div class="nw-reading nw-reading--stack x-wide">\\s*<div class="nw-reading-line"><span class="nw-label">${label}</span>`));
    }
    expect(block).toContain('.nw-reading.x-wide .nw-reading-figure .nw-figure,.x-hash{white-space:normal;overflow-wrap:anywhere;word-break:break-all}');
    expect(renderExtrinsic(EXTRINSIC, CHAIN)).toContain('<p class="nw-mono x-hash">');
    expect(renderAccount(ACCOUNT, CHAIN)).toMatch(/<div class="x-col-12"><div class="nw-reading nw-reading--stack x-wide">\s*<div class="nw-reading-line"><span class="nw-label">Public key<\/span>/);
  });

  it("prints the node's version string from system_version in the footer, not the spec name", () => {
    const html = renderHome({ ...HOME, chain: { ...CHAIN, nodeVersion: '4.0.0-5f5e3c9439f' } });
    expect(html).toContain('spec 309 · node 4.0.0-5f5e3c9439f');
    expect(renderHome(HOME)).toContain('spec 309 · node —');
    expect(renderHome(HOME)).not.toContain('node scalar-commons');
  });
});

describe("the Spine's event column: the pulse model's kinds as glyphs", () => {
  it('mirrors landing/src/pulse/model.js EVENTS row for row (section, method, kind, word)', () => {
    const model = readFileSync(fileURLToPath(new URL('../../landing/src/pulse/model.js', import.meta.url)), 'utf8');
    const rows = [...model.matchAll(/\{ section: '([^']+)', method: '([^']+)', kind: '([^']+)', lifetimeMs: \d+, describe: '([^']+)' \}/g)].map((m) => ({ section: m[1], method: m[2], kind: m[3], describe: m[4] }));
    expect(rows.length).toBe(8);
    expect(PULSE_EVENTS).toEqual(rows);
  });

  it('draws one glyph per kind present, in the legend order, named by the model word; resolved and system events draw none', () => {
    const html = eventGlyphs([
      { section: 'system', method: 'ExtrinsicSuccess' },
      { section: 'oracle', method: 'BatchResponseSubmitted' },
      { section: 'escrow', method: 'AgreementCreated' },
      { section: 'escrow', method: 'AgreementCreated' },
      { section: 'escrow', method: 'DisputeResolved' },
    ]);
    expect(html).toBe(
      '<span class="x-glyph" data-kind="agreement" role="img" aria-label="agreement opened" title="agreement opened"></span>' +
        '<span class="x-glyph" data-kind="oracle" role="img" aria-label="oracle answer" title="oracle answer"></span>',
    );
    expect(eventGlyphs([{ section: 'system', method: 'ExtrinsicSuccess' }])).toBe('');
  });

  it('prints the glyphs before the event count in the home Spine, in ink and rule tokens only', () => {
    const html = renderHome(HOME);
    expect(html).toMatch(/\.x-glyph\[data-kind="dispute"\]::before\{[^}]*border-top:1px dashed var\(--ink\)\}/);
    expect(html).not.toMatch(/\.x-glyph[^{]*\{[^}]*(?:#|rgb|hsl)/);
  });
});

describe('the plain extrinsic sentence', () => {
  const ev = (section: string, method: string, fields: Record<string, string>) => ({ index: 0, section, method, fields: Object.entries(fields).map(([name, value]) => ({ name, value })) });

  it("says what happened in the pulse model's words, from the decoded event fields", () => {
    const html = plainSentence([ev('system', 'ExtrinsicSuccess', {}), ev('escrow', 'AgreementCreated', { buyer: ALICE, provider: BOB, seq: '3', amount: '12,500,000,000,000' })], CHAIN);
    expect(html).toContain(' opened an agreement with ');
    expect(html).toContain(`href="/account/${ALICE}"`);
    expect(html).toContain(`href="/account/${BOB}"`);
    expect(html).toMatch(/ for 12\.5 CMN$/);
    expect(plainSentence([ev('oracle', 'BatchResponseSubmitted', { agent: BOB, accepted: '1', skipped: '0' })], CHAIN)).toMatch(/ answered 1 oracle question$/);
    expect(plainSentence([ev('agents', 'AgentRegistered', { who: ALICE, stake: '1', fee: '0' })], CHAIN)).toMatch(/ joined the network$/);
  });

  it('prints no sentence for an extrinsic with none of those events, or a field that did not decode as expected', () => {
    expect(plainSentence([ev('system', 'ExtrinsicSuccess', {})], CHAIN)).toBeNull();
    expect(plainSentence([ev('escrow', 'AgreementCreated', { buyer: ALICE, provider: BOB, amount: '12.5 kCMN' })], CHAIN)).toBeNull();
    expect(plainSentence([ev('escrow', 'DisputeOpened', { buyer: '0', provider: BOB })], CHAIN)).toBeNull();
    expect(renderExtrinsic(EXTRINSIC, CHAIN)).not.toContain('data-sentence');
  });

  it('puts the sentence under the hash on the extrinsic page', () => {
    const html = renderExtrinsic({ ...EXTRINSIC, outcome: { kind: 'success' }, events: [ev('escrow', 'DisputeOpened', { buyer: ALICE, provider: BOB, seq: '1', request_id: '0x00' })] }, CHAIN);
    expect(html).toMatch(/<p class="nw-mono x-hash">[\s\S]*<\/p>\n<p class="nw-body" data-sentence>.* disputed a delivery from .*\.<\/p>/);
  });
});
