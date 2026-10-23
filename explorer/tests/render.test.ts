import { describe, it, expect } from 'vitest';

import { feeOf, renderAccount, renderActivity, renderBlock, renderBlocks, renderError, renderExtrinsic, renderHome, renderSearchMiss } from '../src/render.js';
import type { AccountView, ActivityView, BlockView, BlocksView, ChainInfo, ExtrinsicView, HomeView, Read } from '../src/types.js';

/**
 * Every page as a pure function of its view model, held to §5.5: the shared
 * components, plain words, two decimals, relative times with the UTC in the
 * title, the tab in the URL, pagination at 25, and footers that say what was
 * read. Nothing here touches a node; the live suite covers decoding.
 */

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';
const AT = '2026-10-23T12:00:00.000Z';
/** 4 minutes before AT. */
const FOUR_MIN_AGO = BigInt(new Date(AT).getTime() - 4 * 60_000);

const CHAIN: ChainInfo = {
  chain: 'Scalar Commons Local Testnet',
  specName: 'scalar-commons',
  specVersion: 309,
  tokenSymbol: 'CMN',
  tokenDecimals: 12,
  ss58Format: 42,
  genesisHash: `0x${'ff'.repeat(32)}`,
  nodeVersion: '4.0.0-5f5e3c9439f',
};

const ok = <T>(value: T, url = 'x', method = 'STORAGE'): Read<T> => ({ value, source: { method, url, fetchedAt: AT, block: 42, raw: null }, reason: null });
const failed = <T>(reason: string, url = 'x'): Read<T> => ({ value: null, source: { method: 'GET', url, fetchedAt: AT, block: null, raw: null }, reason });

const HOME: HomeView = {
  chain: CHAIN,
  head: { number: 1_166_072, hash: `0x${'aa'.repeat(32)}` },
  readings: {
    renderedAt: AT,
    headAgeMs: 4_000,
    finalized: ok({ number: 1_166_071, hash: `0x${'ab'.repeat(32)}` }, 'chain_getFinalizedHead', 'RPC'),
    recent: ok([
      {
        number: 1_166_072,
        hash: `0x${'aa'.repeat(32)}`,
        timestampMs: FOUR_MIN_AGO,
        author: BOB,
        extrinsics: [{ index: 0, section: 'timestamp', method: 'set', hash: `0x${'11'.repeat(32)}`, isSigned: false, signer: null, outcome: { kind: 'success' } }],
        events: [{ index: 0, section: 'system', method: 'ExtrinsicSuccess', fields: [], extrinsicIndex: 0 }],
      },
      { number: 1_166_071, hash: `0x${'ac'.repeat(32)}`, timestampMs: FOUR_MIN_AGO - 6_000n, author: null, extrinsics: [], events: [] },
    ]),
  },
  agents: ok(204, '/v1/agents?limit=1', 'GET'),
  emission: ok({ lastEraEmission: 1_234_567_000_000_000n, lastSettledEra: 172 }, '/v1/emissions', 'GET'),
  activity: ok(
    [{ id: '1165870-2', blockNumber: 1_165_870, extrinsicIndex: 1, timestampMs: FOUR_MIN_AGO, kind: 'heartbeat', section: 'agents', method: 'HeartbeatSent', agents: [ALICE], fields: [{ name: 'who', value: ALICE, kind: 'account' }] }],
    '/v1/activity?limit=10',
    'GET',
  ),
  indexerReadAt: AT,
};

describe('renderHome', () => {
  const html = renderHome(HOME);

  it('puts the search field first, then the four stats, the two lists side by side, then the chain facts', () => {
    const order = ['role="search"', '<h1 class="sc-h2" id="now-h">Scalar Commons testnet</h1>', 'Block height', 'Last era emission', 'Latest blocks', 'Latest activity', 'About this chain'].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('placeholder="Search by block number, block hash, extrinsic (block-index) or address"');
    expect(html).toContain('<form class="sc-search-row" role="search" action="/search" method="get">');
    expect(html).toContain('<div class="sc-cols-2">');
  });

  it('shows the four stats from the node and the index: height, finalized, agents, last era emission at two decimals with the era', () => {
    expect(html).toContain('<span class="sc-stat-label">Block height</span><span class="sc-stat-value">1,166,072</span>');
    expect(html).toContain('<span class="sc-stat-label">Finalized</span><span class="sc-stat-value">1,166,071</span>');
    expect(html).toContain('<span class="sc-stat-label">Registered agents</span><span class="sc-stat-value">204</span>');
    expect(html).toContain('<span class="sc-stat-label">Last era emission</span><span class="sc-stat-value"><span title="1,234.567 CMN">1,234.57 CMN</span></span><span class="sc-stat-caption">era 172</span>');
  });

  it('lists the latest blocks (Block, Age, Author, Finalized) with relative ages carrying the UTC time', () => {
    expect(html).toContain('<caption class="sc-sr">Latest blocks</caption><thead><tr><th scope="col">Block</th><th scope="col">Age</th><th scope="col">Author</th><th scope="col">Finalized</th></tr></thead>');
    expect(html).toContain('<a class="sc-mono" href="/block/1166072">1,166,072</a>');
    expect(html).toContain('title="23 Oct 2026, 11:56 UTC">4 min ago</time>');
    expect(html).toContain(`href="/account/${BOB}" title="${BOB}">5FHneW…94ty</a>`);
    expect(html).toContain('sc-badge sc-badge-warn">Pending</span>');
    expect(html).toContain('sc-badge sc-badge-ok">Finalized</span>');
    expect(html).toContain('not in the pre-digest');
    expect(html).toContain('class="sc-btn sc-btn-text" href="/blocks">View all');
    expect(html).toContain('class="sc-btn sc-btn-text" href="/activity">View all');
  });

  it('lists the latest activity in plain words (Time, Event, Agent)', () => {
    expect(html).toContain('<caption class="sc-sr">Latest activity</caption><thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Agent</th></tr></thead>');
    expect(html).toContain('<span title="agents.HeartbeatSent">Heartbeat sent</span>');
    expect(html).toContain(`href="/account/${ALICE}" title="${ALICE}">5Grwva…utQY</a>`);
  });

  it('keeps the on-chain name to the About table and names the runtime, token, SS58 prefix and genesis there', () => {
    const about = html.slice(html.indexOf('About this chain'));
    expect(about).toContain('<th scope="row">Chain name</th><td>Scalar Commons Local Testnet</td>');
    expect(about).toContain('<th scope="row">Runtime</th><td>scalar-commons 309</td>');
    expect(about).toContain('<th scope="row">Token</th><td>CMN, 12 decimals</td>');
    expect(about).toContain('<th scope="row">SS58 prefix</th><td>42</td>');
    expect(about).toContain(`<span class="sc-full">0x${'ff'.repeat(32)}</span>`);
    expect(about).toContain(`data-copy="0x${'ff'.repeat(32)}"`);
    expect(about).toContain('4.0.0-5f5e3c9439f');
    expect(html.slice(0, html.indexOf('About this chain'))).not.toContain('Local Testnet');
    expect(html).toContain('<h1 class="sc-h2" id="now-h">Scalar Commons testnet</h1>');
  });

  it('names what it read in the footer line', () => {
    expect(html).toContain('Page built 23 Oct 2026, 12:00 UTC from block 1,166,072. Read from the node at block 1,166,072. Lists from the indexer, read at 23 Oct 2026, 12:00 UTC.');
  });

  it('renders a failed indexer read as a stat that says so and a warning callout, never a zero', () => {
    const down = renderHome({ ...HOME, agents: failed('The indexer did not answer in time.'), activity: failed('The indexer did not answer in time.') });
    expect(down).toContain('<span class="sc-stat-label">Registered agents</span><span class="sc-stat-value">Unavailable</span><span class="sc-stat-caption">The indexer did not answer in time.</span>');
    expect(down).toContain('sc-callout sc-callout-warning" role="alert"');
    expect(down).toContain('The latest activity could not be read. The indexer did not answer in time.');
    expect(down).not.toContain('sc-stat-value">0<');
  });

  it('renders a reduced view (no readings) without inventing a figure', () => {
    const bare = renderHome({ chain: CHAIN, head: HOME.head });
    expect(bare).toContain('<span class="sc-stat-value">Unavailable</span>');
    expect(bare).toContain('could not be read');
  });
});

describe('renderBlocks', () => {
  const view: BlocksView = {
    chain: CHAIN,
    best: 1_166_072,
    finalized: 1_166_070,
    renderedAt: AT,
    page: {
      total: 669_577,
      limit: 25,
      offset: 25,
      items: [
        { number: 1_166_045, hash: `0x${'aa'.repeat(32)}`, timestampMs: FOUR_MIN_AGO, extrinsicCount: 1, eventCount: 1, author: BOB },
        { number: 1_166_044, hash: `0x${'ab'.repeat(32)}`, timestampMs: null, extrinsicCount: 3, eventCount: 12, author: null },
      ],
    },
  };
  const html = renderBlocks(view);

  it('tables Block, Age, Hash, Author, Extrinsics, Events, Finalized at 25 a page with Previous/Next', () => {
    expect(html).toContain('<h1 class="sc-h1">Blocks</h1>');
    expect(html).toContain('<thead><tr><th scope="col">Block</th><th scope="col">Age</th><th scope="col">Hash</th><th scope="col">Author</th><th scope="col" class="sc-r">Extrinsics</th><th scope="col" class="sc-r">Events</th><th scope="col">Finalized</th></tr></thead>');
    expect(html).toContain(`<a href="/block/0x${'aa'.repeat(32)}" title="0x${'aa'.repeat(32)}">0xaaaaaa…aaaaaa</a>`);
    expect(html).toContain('<td class="sc-r">12</td>');
    expect(html).toContain('no timestamp');
    expect(html).toContain('class="sc-btn sc-btn-secondary" href="/blocks">Previous</a>');
    expect(html).toContain('class="sc-btn sc-btn-secondary" href="/blocks?offset=50">Next</a>');
    expect(html).toContain('Showing 26–27 of 669,577');
    expect(html).toContain('<link rel="canonical" href="https://explorer.scalarnet.io/blocks?offset=25">');
    expect(html).toContain('List from the indexer, read at 23 Oct 2026, 12:00 UTC. Authors from the node at block 1,166,072.');
  });

  it('disables Previous on the first page and Next on the last', () => {
    const first = renderBlocks({ ...view, page: { ...view.page, offset: 0, total: 2 } });
    expect(first).toContain('<span class="sc-btn sc-btn-secondary" aria-disabled="true">Previous</span>');
    expect(first).toContain('<span class="sc-btn sc-btn-secondary" aria-disabled="true">Next</span>');
    expect(first).toContain('Showing 1–2 of 2');
    expect(renderBlocks({ ...view, page: { ...view.page, offset: 0, total: 0, items: [] } })).toContain('The indexer holds no blocks yet.');
  });
});

const BLOCK: BlockView = {
  number: 1_166_072,
  hash: `0x${'aa'.repeat(32)}`,
  parentHash: `0x${'bb'.repeat(32)}`,
  stateRoot: `0x${'cc'.repeat(32)}`,
  extrinsicsRoot: `0x${'dd'.repeat(32)}`,
  timestampMs: FOUR_MIN_AGO,
  specVersion: 309,
  extrinsics: [
    { index: 0, section: 'timestamp', method: 'set', hash: `0x${'11'.repeat(32)}`, isSigned: false, signer: null, outcome: { kind: 'success' } },
    { index: 1, section: 'balances', method: 'transferKeepAlive', hash: `0x${'22'.repeat(32)}`, isSigned: true, signer: ALICE, outcome: { kind: 'failed', reason: 'balances.InsufficientBalance' } },
  ],
  detail: {
    renderedAt: AT,
    best: 1_166_074,
    finalized: ok(true, 'chain_getFinalizedHead', 'RPC'),
    author: ok(BOB),
    slot: ok('123456'),
    era: ok(7),
    session: ok(14),
    weight: failed('x'),
    events: [
      { index: 0, section: 'system', method: 'ExtrinsicSuccess', fields: [{ name: 'dispatchInfo', value: '{}' }], extrinsicIndex: 0 },
      { index: 1, section: 'balances', method: 'Transfer', fields: [{ name: 'from', value: ALICE }, { name: 'to', value: BOB }, { name: 'amount', value: '12,500,000,000,000' }], extrinsicIndex: 1 },
      { index: 2, section: 'session', method: 'NewSession', fields: [{ name: 'sessionIndex', value: '15' }], extrinsicIndex: null },
    ],
  },
};

describe('renderBlock', () => {
  const html = renderBlock(BLOCK, CHAIN);

  it('has the breadcrumb, the key/value facts with separators and the Finalized badge, and previous/next buttons', () => {
    expect(html).toContain('<nav class="sc-crumbs" aria-label="Breadcrumb"><a href="/">Explorer</a>');
    expect(html).toContain('<span aria-current="page">Block 1,166,072</span>');
    expect(html).toContain('<h1 class="sc-h1">Block 1,166,072</h1>');
    expect(html).toContain('<th scope="row">Number</th><td>1,166,072</td>');
    expect(html).toContain(`<th scope="row">Hash</th><td><span class="sc-full">0x${'aa'.repeat(32)}</span> <button type="button" class="sc-copy" data-copy="0x${'aa'.repeat(32)}"`);
    expect(html).toContain(`<th scope="row">Parent</th><td><a class="sc-full" href="/block/0x${'bb'.repeat(32)}">0x${'bb'.repeat(32)}</a></td>`);
    expect(html).toContain('<th scope="row">Timestamp</th><td>23 Oct 2026, 11:56 UTC (<time datetime="2026-10-23T11:56:00.000Z" title="23 Oct 2026, 11:56 UTC">4 min ago</time>)</td>');
    expect(html).toContain(`<th scope="row">Author</th><td><span class="sc-addr"><a href="/account/${BOB}" title="${BOB}">5FHneW…94ty</a>`);
    expect(html).toContain('<th scope="row">Status</th><td><span class="sc-badge sc-badge-ok">Finalized</span></td>');
    expect(html).toContain('<th scope="row">Extrinsics</th><td>2</td>');
    expect(html).toContain('<th scope="row">Events</th><td>3</td>');
    expect(html).toContain(`<th scope="row">State root</th><td><span class="sc-full">0x${'cc'.repeat(32)}</span></td>`);
    expect(html).toContain('class="sc-btn sc-btn-secondary" href="/block/1166071">Previous block</a>');
    expect(html).toContain('class="sc-btn sc-btn-secondary" href="/block/1166073">Next block</a>');
    expect(html).not.toContain('1166072</h1>');
  });

  it('shows the Extrinsics tab by default with calls in words and the raw name, signers linked, results as badges', () => {
    expect(html).toContain('<div class="sc-tabs" role="tablist" aria-label="Block contents"><a role="tab" href="/block/1166072" aria-selected="true">Extrinsics (2)</a><a role="tab" href="/block/1166072?tab=events" aria-selected="false">Events (3)</a></div>');
    expect(html).toContain('<a class="sc-mono" href="/extrinsic/1166072/1">1,166,072-1</a>');
    expect(html).toContain('Transfer tokens (keeping the sender alive) <span class="sc-caption sc-mono">balances.transferKeepAlive</span>');
    expect(html).toContain('Set the block time (inherent) <span class="sc-caption sc-mono">timestamp.set</span>');
    expect(html).toContain('unsigned (inherent)');
    expect(html).toContain(`href="/account/${ALICE}"`);
    expect(html).toContain('<span class="sc-badge sc-badge-bad">Failed</span> <span class="sc-caption sc-mono">balances.InsufficientBalance</span>');
    expect(html).toContain('<span class="sc-badge sc-badge-ok">Succeeded</span>');
    expect(html).not.toContain('<caption class="sc-sr">Events</caption>');
  });

  it('shows the Events tab from the URL, in plain words with details and the extrinsic each belongs to', () => {
    const events = renderBlock(BLOCK, CHAIN, 'events');
    expect(events).toContain('<a role="tab" href="/block/1166072?tab=events" aria-selected="true">Events (3)</a>');
    expect(events).toContain('<link rel="canonical" href="https://explorer.scalarnet.io/block/1166072?tab=events">');
    expect(events).toContain('<span title="system.ExtrinsicSuccess">Extrinsic succeeded</span>');
    expect(events).toContain('<span title="balances.Transfer">Transfer</span>');
    expect(events).toContain('amount <span title="12.5 CMN">12.50 CMN</span>');
    expect(events).toContain('<span title="session.NewSession">New session</span>');
    expect(events).toContain('session index 15');
    expect(events).toContain('block hook');
    expect(events).not.toContain('dispatchInfo');
    expect(events).not.toContain('<caption class="sc-sr">Extrinsics</caption>');
  });

  it('marks a block past finality Pending, and says so plainly when it has no extrinsics', () => {
    const best = renderBlock({ ...BLOCK, detail: { ...BLOCK.detail!, finalized: ok(false) } }, CHAIN);
    expect(best).toContain('<th scope="row">Status</th><td><span class="sc-badge sc-badge-warn">Pending</span></td>');
    expect(renderBlock({ ...BLOCK, extrinsics: [] }, CHAIN)).toContain('This block has no extrinsics.');
    expect(renderBlock({ ...BLOCK, extrinsics: [{ ...BLOCK.extrinsics[1]!, isSigned: true, signer: null }] }, CHAIN)).toContain('signed (its address is not an AccountId)');
  });

  it('offers no Previous on genesis and no Next past the best block', () => {
    const genesis = renderBlock({ ...BLOCK, number: 0, detail: { ...BLOCK.detail!, best: 0 } }, CHAIN);
    expect(genesis).not.toContain('Previous block');
    expect(genesis).not.toContain('Next block');
    expect(genesis).toContain('none (genesis)');
  });
});

const EXTRINSIC: ExtrinsicView = {
  block: { number: 1_166_072, hash: `0x${'aa'.repeat(32)}` },
  index: 1,
  hash: `0x${'22'.repeat(32)}`,
  section: 'escrow',
  method: 'createAgreement',
  isSigned: true,
  signer: ALICE,
  nonce: 7,
  tip: 0n,
  lengthBytes: 138,
  args: [
    { name: 'provider', type: 'AccountId', value: BOB },
    { name: 'amount', type: 'Compact<u128>', value: '12,500,000,000,000' },
  ],
  events: [
    { index: 3, section: 'escrow', method: 'AgreementCreated', fields: [{ name: 'buyer', value: ALICE }, { name: 'provider', value: BOB }, { name: 'seq', value: '3' }, { name: 'amount', value: '12,500,000,000,000' }] },
    { index: 4, section: 'transactionPayment', method: 'TransactionFeePaid', fields: [{ name: 'who', value: ALICE }, { name: 'actualFee', value: '108,157,176' }, { name: 'tip', value: '0' }] },
    { index: 5, section: 'system', method: 'ExtrinsicSuccess', fields: [{ name: 'dispatchInfo', value: '{}' }] },
  ],
  outcome: { kind: 'success' },
  accounts: [ALICE, BOB],
  renderedAt: AT,
};

describe('renderExtrinsic', () => {
  const html = renderExtrinsic(EXTRINSIC, CHAIN);

  it('keys the facts: block, index, hash with copy, signer, the call in words and raw, the result badge, the fee, the nonce', () => {
    expect(html).toContain('<span aria-current="page">Extrinsic 1,166,072-1</span>');
    expect(html).toContain('<h1 class="sc-h1">Extrinsic 1,166,072-1</h1><p class="sc-lead">Open an agreement.</p>');
    expect(html).toContain('<th scope="row">Block</th><td><a class="sc-mono" href="/block/1166072">1,166,072</a></td>');
    expect(html).toContain('<th scope="row">Index</th><td>1</td>');
    expect(html).toContain(`data-copy="0x${'22'.repeat(32)}"`);
    expect(html).toContain(`<th scope="row">Signer</th><td><span class="sc-addr"><a href="/account/${ALICE}"`);
    expect(html).toContain('<th scope="row">Call</th><td>Open an agreement <span class="sc-caption sc-mono">escrow.createAgreement</span></td>');
    expect(html).toContain('<th scope="row">Result</th><td><span class="sc-badge sc-badge-ok">Succeeded</span></td>');
    expect(html).toContain('<th scope="row">Fee</th><td><span title="0.000108157176 CMN">&lt;0.01 CMN</span></td>');
    expect(html).toContain('<th scope="row">Nonce</th><td>7</td>');
    expect(html).toContain('<th scope="row">Size</th><td>138 bytes</td>');
    expect(html).not.toContain('<th scope="row">Tip</th>');
  });

  it('reads the fee from the TransactionFeePaid event, or none', () => {
    expect(feeOf(EXTRINSIC.events)).toBe(108_157_176n);
    expect(feeOf([])).toBeNull();
    expect(renderExtrinsic({ ...EXTRINSIC, events: [] }, CHAIN)).not.toContain('<th scope="row">Fee</th>');
  });

  it('tables the arguments (name, type, value) and the events in words, with balances at two decimals', () => {
    expect(html).toContain('<th scope="col">Argument</th><th scope="col">Type</th><th scope="col">Value</th>');
    expect(html).toContain(`<td>Provider</td><td><span class="sc-mono">AccountId</span></td><td><span class="sc-full">${BOB}</span></td>`);
    expect(html).toContain('<td>Amount</td><td><span class="sc-mono">Compact&lt;u128&gt;</span></td><td><span class="sc-full">12,500,000,000,000</span></td>');
    expect(html).toContain('<span title="escrow.AgreementCreated">Agreement opened</span>');
    expect(html).toContain('agreement #3 · amount <span title="12.5 CMN">12.50 CMN</span>');
    expect(html).toContain('<span title="transactionPayment.TransactionFeePaid">Transaction fee paid</span>');
    expect(html).toContain('actual fee <span title="0.000108157176 CMN">&lt;0.01 CMN</span>');
    expect(html).toContain(`href="/account/${BOB}"`);
  });

  it('shows a failed result with its reason, an unsigned extrinsic without a signer, and escapes chain values', () => {
    const failedHtml = renderExtrinsic({ ...EXTRINSIC, outcome: { kind: 'failed', reason: 'escrow.NotDelivered' } }, CHAIN);
    expect(failedHtml).toContain('<span class="sc-badge sc-badge-bad">Failed</span> <span class="sc-caption sc-mono">escrow.NotDelivered</span>');
    const inherent = renderExtrinsic({ ...EXTRINSIC, isSigned: false, signer: null, nonce: null, tip: null, accounts: [], events: [], args: [] }, CHAIN);
    expect(inherent).toContain('unsigned (inherent)');
    expect(inherent).not.toContain('href="/account/');
    expect(inherent).toContain('This call takes no arguments.');
    expect(inherent).toContain('No events were recorded for this extrinsic.');
    const hostile = renderExtrinsic({ ...EXTRINSIC, args: [{ name: 'remark', type: 'Bytes', value: '<img src=x onerror=alert(1)>' }] }, CHAIN);
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(renderExtrinsic({ ...EXTRINSIC, isSigned: true, signer: null }, CHAIN)).toContain('signed (its address is not an AccountId)');
  });
});

const ACCOUNT: AccountView = {
  address: BOB,
  publicKey: `0x${'ee'.repeat(32)}`,
  free: 1_000_051_912_360_000_000_000n,
  reserved: 10_000_000_000_000_000n,
  frozen: 0n,
  nonce: 162,
  at: { number: 1_166_990, hash: `0x${'aa'.repeat(32)}` },
  roles: {
    renderedAt: AT,
    agentName: ok('swarm-0007'),
    agentStake: ok(10_000_000_000_000_000n),
    bonded: ok(null),
    validator: ok(false),
    heartbeat: ok({ lastHeartbeat: 1_166_000, best: 1_166_990, grace: 10_800, decay: 10_800 }),
  },
  agent: ok({ name: 'swarm-0007', stakePlancks: 10_000_000_000_000_000n, registeredAtBlock: 0, lastHeartbeatBlock: 1_166_000, unstakeAtBlock: null, completedAgreements: 192, activeEscrowCount: 6 }, '/v1/agents/x', 'GET'),
  tab: 'extrinsics',
  extrinsics: ok({ total: 68, limit: 25, offset: 0, items: [{ blockNumber: 929_761, index: 1, hash: `0x${'33'.repeat(32)}`, section: 'escrow', method: 'recordDelivery', timestampMs: null, success: false }] }, '/v1/accounts/x/extrinsics', 'GET'),
};

describe('renderAccount', () => {
  const html = renderAccount(ACCOUNT, CHAIN);

  it('heads with the full address and a copy button, then the balances at two decimals with the full plancks in the title', () => {
    expect(html).toContain(`<h1 class="sc-h1">Account</h1><p class="sc-full">${BOB} <button type="button" class="sc-copy" data-copy="${BOB}" aria-label="Copy address ${BOB}">`);
    expect(html).toContain('<th scope="row">Free balance</th><td><span title="1,000,051,912.36 CMN">1,000,051,912.36 CMN</span></td>');
    expect(html).toContain('<th scope="row">Reserved</th><td><span title="10,000 CMN">10,000.00 CMN</span></td>');
    expect(html).toContain('<th scope="row">Total</th><td><span title="1,000,061,912.36 CMN">1,000,061,912.36 CMN</span> <span class="sc-caption">free + reserved</span></td>');
    expect(html).toContain('<th scope="row">Transactions sent</th><td>162</td>');
    expect(html).not.toContain('1084.514632607691');
  });

  it('shows the Agent card from the index: name, status badge, stake, registered at, heartbeat age, operator-run badge', () => {
    const card = html.slice(html.indexOf('<article class="sc-card"'), html.indexOf('</article>'));
    expect(card).toContain('<h3 id="agent-h">Agent</h3>');
    expect(card).toContain('<th scope="row">Name</th><td>swarm-0007 <span class="sc-badge">Operator-run</span></td>');
    expect(card).toContain('<th scope="row">Status</th><td><span class="sc-badge sc-badge-ok">Active</span></td>');
    expect(card).toContain('<th scope="row">Stake</th><td><span title="10,000 CMN">10,000.00 CMN</span></td>');
    expect(card).toContain('<th scope="row">Registered at</th><td>genesis</td>');
    expect(card).toContain('<th scope="row">Last heartbeat</th><td><a class="sc-mono" href="/block/1166000">1,166,000</a> <span class="sc-caption">990 blocks ago</span></td>');
    expect(card).toContain('<th scope="row">Agreements</th><td>192 completed, 6 open</td>');
    expect(card).toContain(`class="sc-btn sc-btn-text" href="/activity?agent=${BOB}">Agent activity`);
  });

  it('badges a stale heartbeat and a pending unstake, and shows no card for an account that is not an agent', () => {
    const stale = renderAccount({ ...ACCOUNT, roles: { ...ACCOUNT.roles!, heartbeat: ok({ lastHeartbeat: 543_472, best: 1_166_990, grace: 10_800, decay: 10_800 }) } }, CHAIN);
    expect(stale).toContain('<span class="sc-badge sc-badge-warn">Stale</span> <span class="sc-caption">no heartbeat within the grace period of 10,800 blocks</span>');
    const leaving = renderAccount({ ...ACCOUNT, agent: ok({ ...ACCOUNT.agent!.value!, unstakeAtBlock: 1_200_000 }) }, CHAIN);
    expect(leaving).toContain('<span class="sc-badge sc-badge-warn">Pending</span> <span class="sc-caption">unstaking at block 1,200,000</span>');
    const plain = renderAccount({ ...ACCOUNT, agent: ok(null), roles: { ...ACCOUNT.roles!, agentName: ok(null), agentStake: ok(null), heartbeat: ok(null) } }, CHAIN);
    expect(plain).not.toContain('sc-card');
    const down = renderAccount({ ...ACCOUNT, agent: failed('The indexer did not answer in time.'), roles: { ...ACCOUNT.roles!, agentName: ok(null), agentStake: ok(null), heartbeat: ok(null) } }, CHAIN);
    expect(down).toContain('The agent record could not be read from the indexer. The indexer did not answer in time.');
  });

  it('tabs Extrinsics and Activity with the tab in the URL, paginated at 25', () => {
    expect(html).toContain(`<div class="sc-tabs" role="tablist" aria-label="Account history"><a role="tab" href="/account/${BOB}" aria-selected="true">Extrinsics</a><a role="tab" href="/account/${BOB}?tab=activity" aria-selected="false">Activity</a></div>`);
    expect(html).toContain('<a class="sc-mono" href="/extrinsic/929761/1">929,761-1</a>');
    expect(html).toContain('Record a delivery <span class="sc-caption sc-mono">escrow.recordDelivery</span>');
    expect(html).toContain('<span class="sc-badge sc-badge-bad">Failed</span>');
    expect(html).toContain(`class="sc-btn sc-btn-secondary" href="/account/${BOB}?offset=25">Next</a>`);
    expect(html).toContain('Showing 1–1 of 68');
    const activity = renderAccount(
      {
        ...ACCOUNT,
        tab: 'activity',
        extrinsics: undefined,
        events: ok({ total: 464, limit: 25, offset: 25, items: [{ id: '929761-2', blockNumber: 929_761, extrinsicIndex: 1, timestampMs: FOUR_MIN_AGO, kind: null, section: 'transactionPayment', method: 'TransactionFeePaid', agents: [BOB], fields: [{ name: 'who', value: BOB, kind: 'account' }, { name: 'actual_fee', value: '108157176', kind: 'balance' }, { name: 'tip', value: '0', kind: 'balance' }] }] }),
      },
      CHAIN,
    );
    expect(activity).toContain(`<a role="tab" href="/account/${BOB}?tab=activity" aria-selected="true">Activity</a>`);
    expect(activity).toContain('<span title="transactionPayment.TransactionFeePaid">Transaction fee paid</span>');
    expect(activity).toContain('actual fee <span title="0.000108157176 CMN">&lt;0.01 CMN</span>');
    expect(activity).toContain(`class="sc-btn sc-btn-secondary" href="/account/${BOB}?tab=activity">Previous</a>`);
    expect(activity).toContain(`class="sc-btn sc-btn-secondary" href="/account/${BOB}?tab=activity&amp;offset=50">Next</a>`);
    expect(activity).toContain('Showing 26–26 of 464');
    expect(activity).toContain(`<link rel="canonical" href="https://explorer.scalarnet.io/account/${BOB}?tab=activity&amp;offset=25">`);
  });

  it('says what it read in the footer', () => {
    expect(html).toContain('Read from the node at block 1,166,990. List from the indexer.');
  });
});

const ACTIVITY: ActivityView = {
  agent: null,
  filter: null,
  offset: 0,
  limit: 25,
  total: 989_476,
  historyFrom: 496_606,
  readAt: AT,
  best: 1_166_072,
  entries: [
    { id: '120-4', blockNumber: 120, extrinsicIndex: 2, timestampMs: FOUR_MIN_AGO, kind: 'dispute', section: 'escrow', method: 'DisputeOpened', agents: [ALICE, BOB], fields: [{ name: 'buyer', value: ALICE, kind: 'account' }, { name: 'provider', value: BOB, kind: 'account' }, { name: 'seq', value: '1', kind: 'plain' }, { name: 'request_id', value: `0x${'86'.repeat(32)}`, kind: 'plain' }] },
    { id: '118-1', blockNumber: 118, extrinsicIndex: null, timestampMs: null, kind: 'heartbeat', section: 'agents', method: 'HeartbeatSent', agents: [ALICE], fields: [{ name: 'who', value: ALICE, kind: 'account' }] },
    { id: '117-1', blockNumber: 117, extrinsicIndex: 1, timestampMs: FOUR_MIN_AGO, kind: 'slash', section: 'agents', method: 'SlashExecuted', agents: [BOB], fields: [{ name: 'who', value: BOB, kind: 'account' }, { name: 'amount', value: '1000000000000', kind: 'balance' }] },
  ],
};

describe('renderActivity', () => {
  const html = renderActivity(ACTIVITY, CHAIN);

  it('introduces the feed without raw counts and names how far back history reaches', () => {
    expect(html).toContain('<h1 class="sc-h1">Activity</h1><p class="sc-lead">Agent events, newest first. History reaches back to block 496,606.</p>');
    expect(html).not.toMatch(/Showing every agent|989476 events/);
    expect(html).not.toContain('http-equiv="refresh"');
  });

  it('tables Time · Block · Event · Agents · Details on the shared table, with badges for disputes and slashes and each agent once', () => {
    expect(html).toContain('<thead><tr><th scope="col">Time</th><th scope="col">Block</th><th scope="col">Event</th><th scope="col">Agents</th><th scope="col">Details</th></tr></thead>');
    expect(html).toContain('title="23 Oct 2026, 11:56 UTC">4 min ago</time>');
    expect(html).toContain('<a class="sc-mono" href="/block/120">120</a>');
    expect(html).toContain('<span title="escrow.DisputeOpened">Dispute opened</span> <span class="sc-badge sc-badge-bad">Dispute</span>');
    expect(html).toContain('<span title="agents.SlashExecuted">Agent slashed</span> <span class="sc-badge sc-badge-bad">Slashed</span>');
    expect(html).toContain('<span title="agents.HeartbeatSent">Heartbeat sent</span>');
    expect(html).toContain(`agreement #1 · request id <span class="sc-mono" title="0x${'86'.repeat(32)}">0x868686…868686</span>`);
    expect(html).toContain('amount <span title="1 CMN">1.00 CMN</span>');
    // Each agent appears once per row: in the Agents column, never again in Details.
    expect(html.match(new RegExp(`title="${ALICE}">5Grwva…utQY`, 'g'))?.length).toBe(2);
    expect(html).not.toContain(`who: ${ALICE}`);
    expect(html).not.toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z<\/td>/);
    expect(html).toContain('no timestamp');
  });

  it('offers the six filter chips as links, the agent-address field, and pagination at 25', () => {
    expect(html).toContain('<div class="sc-chips" role="group" aria-label="Filter by kind"><a class="sc-chip" href="/activity" aria-current="page">All</a><a class="sc-chip" href="/activity?kind=agreement">Agreements</a><a class="sc-chip" href="/activity?kind=dispute">Disputes</a><a class="sc-chip" href="/activity?kind=message">Messages</a><a class="sc-chip" href="/activity?kind=registration">Registrations</a><a class="sc-chip" href="/activity?kind=slash">Slashes</a></div>');
    expect(html).toContain('<form class="sc-search-row" method="get" action="/activity">');
    expect(html).toContain('name="agent" value="" placeholder="Filter by agent address (SS58)"');
    expect(html).toContain('class="sc-btn sc-btn-secondary" href="/activity?offset=25">Next</a>');
    expect(html).toContain('<span class="sc-btn sc-btn-secondary" aria-disabled="true">Previous</span>');
    expect(html).toContain('Showing 1–3 of 989,476');
    expect(html).toContain('List from the indexer, read at 23 Oct 2026, 12:00 UTC.');
    expect(html).toContain('from block 1,166,072.');
  });

  it('keeps the kind in the chips, the field and the pages when filtered, and the agent when filtered to one', () => {
    const disputes = renderActivity({ ...ACTIVITY, filter: 'dispute', offset: 25, total: 401 }, CHAIN);
    expect(disputes).toContain('<a class="sc-chip" href="/activity?kind=dispute" aria-current="page">Disputes</a>');
    expect(disputes).toContain('<input type="hidden" name="kind" value="dispute">');
    expect(disputes).toContain('href="/activity?kind=dispute">Previous</a>');
    expect(disputes).toContain('href="/activity?kind=dispute&amp;offset=50">Next</a>');
    const agent = renderActivity({ ...ACTIVITY, agent: ALICE, historyFrom: null }, CHAIN);
    expect(agent).toContain(`Events naming <span class="sc-addr"><a href="/account/${ALICE}" title="${ALICE}">5Grwva…utQY</a>`);
    expect(agent).toContain('<a href="/activity">Show every agent</a>');
    expect(agent).toContain(`<a class="sc-chip" href="/activity?agent=${ALICE}&amp;kind=dispute">Disputes</a>`);
    expect(agent).toContain(`name="agent" value="${ALICE}"`);
    expect(agent).toContain(`href="/activity?agent=${ALICE}&amp;offset=25">Next</a>`);
  });

  it('says so when there is nothing, rather than an empty table', () => {
    expect(renderActivity({ ...ACTIVITY, total: 0, entries: [] }, CHAIN)).toContain('colspan="5">No agent events in the index yet.</td>');
    expect(renderActivity({ ...ACTIVITY, total: 25, offset: 25, entries: [] }, CHAIN)).toContain('No agent events this far back.');
    expect(renderActivity({ ...ACTIVITY, agent: ALICE, total: 0, entries: [] }, CHAIN)).toContain('No events name this agent in the indexed history.');
  });
});

describe('renderSearchMiss and renderError', () => {
  it('says nothing was found, lists the four formats with examples from the chain, and offers the field again', () => {
    const html = renderSearchMiss('nothing-here <b>', CHAIN, 1_166_072, AT);
    expect(html).toContain('<h1 class="sc-h1">Nothing found for ‘nothing-here &lt;b&gt;’</h1>');
    expect(html).toContain('A block number, such as <span class="sc-mono">1,166,072</span>');
    expect(html).toContain('A block hash: <span class="sc-mono">0x</span> and 64 hexadecimal characters');
    expect(html).toContain('An extrinsic as block-index, such as <span class="sc-mono">1,166,072-0</span>');
    expect(html).toContain('An account address (SS58)');
    expect(html).toContain('value="nothing-here &lt;b&gt;"');
    expect(html).toContain('<title>Nothing found — Scalar Commons</title>');
  });

  it('renders a plain title, the one sentence it is given and the search field; the sentence is escaped', () => {
    const notFound = renderError(404, 'There is nothing at /nope.', CHAIN);
    expect(notFound).toContain('<h1 class="sc-h1">Page not found</h1><p class="sc-lead">There is nothing at /nope.</p>');
    expect(notFound).toContain('role="search"');
    expect(notFound).toContain('class="sc-btn sc-btn-text" href="/">Explorer home');
    const bad = renderError(400, 'Not a block number or block hash: <b>.', CHAIN);
    expect(bad).toContain('<h1 class="sc-h1">That is not something this explorer can look up</h1>');
    expect(bad).toContain('&lt;b&gt;');
    expect(bad).not.toContain('<b>');
    const down = renderError(502, 'The indexer did not answer in time.', CHAIN);
    expect(down).toContain('<h1 class="sc-h1">Not available right now</h1><p class="sc-lead">The indexer did not answer in time.</p>');
    expect(down).not.toMatch(/127\.0\.0\.1|localhost|:8080|stack|Error:/);
    expect(renderError(502, 'The node did not answer.', null)).toContain('The node did not answer.');
  });
});
