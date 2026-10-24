import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ACTIVITY_PAGE_SIZE, IndexerResponseError, createIndexerClient, createIndexerReader, toActivityView } from '../src/activity.js';
import type { ExplorerChain } from '../src/chain.js';
import { renderActivity } from '../src/render.js';
import { activityPath, parseRoute } from '../src/routes.js';
import { createExplorerServer } from '../src/server.js';
import type { ActivityView, ChainInfo } from '../src/types.js';

/**
 * The agent-activity page, end to end within the explorer, against a stand-in
 * indexer.
 *
 * The explorer reads activity from the indexer's `/v1/activity`, because a feed
 * over history is exactly what the explorer's no-database, bounded-reads design
 * cannot compute from a node per request. What is under test here is the
 * explorer's half: the route, the shaping of what the indexer answered (loudly
 * refusing anything it does not recognise), and the page. The indexer's half is
 * covered against a live node in `indexer/tests/live.test.ts`.
 */

const ALICE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const BOB = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

const CHAIN: ChainInfo = {
  chain: 'Scalar Commons Local Testnet',
  specName: 'scalar-commons',
  specVersion: 307,
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
    {
      id: '120-4',
      blockNumber: 120,
      index: 4,
      extrinsicId: '120-2',
      timestampMs: 1_787_086_860_000,
      kind: 'agreement',
      section: 'escrow',
      method: 'AgreementCreated',
      agents: [ALICE, BOB],
      data: { buyer: ALICE, provider: BOB, seq: 3, amount: '12500000000000' },
    },
    {
      id: '118-1',
      blockNumber: 118,
      index: 1,
      extrinsicId: null,
      timestampMs: null,
      kind: 'heartbeat',
      section: 'agents',
      method: 'HeartbeatSent',
      agents: [ALICE],
      data: { who: `<script>alert(1)</script>` },
    },
  ],
};

describe('activity routes', () => {
  it('routes the feed, with and without an agent filter and a kind', () => {
    expect(parseRoute('/activity')).toEqual({ kind: 'activity', agent: null, activityKind: null, page: 1 });
    expect(parseRoute(`/activity?agent=${ALICE}`)).toEqual({ kind: 'activity', agent: ALICE, activityKind: null, page: 1 });
    expect(parseRoute(`/activity?agent=${ALICE}&page=3&kind=slash`)).toEqual({ kind: 'activity', agent: ALICE, activityKind: 'slash', page: 3 });
    // The filter form submits an empty field when cleared; that means "everyone".
    expect(parseRoute('/activity?agent=')).toEqual({ kind: 'activity', agent: null, activityKind: null, page: 1 });
    expect(parseRoute('/activity?agent=%20' + ALICE + '%20')).toEqual({ kind: 'activity', agent: ALICE, activityKind: null, page: 1 });
  });

  it('refuses a filter that is not an address, rather than showing an empty feed', () => {
    expect(parseRoute('/activity?agent=nonsense')).toEqual({ kind: 'badRequest', message: '“nonsense” is not an account address.' });
    expect(parseRoute('/activity?page=0').kind).toBe('badRequest');
    expect(parseRoute('/activity?page=1.5').kind).toBe('badRequest');
    expect(parseRoute('/activity?kind=everything').kind).toBe('badRequest');
  });

  it('round-trips through the path builder', () => {
    expect(parseRoute(activityPath())).toEqual({ kind: 'activity', agent: null, activityKind: null, page: 1 });
    expect(parseRoute(activityPath(ALICE, 2))).toEqual({ kind: 'activity', agent: ALICE, activityKind: null, page: 2 });
  });
});

describe('toActivityView', () => {
  it('keeps the indexer order and types each field from runtime metadata', () => {
    const view = toActivityView(FEED, fieldTypes, { agent: null, offset: 0 });
    expect(view.entries.map((entry) => entry.id)).toEqual(['120-4', '118-1']);
    const [created] = view.entries;
    expect(created?.fields).toEqual([
      { name: 'buyer', value: ALICE, kind: 'account' },
      { name: 'provider', value: BOB, kind: 'account' },
      { name: 'seq', value: '3', kind: 'plain' },
      { name: 'amount', value: '12500000000000', kind: 'balance' },
    ]);
    expect(created?.timestampMs).toBe(1_787_086_860_000n);
    expect(view.total).toBe(2);
    expect(view.historyFrom).toBe(100);
  });

  it('falls back to plain text for an event the runtime metadata does not describe', () => {
    const view = toActivityView(
      { ...FEED, items: [{ ...FEED.items[0]!, section: 'messaging', method: 'MessageSent', kind: 'message', data: { note: 'hi' } }] },
      fieldTypes,
      { agent: null, offset: 0 },
    );
    expect(view.entries[0]?.fields).toEqual([{ name: 'note', value: 'hi', kind: 'plain' }]);
  });

  it('refuses an answer that is not the activity feed', () => {
    expect(() => toActivityView({ error: 'nope' }, fieldTypes, { agent: null, offset: 0 })).toThrow(IndexerResponseError);
    expect(() =>
      toActivityView({ ...FEED, items: [{ ...FEED.items[0]!, blockNumber: 'x' }] }, fieldTypes, { agent: null, offset: 0 }),
    ).toThrow(IndexerResponseError);
  });
});

const NOW = '2026-10-23T12:00:00.000Z';
const ctx = { info: CHAIN, renderedAt: NOW, block: null };
const model = (view: ActivityView, extra: Partial<Parameters<typeof renderActivity>[0]> = {}) =>
  renderActivity({ ctx, agent: view.agent, kind: null, page: 1, total: view.total, historyFrom: view.historyFrom, entries: view.entries, listAt: NOW, ...extra });

describe('renderActivity', () => {
  const view: ActivityView = toActivityView(FEED, fieldTypes, { agent: null, offset: 0 });
  const html = model(view);

  it('lists activity newest first in plain words, linking block, extrinsic and agents', () => {
    expect(html.indexOf('href="/block/120"')).toBeLessThan(html.indexOf('href="/block/118"'));
    expect(html).toContain('href="/extrinsic/120/2"');
    expect(html).toContain(`href="/account/${ALICE}"`);
    expect(html).toContain('Agreement opened');
    expect(html).not.toContain('escrow.AgreementCreated');
  });

  it('prints balances with two decimals and the planck value in the title', () => {
    expect(html).toContain('12.50 CMN');
    expect(html).toContain('title="12,500,000,000,000 plancks"');
  });

  it('never repeats an agent address in Details', () => {
    const row = html.slice(html.indexOf('href="/block/118"'));
    const cells = row.slice(0, row.indexOf('</tr>'));
    // The agent's address once (in the Agents cell), never again in Details.
    expect(cells.split(`title="${ALICE}"`).length - 1).toBe(1);
  });

  it('escapes chain-supplied values', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never reloads itself, and offers the chips and the agent filter', () => {
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toMatch(/<form[^>]*action="\/activity" method="get"/);
    expect(html).toContain('name="agent"');
    for (const label of ['All', 'Agreements', 'Disputes', 'Messages', 'Registrations', 'Slashes']) expect(html).toContain(`>${label}</a>`);
  });

  it('says how far back history reaches, without raw counts', () => {
    expect(html).toContain('Agent events, newest first. History reaches back to block');
    expect(html).toContain('href="/block/100"');
    expect(html).not.toContain('Showing every agent');
  });

  it('says so when there is no activity, rather than rendering an empty table', () => {
    const empty = model({ ...view, total: 0, entries: [] });
    expect(empty).toContain('No agent events');
  });

  it('pages 25 at a time, with Next only when there is more', () => {
    expect(html).not.toContain('href="/activity?page=2"');
    const more = model({ ...view, total: 120 });
    expect(more).toContain('href="/activity?page=2"');
    expect(ACTIVITY_PAGE_SIZE).toBe(25);
  });

  it('names the indexer as its source in the footer', () => {
    expect(html).toContain('List from the indexer, 0 s ago.');
  });
});

describe('the /activity page over HTTP', () => {
  let indexer: Server;
  let explorer: Server;
  let base: string;
  const seen: string[] = [];

  /** Only what the activity page touches; every other view would be a test bug. */
  const chain = {
    chainInfo: () => CHAIN,
    eventFieldTypes: fieldTypes,
  } as unknown as ExplorerChain;

  beforeAll(async () => {
    indexer = createServer((request, response) => {
      seen.push(request.url ?? '');
      if (request.url?.includes('fail')) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'node unreachable at http://10.0.0.1:9944' }));
        return;
      }
      if (request.url?.startsWith(`/v1/agents/${BOB}`)) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not a registered agent' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      if (request.url?.startsWith('/v1/agents/')) {
        response.end(JSON.stringify({ total: 1, limit: 25, offset: 0, items: [{ id: '120-4', blockNumber: 120, index: 4, section: 'escrow', method: 'AgreementCreated', phase: 'ApplyExtrinsic', extrinsicId: '120-2', data: {}, accounts: [ALICE] }] }));
        return;
      }
      response.end(JSON.stringify(FEED));
    });
    await new Promise<void>((resolve) => indexer.listen(0, '127.0.0.1', resolve));
    const indexerUrl = `http://127.0.0.1:${(indexer.address() as AddressInfo).port}`;

    explorer = createExplorerServer({ chain, activity: createIndexerClient({ baseUrl: indexerUrl }), indexer: createIndexerReader({ baseUrl: indexerUrl }), onError: () => {} });
    await new Promise<void>((resolve) => explorer.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(explorer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => explorer.close(() => resolve()));
    await new Promise<void>((resolve) => indexer.close(() => resolve()));
  });

  it('asks the indexer for the newest page of every agent, 25 at a time', async () => {
    const response = await fetch(`${base}/activity`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Agreement opened');
    expect(seen.at(-1)).toBe(`/v1/activity?limit=25&offset=0`);
  });

  it('pages by offset on the indexer and passes the kind', async () => {
    await fetch(`${base}/activity?kind=dispute&page=3`);
    expect(seen.at(-1)).toBe(`/v1/activity?limit=25&offset=50&kind=dispute`);
  });

  it("reads one agent's activity from /v1/agents/:address/events, never a scan of /v1/activity", async () => {
    const response = await fetch(`${base}/activity?agent=${ALICE}&page=2`);
    expect(response.status).toBe(200);
    expect(seen.at(-1)).toBe(`/v1/agents/${ALICE}/events?limit=25&offset=25`);
  });

  it('shows an address that is not a registered agent as having no agent events, not as a failure', async () => {
    const response = await fetch(`${base}/activity?agent=${BOB}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('This address is not a registered agent, so it has no agent events.');
  });

  it('reports an indexer failure as 502 in one plain sentence, never an internal address', async () => {
    const failing = createExplorerServer({
      chain,
      activity: createIndexerClient({ baseUrl: `http://127.0.0.1:${(indexer.address() as AddressInfo).port}/fail` }),
      onError: () => {},
    });
    await new Promise<void>((resolve) => failing.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(failing.address() as AddressInfo).port}/activity`);
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).toContain('The indexer could not answer this request.');
      expect(text).not.toMatch(/127\.0\.0\.1|10\.0\.0\.1|node unreachable/);
    } finally {
      await new Promise<void>((resolve) => failing.close(() => resolve()));
    }
  });

  it('says only "The indexer did not answer in time" when it times out', async () => {
    const slow = createServer(() => {});
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`;
    const orphan = createExplorerServer({ chain, activity: createIndexerClient({ baseUrl: url, timeoutMs: 200 }), onError: () => {}, readTimeoutMs: 200 });
    await new Promise<void>((resolve) => orphan.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(orphan.address() as AddressInfo).port}/activity`);
      expect(response.status).toBe(504);
      const text = await response.text();
      expect(text).toContain('The indexer did not answer in time.');
      expect(text).not.toContain(url);
    } finally {
      await new Promise<void>((resolve) => orphan.close(() => resolve()));
      slow.closeAllConnections();
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });

  it('400s a bad agent filter without asking the indexer', async () => {
    const before = seen.length;
    const response = await fetch(`${base}/activity?agent=nonsense`);
    expect(response.status).toBe(400);
    expect(seen.length).toBe(before);
  });
});
