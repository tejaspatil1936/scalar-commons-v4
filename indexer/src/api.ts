/**
 * The versioned REST surface.
 *
 * Twenty-four endpoints under `/v1`, covering blocks, extrinsics, events,
 * accounts, agents, escrows, eras and emissions. Everything they return is
 * either read live from the node or read from the index built out of finalized
 * blocks — there are no fixtures behind any of them.
 *
 * The path prefix is a promise: `/v1` responses keep their shape. Chain events
 * change with the runtime, so a shape change here means a new prefix, not a
 * quiet edit — the SDK and the landing page read these responses.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { ApiPromise } from '@polkadot/api';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

import type { IndexerConfig } from './config.ts';
import type { ChainConnection } from './chain.ts';
import type { ChainIndexer } from './indexer.ts';
import { InvalidQueryError, parseOptionalInteger, parsePage, type Page } from './pagination.ts';
import type { IndexerStore, PageResult } from './store.ts';
import {
  fetchAccountState,
  fetchAgent,
  fetchAgents,
  fetchChainStatus,
  fetchCurrentEra,
  fetchEmissions,
  fetchEscrow,
  fetchEscrows,
  fetchEscrowStats,
  fetchSupply,
} from './chainState.ts';

/** An error that maps onto an HTTP status rather than a 500. */
class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const notFound = (what: string) => new HttpError(404, `${what} not found`);

export interface ApiDependencies {
  readonly store: IndexerStore;
  readonly api: ApiPromise;
  readonly chain: ChainConnection;
  readonly indexer: ChainIndexer;
  readonly config: IndexerConfig;
}

/** Everything a handler needs to answer one request. */
interface RequestContext extends ApiDependencies {
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly page: Page;
}

export interface RouteDefinition {
  /** Stable identifier for the endpoint, used in docs and coverage checks. */
  readonly name: string;
  /** Path template; `:name` segments become `params`. */
  readonly path: string;
  readonly summary: string;
  readonly handler: (context: RequestContext) => Promise<unknown>;
}

/** Wraps a page of rows in the envelope every list endpoint shares. */
function paged<T>(result: PageResult<T>, page: Page): Record<string, unknown> {
  return { total: result.total, limit: page.limit, offset: page.offset, items: result.items };
}

/** Applies a page window to a list already read whole from chain state. */
function pageArray<T>(items: T[], page: Page): Record<string, unknown> {
  return {
    total: items.length,
    limit: page.limit,
    offset: page.offset,
    items: items.slice(page.offset, page.offset + page.limit),
  };
}

/**
 * Validates an SS58 address and re-encodes it in this chain's format.
 *
 * The same account written with another chain's prefix must not read as a
 * different account, or per-address history silently splits in two.
 */
function normalizeAddress(raw: string, ss58Format: number): string {
  try {
    return encodeAddress(decodeAddress(raw), ss58Format);
  } catch (error) {
    throw new HttpError(400, `not a valid SS58 address: ${raw}`);
  }
}

/** Reads an optional string filter from the query string. */
function optionalString(query: URLSearchParams, name: string): string | undefined {
  const value = query.get(name);
  return value === null || value === '' ? undefined : value;
}

/** Resolves an agent, or 404s — used by every agent-scoped route. */
async function requireAgent(context: RequestContext, address: string) {
  const agent = await fetchAgent(context.api, address);
  if (agent === null) {
    throw notFound(`agent ${address}`);
  }
  return agent;
}

export const ROUTES: readonly RouteDefinition[] = [
  {
    name: 'status',
    path: '/v1/status',
    summary: 'Chain identity, head position, and how far the indexer has followed it.',
    handler: async (context) => ({
      chain: await fetchChainStatus(context.api, context.chain),
      indexer: {
        syncedHeight: context.indexer.syncedHeight,
        indexedBlocks: context.indexer.indexedBlocks,
        backfillDepth: context.config.backfillDepth,
      },
      api: { version: 'v1', endpoints: ROUTES.length },
    }),
  },
  {
    name: 'blocks.list',
    path: '/v1/blocks',
    summary: 'Indexed finalized blocks, newest first.',
    handler: async (context) => paged(context.store.listBlocks(context.page), context.page),
  },
  {
    name: 'blocks.get',
    path: '/v1/blocks/:id',
    summary: 'One block by height or block hash.',
    handler: async (context) => {
      const block = context.store.getBlock(context.params.id!);
      if (block === null) throw notFound(`block ${context.params.id}`);
      return block;
    },
  },
  {
    name: 'blocks.extrinsics',
    path: '/v1/blocks/:id/extrinsics',
    summary: 'Extrinsics in one block, in execution order.',
    handler: async (context) => {
      const block = context.store.getBlock(context.params.id!);
      if (block === null) throw notFound(`block ${context.params.id}`);
      return paged(
        context.store.listExtrinsics({ ...context.page, blockNumber: block.number, order: 'asc' }),
        context.page,
      );
    },
  },
  {
    name: 'blocks.events',
    path: '/v1/blocks/:id/events',
    summary: 'Events emitted in one block, in emission order.',
    handler: async (context) => {
      const block = context.store.getBlock(context.params.id!);
      if (block === null) throw notFound(`block ${context.params.id}`);
      return paged(
        context.store.listEvents({ ...context.page, blockNumber: block.number, order: 'asc' }),
        context.page,
      );
    },
  },
  {
    name: 'extrinsics.list',
    path: '/v1/extrinsics',
    summary: 'Indexed extrinsics, filterable by signer, pallet, call and block.',
    handler: async (context) =>
      paged(
        context.store.listExtrinsics({
          ...context.page,
          blockNumber: parseOptionalInteger(context.query, 'blockNumber'),
          signer: optionalString(context.query, 'signer'),
          section: optionalString(context.query, 'section'),
          method: optionalString(context.query, 'method'),
        }),
        context.page,
      ),
  },
  {
    name: 'extrinsics.get',
    path: '/v1/extrinsics/:id',
    summary: 'One extrinsic by `<block>-<index>`, with its decoded call and outcome.',
    handler: async (context) => {
      const extrinsic = context.store.getExtrinsic(context.params.id!);
      if (extrinsic === null) throw notFound(`extrinsic ${context.params.id}`);
      return extrinsic;
    },
  },
  {
    name: 'extrinsics.events',
    path: '/v1/extrinsics/:id/events',
    summary: 'Events emitted by one extrinsic.',
    handler: async (context) => {
      const extrinsic = context.store.getExtrinsic(context.params.id!);
      if (extrinsic === null) throw notFound(`extrinsic ${context.params.id}`);
      return paged(
        context.store.listEvents({ ...context.page, extrinsicId: extrinsic.id, order: 'asc' }),
        context.page,
      );
    },
  },
  {
    name: 'events.list',
    path: '/v1/events',
    summary: 'Indexed events, filterable by pallet, method, block and account.',
    handler: async (context) =>
      paged(
        context.store.listEvents({
          ...context.page,
          blockNumber: parseOptionalInteger(context.query, 'blockNumber'),
          section: optionalString(context.query, 'section'),
          method: optionalString(context.query, 'method'),
          account: optionalString(context.query, 'account'),
        }),
        context.page,
      ),
  },
  {
    name: 'events.get',
    path: '/v1/events/:id',
    summary: 'One event by `<block>-<index>`.',
    handler: async (context) => {
      const event = context.store.getEvent(context.params.id!);
      if (event === null) throw notFound(`event ${context.params.id}`);
      return event;
    },
  },
  {
    name: 'accounts.list',
    path: '/v1/accounts',
    summary: 'Accounts the indexer has observed on chain, most recently active first.',
    handler: async (context) => paged(context.store.listAccounts(context.page), context.page),
  },
  {
    name: 'accounts.get',
    path: '/v1/accounts/:address',
    summary: 'Live balance and nonce for an account, plus its indexed activity.',
    handler: async (context) => {
      const address = normalizeAddress(context.params.address!, context.chain.ss58Format);
      const state = await fetchAccountState(context.api, address);
      const indexed = context.store.getAccount(address);
      return {
        ...state,
        activity: {
          firstSeenBlock: indexed?.firstSeenBlock ?? null,
          lastSeenBlock: indexed?.lastSeenBlock ?? null,
          eventCount: indexed?.eventCount ?? 0,
          extrinsicCount: indexed?.extrinsicCount ?? 0,
        },
      };
    },
  },
  {
    name: 'accounts.extrinsics',
    path: '/v1/accounts/:address/extrinsics',
    summary: 'Extrinsics signed by an account.',
    handler: async (context) => {
      const address = normalizeAddress(context.params.address!, context.chain.ss58Format);
      return paged(context.store.listExtrinsics({ ...context.page, signer: address }), context.page);
    },
  },
  {
    name: 'agents.list',
    path: '/v1/agents',
    summary: 'Registered agents with live stake and era-scoped work counters.',
    handler: async (context) => pageArray(await fetchAgents(context.api), context.page),
  },
  {
    name: 'agents.get',
    path: '/v1/agents/:address',
    summary: 'One agent: stake, liveness, era volume and governance participation.',
    handler: async (context) => {
      const address = normalizeAddress(context.params.address!, context.chain.ss58Format);
      return requireAgent(context, address);
    },
  },
  {
    name: 'agents.events',
    path: '/v1/agents/:address/events',
    summary: 'Indexed events naming this agent, newest first.',
    handler: async (context) => {
      const address = normalizeAddress(context.params.address!, context.chain.ss58Format);
      await requireAgent(context, address);
      return paged(context.store.listEvents({ ...context.page, account: address }), context.page);
    },
  },
  {
    name: 'agents.escrows',
    path: '/v1/agents/:address/escrows',
    summary: 'Open agreements this agent is party to, on either side.',
    handler: async (context) => {
      const address = normalizeAddress(context.params.address!, context.chain.ss58Format);
      await requireAgent(context, address);
      const all = await fetchEscrows(context.api);
      const involved = all
        .filter((agreement) => agreement.buyer === address || agreement.provider === address)
        .map((agreement) => ({
          ...agreement,
          role: agreement.buyer === address ? 'buyer' : 'provider',
        }));
      return pageArray(involved, context.page);
    },
  },
  {
    name: 'escrows.list',
    path: '/v1/escrows',
    summary: 'Open escrow agreements from live chain storage, newest first.',
    handler: async (context) => {
      const buyer = optionalString(context.query, 'buyer');
      const provider = optionalString(context.query, 'provider');
      const agreements = await fetchEscrows(context.api, {
        buyer: buyer === undefined ? undefined : normalizeAddress(buyer, context.chain.ss58Format),
        provider:
          provider === undefined ? undefined : normalizeAddress(provider, context.chain.ss58Format),
      });
      return pageArray(agreements, context.page);
    },
  },
  {
    name: 'escrows.stats',
    path: '/v1/escrows/stats',
    summary: 'Aggregate escrow state: open agreements, funds reserved, pallet limits.',
    handler: async (context) => fetchEscrowStats(context.api),
  },
  {
    name: 'escrows.get',
    path: '/v1/escrows/:buyer/:provider/:seq',
    summary: 'One agreement by its (buyer, provider, seq) key.',
    handler: async (context) => {
      const buyer = normalizeAddress(context.params.buyer!, context.chain.ss58Format);
      const provider = normalizeAddress(context.params.provider!, context.chain.ss58Format);
      const rawSeq = context.params.seq!;
      if (!/^\d+$/.test(rawSeq)) {
        throw new HttpError(400, `seq must be a non-negative integer, got "${rawSeq}"`);
      }
      const agreement = await fetchEscrow(context.api, buyer, provider, Number(rawSeq));
      if (agreement === null) throw notFound(`agreement ${buyer}/${provider}/${rawSeq}`);
      return agreement;
    },
  },
  {
    name: 'eras.list',
    path: '/v1/eras',
    summary: 'Eras settled within the indexed window, plus the era in progress.',
    handler: async (context) => {
      const current = await fetchCurrentEra(context.api);
      // Settled eras are reconstructed from the `EraSettled` events the indexer
      // has seen. The emission and weight totals are the ones the pallet itself
      // reported at settlement — this endpoint never recomputes them.
      const settledEvents = context.store.listEvents({
        limit: 200,
        offset: 0,
        section: 'emissions',
        method: 'EraSettled',
      });
      const settled = settledEvents.items.map((event) => {
        const data = event.data as Record<string, unknown>;
        return {
          era: Number(data.era),
          settled: true,
          totalEmissionPlancks: String(data.total_emission ?? data.totalEmission ?? '0'),
          totalWeight: String(data.total_weight ?? data.totalWeight ?? '0'),
          settledAtBlock: event.blockNumber,
        };
      });

      const items = [
        ...settled.filter((era) => era.era !== current.era),
        {
          era: current.era,
          settled: false,
          startBlock: current.startBlock,
          durationBlocks: current.durationBlocks,
          blocksElapsed: current.blocksElapsed,
          blocksRemaining: current.blocksRemaining,
          dueForSettlement: current.dueForSettlement,
        },
      ].sort((a, b) => b.era - a.era);

      return {
        ...pageArray(items, context.page),
        // The settled history is only as deep as the indexed window; say so
        // rather than let an empty list read as "no era was ever settled".
        settledHistoryFrom: context.store.listBlocks({ limit: 1, offset: 0 }).items[0]
          ? Math.max(0, (context.indexer.syncedHeight ?? 0) - context.config.backfillDepth + 1)
          : null,
      };
    },
  },
  {
    name: 'eras.current',
    path: '/v1/eras/current',
    summary: 'The era in progress and whether its settlement window has opened.',
    handler: async (context) => fetchCurrentEra(context.api),
  },
  {
    name: 'emissions.get',
    path: '/v1/emissions',
    summary: 'Emission parameters and the last settlement the pallet recorded.',
    handler: async (context) => fetchEmissions(context.api),
  },
  {
    name: 'emissions.supply',
    path: '/v1/emissions/supply',
    summary: 'Total issuance against the hard supply cap, with remaining headroom.',
    handler: async (context) => fetchSupply(context.api, context.chain),
  },
];

interface CompiledRoute extends RouteDefinition {
  readonly segments: string[];
}

const COMPILED: CompiledRoute[] = ROUTES.map((route) => ({
  ...route,
  segments: route.path.split('/').filter((segment) => segment.length > 0),
}));

/** Resolves a request path to a route, filling its `:params`. */
export function matchRoute(pathname: string): { route: RouteDefinition; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter((segment) => segment.length > 0);
  for (const route of COMPILED) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < route.segments.length; i += 1) {
      const expected = route.segments[i]!;
      const actual = parts[i]!;
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { route, params };
    }
  }
  return null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Builds the HTTP server.
 *
 * `node:http` with a small router rather than a framework: the surface is 24
 * read-only GETs, and a framework would add more dependency than routing.
 */
export function createApiServer(dependencies: ApiDependencies): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, dependencies);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, dependencies: ApiDependencies): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://indexer.local');

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: `method ${req.method} not allowed; this API is read-only` });
    return;
  }

  const matched = matchRoute(url.pathname);
  if (matched === null) {
    sendJson(res, 404, {
      error: `no such endpoint: ${url.pathname}`,
      endpoints: ROUTES.map((route) => route.path),
    });
    return;
  }

  try {
    const page = parsePage(url.searchParams);
    const body = await matched.route.handler({
      ...dependencies,
      params: matched.params,
      query: url.searchParams,
      page,
    });
    sendJson(res, 200, body);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof InvalidQueryError) {
      sendJson(res, 400, { error: error.message });
      return;
    }
    // Anything else is a genuine fault — an unreachable node, a decode failure
    // against unexpected metadata. Report it rather than answering with a
    // plausible-looking empty result.
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}
