import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  ACTIVITY_PAGE_SIZE,
  IndexerNotFoundError,
  IndexerResponseError,
  IndexerUnavailableError,
  accountEventsPath,
  activityFeedPath,
  agentEventsPath,
  createIndexerReader,
  toActivityView,
  toAgentRecord,
  toAgentsTotal,
  toBlocksPage,
  toEmissions,
  toEventsPage,
  toHistoryPage,
} from '../src/activity.js';
import type { ExplorerChain } from '../src/chain.js';
import { activityPath, parseRoute } from '../src/routes.js';
import { createExplorerServer } from '../src/server.js';
import type { AccountView, ChainInfo } from '../src/types.js';

/**
 * The lists, end to end within the explorer, against a stand-in indexer: the
 * routes, the shaping of what the indexer answered (loudly refusing anything
 * it does not recognise), which indexer path each page asks for — one paged
 * query, never a scan — and the error pages when the indexer does not answer.
 */

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const CHAIN: ChainInfo = {
  chain: 'Scalar Commons Local Testnet',
  specName: 'scalar-commons',
  specVersion: 309,
  tokenSymbol: 'CMN',
  tokenDecimals: 12,
  ss58Format: 42,
  genesisHash: `0x${'ff'.repeat(32)}`,
};

/** Field types as the runtime metadata names them, for the events these tests use. */
const FIELD_TYPES: Record<string, Record<string, string>> = {
  'escrow.AgreementCreated': { buyer: 'T::AccountId', provider: 'T::AccountId', seq: 'u32', amount: 'BalanceOf<T>' },
  'agents.HeartbeatSent': { who: 'T::AccountId' },
};
const fieldTypes = (section: string, method: string) => {
  const types = FIELD_TYPES[`${section}.${method}`];
  return types === undefined ? null : new Map(Object.entries(types));
};

const FEED = {
  total: 2,
  limit: ACTIVITY_PAGE_SIZE,
  offset: 0,
  agent: null,
  kind: null,
  historyFrom: 100,
  items: [
    { id: '120-4', blockNumber: 120, index: 4, extrinsicId: '120-2', timestampMs: 1_787_086_860_000, kind: 'agreement', section: 'escrow', method: 'AgreementCreated', agents: [ALICE, BOB], data: { buyer: ALICE, provider: BOB, seq: 3, amount: '12500000000000' } },
    { id: '118-1', blockNumber: 118, index: 1, extrinsicId: null, timestampMs: null, kind: 'heartbeat', section: 'agents', method: 'HeartbeatSent', agents: [ALICE], data: { who: `<script>alert(1)</script>`, note: '<b>hi</b>' } },
  ],
};

/** The same two events as `/v1/agents/:address/events` serves them: `accounts`, no kind. */
const EVENTS = {
  total: 2,
  limit: ACTIVITY_PAGE_SIZE,
  offset: 0,
  items: FEED.items.map(({ kind, agents, ...rest }) => ({ ...rest, phase: 'ApplyExtrinsic', accounts: agents })),
};

describe('activity routes', () => {
  it('routes the feed, with and without an agent filter, a kind and an offset', () => {
    expect(parseRoute('/activity')).toEqual({ kind: 'activity', agent: null, filter: null, offset: 0 });
    expect(parseRoute(`/activity?agent=${ALICE}`)).toEqual({ kind: 'activity', agent: ALICE, filter: null, offset: 0 });
    expect(parseRoute(`/activity?agent=${ALICE}&offset=50&kind=dispute`)).toEqual({ kind: 'activity', agent: ALICE, filter: 'dispute', offset: 50 });
    // The filter form submits an empty field when cleared; that means "everyone".
    expect(parseRoute('/activity?agent=')).toEqual({ kind: 'activity', agent: null, filter: null, offset: 0 });
    expect(parseRoute(`/activity?agent=%20${ALICE}%20`)).toEqual({ kind: 'activity', agent: ALICE, filter: null, offset: 0 });
  });

  it('refuses a filter that is not an address or a kind, rather than showing an empty feed', () => {
    expect(parseRoute('/activity?agent=nonsense')).toEqual({ kind: 'badRequest', message: 'not a valid SS58 account address: nonsense' });
    expect(parseRoute('/activity?kind=parties')).toEqual({ kind: 'badRequest', message: 'not an activity kind: parties' });
    expect(parseRoute('/activity?offset=-1').kind).toBe('badRequest');
    expect(parseRoute('/activity?offset=1.5').kind).toBe('badRequest');
  });

  it('round-trips through the path builder', () => {
    expect(parseRoute(activityPath())).toEqual({ kind: 'activity', agent: null, filter: null, offset: 0 });
    expect(parseRoute(activityPath(ALICE, 25, 'slash'))).toEqual({ kind: 'activity', agent: ALICE, filter: 'slash', offset: 25 });
    expect(activityPath(null, 0, 'dispute')).toBe('/activity?kind=dispute');
  });

  it('builds the indexer paths: the feed with its filters, the per-agent events, the per-account events', () => {
    expect(activityFeedPath({ agent: null, filter: null, offset: 0 }, 25)).toBe('/v1/activity?limit=25&offset=0');
    expect(activityFeedPath({ agent: ALICE, filter: 'dispute', offset: 50 }, 25)).toBe(`/v1/activity?limit=25&offset=50&agent=${ALICE}&kind=dispute`);
    expect(agentEventsPath(ALICE, 25, 25)).toBe(`/v1/agents/${ALICE}/events?limit=25&offset=25`);
    expect(accountEventsPath(ALICE, 0, 25)).toBe(`/v1/events?account=${ALICE}&limit=25&offset=0`);
  });
});

describe('shaping the indexer’s answers', () => {
  it('keeps the indexer order and types each field from runtime metadata', () => {
    const view = toActivityView(FEED, fieldTypes, { agent: null, filter: null, offset: 0 }, '2026-10-23T12:00:00.000Z');
    expect(view.entries.map((entry) => entry.id)).toEqual(['120-4', '118-1']);
    const [created] = view.entries;
    expect(created?.fields).toEqual([
      { name: 'buyer', value: ALICE, kind: 'account' },
      { name: 'provider', value: BOB, kind: 'account' },
      { name: 'seq', value: '3', kind: 'plain' },
      { name: 'amount', value: '12500000000000', kind: 'balance' },
    ]);
    expect(created?.timestampMs).toBe(1_787_086_860_000n);
    expect(created?.kind).toBe('agreement');
    expect(view.total).toBe(2);
    expect(view.historyFrom).toBe(100);
    expect(view.readAt).toBe('2026-10-23T12:00:00.000Z');
  });

  it('shapes a per-agent events page the same way, with no kind and no history reach', () => {
    const view = toActivityView(EVENTS, fieldTypes, { agent: ALICE, filter: null, offset: 0 });
    expect(view.entries.map((entry) => entry.id)).toEqual(['120-4', '118-1']);
    expect(view.entries[0]?.agents).toEqual([ALICE, BOB]);
    expect(view.entries[0]?.kind).toBeNull();
    expect(view.historyFrom).toBeNull();
    const page = toEventsPage(EVENTS, fieldTypes);
    expect(page.total).toBe(2);
    expect(page.items[1]?.fields).toEqual([{ name: 'who', value: '<script>alert(1)</script>', kind: 'account' }, { name: 'note', value: '<b>hi</b>', kind: 'plain' }]);
  });

  it('falls back to plain text for an event the runtime metadata does not describe', () => {
    const view = toActivityView({ ...FEED, items: [{ ...FEED.items[0]!, section: 'messaging', method: 'MessageSent', kind: 'message', data: { note: 'hi' } }] }, fieldTypes, { agent: null, filter: null, offset: 0 });
    expect(view.entries[0]?.fields).toEqual([{ name: 'note', value: 'hi', kind: 'plain' }]);
  });

  it('refuses an answer that is not what was asked for', () => {
    expect(() => toActivityView({ error: 'nope' }, fieldTypes, { agent: null, filter: null, offset: 0 })).toThrow(IndexerResponseError);
    expect(() => toActivityView({ ...FEED, items: [{ ...FEED.items[0]!, blockNumber: 'x' }] }, fieldTypes, { agent: null, filter: null, offset: 0 })).toThrow(IndexerResponseError);
    expect(() => toBlocksPage({ items: [{}] })).toThrow(IndexerResponseError);
    expect(() => toAgentRecord({ address: ALICE })).toThrow(IndexerResponseError);
    expect(() => toEmissions({})).toThrow(IndexerResponseError);
  });

  it('shapes blocks, history, the agent record, the agent count and the emissions', () => {
    const blocks = toBlocksPage({ total: 10, limit: 25, offset: 0, items: [{ number: 5, hash: '0xab', parentHash: '0x', stateRoot: '0x', extrinsicsRoot: '0x', timestampMs: 1_787_086_860_000, extrinsicCount: 1, eventCount: 2 }] });
    expect(blocks.items[0]).toEqual({ number: 5, hash: '0xab', timestampMs: 1_787_086_860_000n, extrinsicCount: 1, eventCount: 2 });
    const history = toHistoryPage({ total: 1, limit: 25, offset: 0, items: [{ blockNumber: 40, index: 1, hash: '0x11', section: 'balances', method: 'transfer', success: true }] });
    expect(history.items[0]).toEqual({ blockNumber: 40, index: 1, hash: '0x11', section: 'balances', method: 'transfer', timestampMs: null, success: true });
    const agent = toAgentRecord({ address: BOB, stakePlancks: '10000000000000000', registeredAtBlock: 0, lastHeartbeatBlock: 543_472, unstakeAtBlock: null, completedAgreements: 192, activeEscrowCount: 6, metadata: { uri: '', name: 'swarm-0007', updatedAtBlock: 1 } });
    expect(agent).toEqual({ name: 'swarm-0007', stakePlancks: 10_000_000_000_000_000n, registeredAtBlock: 0, lastHeartbeatBlock: 543_472, unstakeAtBlock: null, completedAgreements: 192, activeEscrowCount: 6 });
    expect(toAgentRecord({ stakePlancks: '1', registeredAtBlock: 0, lastHeartbeatBlock: 0, metadata: null }).name).toBeNull();
    expect(toAgentsTotal({ total: 204, limit: 1, offset: 0, items: [{}] })).toBe(204);
    expect(toEmissions({ lastSettledEra: 172, lastEraEmissionPlancks: '0' })).toEqual({ lastEraEmission: 0n, lastSettledEra: 172 });
  });
});

describe('the indexer reader', () => {
  it('tolerates an origin given with /v1 and drops it, so EXPLORER_INDEXER_URL may carry either', () => {
    expect(createIndexerReader({ baseUrl: 'https://api.scalarnet.io/v1' }).baseUrl).toBe('https://api.scalarnet.io');
    expect(createIndexerReader({ baseUrl: 'https://api.scalarnet.io/' }).baseUrl).toBe('https://api.scalarnet.io');
  });

  it('turns a dead host into an unavailable error whose public message names no address', async () => {
    const reader = createIndexerReader({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 });
    const error = await reader.getJson('/v1/status').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IndexerUnavailableError);
    expect((error as IndexerUnavailableError).message).toContain('127.0.0.1:1');
    expect((error as IndexerUnavailableError).publicMessage).toBe('The indexer did not answer.');
  });

  it('turns a timeout into "The indexer did not answer in time."', async () => {
    const slow = createServer(() => {
      // never answers
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    try {
      const reader = createIndexerReader({ baseUrl: `http://127.0.0.1:${(slow.address() as AddressInfo).port}`, timeoutMs: 300 });
      const error = await reader.getJson('/v1/activity').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IndexerUnavailableError);
      expect((error as IndexerUnavailableError).publicMessage).toBe('The indexer did not answer in time.');
    } finally {
      slow.closeAllConnections();
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });
});

describe('the list pages over HTTP', () => {
  let indexer: Server;
  let explorer: Server;
  let base: string;
  const seen: string[] = [];

  const ACCOUNT: AccountView = { address: BOB, publicKey: '0x', free: 0n, reserved: 0n, frozen: 0n, nonce: 0, at: { number: 42, hash: `0x${'aa'.repeat(32)}` } };
  /** Only what the list pages touch; every other view would be a test bug. */
  const chain = {
    chainInfo: () => CHAIN,
    eventFieldTypes: fieldTypes,
    heads: async () => ({ best: 42, finalized: 40 }),
    authors: async (blocks: { hash: string }[]) => new Map(blocks.map((b) => [b.hash, BOB])),
    account: async (address: string) => ({ ...ACCOUNT, address }),
  } as unknown as ExplorerChain;

  beforeAll(async () => {
    indexer = createServer((request, response) => {
      const url = request.url ?? '';
      seen.push(url);
      if (url.includes('fail')) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'node unreachable at ws://127.0.0.1:9944' }));
        return;
      }
      if (url.startsWith(`/v1/agents/${ALICE}/`) || url === `/v1/agents/${ALICE}`) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: `agent ${ALICE} not found` }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      if (url.startsWith('/v1/activity')) response.end(JSON.stringify(FEED));
      else if (url.startsWith('/v1/blocks')) response.end(JSON.stringify({ total: 1, limit: 25, offset: 0, items: [{ number: 41, hash: `0x${'ab'.repeat(32)}`, timestampMs: null, extrinsicCount: 1, eventCount: 1 }] }));
      else if (url.includes('/extrinsics')) response.end(JSON.stringify({ total: 1, limit: 25, offset: 0, items: [{ blockNumber: 40, index: 1, section: 'balances', method: 'transfer', success: true }] }));
      else if (url.startsWith('/v1/agents/')) response.end(JSON.stringify(url.endsWith('/events') || url.includes('/events?') ? EVENTS : { address: BOB, stakePlancks: '1', registeredAtBlock: 0, lastHeartbeatBlock: 1, metadata: null }));
      else response.end(JSON.stringify(EVENTS));
    });
    await new Promise<void>((resolve) => indexer.listen(0, '127.0.0.1', resolve));
    const indexerUrl = `http://127.0.0.1:${(indexer.address() as AddressInfo).port}`;
    explorer = createExplorerServer({ chain, indexer: createIndexerReader({ baseUrl: indexerUrl }), onError: () => {} });
    await new Promise<void>((resolve) => explorer.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(explorer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => explorer.close(() => resolve()));
    await new Promise<void>((resolve) => indexer.close(() => resolve()));
  });

  it('asks the indexer for one page of the feed, 25 at a time, with the kind filter', async () => {
    const response = await fetch(`${base}/activity?offset=25&kind=dispute`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Agreement opened');
    expect(seen.at(-1)).toBe('/v1/activity?limit=25&offset=25&kind=dispute');
  });

  it('reads one agent through /v1/agents/:address/events, never a scan of /v1/activity', async () => {
    const response = await fetch(`${base}/activity?agent=${BOB}&offset=25`);
    expect(response.status).toBe(200);
    expect(seen.at(-1)).toBe(`/v1/agents/${BOB}/events?limit=25&offset=25`);
    expect(seen.filter((u) => u.startsWith('/v1/activity') && u.includes(BOB))).toEqual([]);
    const html = await response.text();
    expect(html).toContain('Events naming');
    expect(html).toContain('Agreement opened');
  });

  it('falls back to /v1/events?account= for an address the indexer does not know as an agent', async () => {
    const response = await fetch(`${base}/activity?agent=${ALICE}`);
    expect(response.status).toBe(200);
    expect(seen.slice(-2)).toEqual([`/v1/agents/${ALICE}/events?limit=25&offset=0`, `/v1/events?account=${ALICE}&limit=25&offset=0`]);
  });

  it('combines an agent and a kind through the feed’s own filters', async () => {
    await fetch(`${base}/activity?agent=${BOB}&kind=slash`);
    expect(seen.at(-1)).toBe(`/v1/activity?limit=25&offset=0&agent=${BOB}&kind=slash`);
  });

  it('serves /blocks from one indexer page and the node’s authors', async () => {
    const response = await fetch(`${base}/blocks?offset=25`);
    expect(response.status).toBe(200);
    expect(seen.at(-1)).toBe('/v1/blocks?limit=25&offset=25');
    const html = await response.text();
    expect(html).toContain('href="/block/41"');
    expect(html).toContain(`title="${BOB}">5FHneW…94ty</a>`);
  });

  it('serves the account tabs from one indexer page each and reads the agent record', async () => {
    const extrinsics = await fetch(`${base}/account/${BOB}`);
    expect(extrinsics.status).toBe(200);
    expect(seen.slice(-2)).toEqual([`/v1/agents/${BOB}`, `/v1/accounts/${BOB}/extrinsics?limit=25&offset=0`]);
    expect(await extrinsics.text()).toContain('href="/extrinsic/40/1"');
    const activity = await fetch(`${base}/account/${BOB}?tab=activity&offset=25`);
    expect(activity.status).toBe(200);
    expect(seen.at(-1)).toBe(`/v1/agents/${BOB}/events?limit=25&offset=25`);
    expect(await activity.text()).toContain('Agreement opened');
    const plain = await fetch(`${base}/account/${ALICE}`);
    expect(plain.status).toBe(200);
    expect(await plain.text()).not.toContain('sc-card');
  });

  it('escapes chain-supplied values', async () => {
    const html = await (await fetch(`${base}/activity`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>hi</b>');
    expect(html).toContain('note &lt;b&gt;hi&lt;/b&gt;');
  });

  it('reports an indexer failure as a 502 page that never shows the indexer’s address or its message', async () => {
    const failing = createExplorerServer({ chain, indexer: createIndexerReader({ baseUrl: `http://127.0.0.1:${(indexer.address() as AddressInfo).port}/fail` }), onError: () => {} });
    await new Promise<void>((resolve) => failing.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(failing.address() as AddressInfo).port}/activity`);
      expect(response.status).toBe(502);
      const html = await response.text();
      expect(html).toContain('<p class="sc-lead">The indexer answered with an error.</p>');
      expect(html).not.toMatch(/127\.0\.0\.1|9944|node unreachable/);
    } finally {
      await new Promise<void>((resolve) => failing.close(() => resolve()));
    }
  });

  it('reports an unreachable indexer as "The indexer did not answer." and a timeout as "… in time."', async () => {
    const orphan = createExplorerServer({ chain, indexer: createIndexerReader({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 }), onError: () => {} });
    await new Promise<void>((resolve) => orphan.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(orphan.address() as AddressInfo).port}/activity`);
      expect(response.status).toBe(502);
      const html = await response.text();
      expect(html).toContain('<p class="sc-lead">The indexer did not answer.</p>');
      expect(html).not.toContain('127.0.0.1:1');
    } finally {
      await new Promise<void>((resolve) => orphan.close(() => resolve()));
    }
    const slow = createServer(() => {
      // never answers
    });
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    const stuck = createExplorerServer({ chain, indexer: createIndexerReader({ baseUrl: `http://127.0.0.1:${(slow.address() as AddressInfo).port}`, timeoutMs: 300 }), onError: () => {} });
    await new Promise<void>((resolve) => stuck.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(stuck.address() as AddressInfo).port}/activity`);
      expect(response.status).toBe(502);
      expect(await response.text()).toContain('<p class="sc-lead">The indexer did not answer in time.</p>');
    } finally {
      await new Promise<void>((resolve) => stuck.close(() => resolve()));
      slow.closeAllConnections();
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });

  it('400s a bad agent filter without asking the indexer, with a plain sentence', async () => {
    const before = seen.length;
    const response = await fetch(`${base}/activity?agent=nonsense`);
    expect(response.status).toBe(400);
    expect(seen.length).toBe(before);
    expect(await response.text()).toContain('<p class="sc-lead">Not a valid SS58 account address: nonsense.</p>');
  });

  it('serves a 404 page for an unknown path with the search field and no internal detail', async () => {
    const response = await fetch(`${base}/not-a-view`);
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('<p class="sc-lead">There is nothing at /not-a-view.</p>');
    expect(html).toContain('role="search"');
    expect(new IndexerNotFoundError('x').publicMessage).toBe('The indexer holds nothing for that.');
  });
});
