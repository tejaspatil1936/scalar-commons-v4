/**
 * The HTTP surface.
 *
 * A thin adapter: parse the URL into a route, ask the chain client for the view
 * model, render it. It is read-only by construction — the chain client it wraps
 * has no `tx` surface at all, so no request can change chain or server state.
 *
 * Every failure mode has a distinct status, because they mean different things
 * to a visitor: 400 for "that is not a block/address at all", 404 for "the chain
 * does not have it", 502 for "the node did not answer". Collapsing them would
 * make an unreachable node look like an empty chain.
 *
 * Besides the views it serves the chrome: `/chrome.css` (tokens + chrome +
 * print, read once at startup from the synced copy under `src/chrome/`) and
 * the two font files under `/fonts/`, which the stylesheet addresses as
 * `fonts/…` relative to its own URL.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  ACTIVITY_PAGE_SIZE,
  IndexerResponseError,
  IndexerUnavailableError,
  findAgentByName,
  isRecord,
  toActivityView,
  toHistory,
  toIndexerStatus,
  wideInteger,
  type ActivitySource,
  type IndexerReader,
} from './activity.js';
import {
  BlockNotFoundError,
  ExtrinsicNotFoundError,
  InvalidAddressError,
  type ExplorerChain,
} from './chain.js';
import {
  renderAccount,
  renderActivity,
  renderBlock,
  renderError,
  renderExtrinsic,
  renderHome,
} from './render.js';
import { accountPath, activityPath, blockPath, extrinsicPath, FONT_FILES, HASH_64, isAddress, parseBlockRef, parseRoute } from './routes.js';
import type { AgentReadings, Read, Source } from './types.js';

export interface ExplorerServerOptions {
  readonly chain: ExplorerChain;
  /** Where the agent-activity page reads from — the indexer. */
  readonly activity: ActivitySource;
  /**
   * The indexer's other endpoints (status, account history, agent readings).
   * Optional: without it those figures render as leaders to nothing.
   */
  readonly indexer?: IndexerReader;
  /** Where to report node failures. Defaults to stderr; tests can silence it. */
  readonly onError?: (error: unknown) => void;
  /** The synced chrome directory. Defaults to `src/chrome/` beside the sources (or `dist/`). */
  readonly chromeDir?: string;
}

function send(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(html),
  });
  response.end(html);
}

function sendBytes(response: ServerResponse, status: number, contentType: string, body: Buffer): void {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'public, max-age=3600',
    'content-length': body.byteLength,
  });
  response.end(body);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, 'cache-control': 'no-store', 'content-length': 0 });
  response.end();
}

/**
 * Where the synced chrome lives. The build emits `dist/` from `src/` only and
 * copies nothing else, so a process started from `dist/server.js` reads the
 * copy at `../src/chrome/`; one started from the sources (vitest) reads
 * `./chrome/` beside this file.
 */
export function defaultChromeDir(): string {
  const beside = fileURLToPath(new URL('./chrome-legacy/', import.meta.url));
  if (existsSync(beside)) return beside;
  return fileURLToPath(new URL('../src/chrome-legacy/', import.meta.url));
}

/** The chrome stylesheet as one file: tokens, then the components, then the print face. */
export function readChromeStylesheet(dir: string): string {
  return ['tokens.css', 'chrome.css', 'print.css'].map((name) => readFileSync(new URL(name, pathToDirUrl(dir)), 'utf8')).join('\n');
}

const pathToDirUrl = (dir: string): URL => new URL(`file://${dir.endsWith('/') ? dir : `${dir}/`}`);

/** The agent-scoped readings from the index's `/v1/agents/:address` and `/v1/agents/:address/escrows`. */
async function readAgent(indexer: IndexerReader, agent: string, at: string): Promise<AgentReadings> {
  const host = indexer.baseUrl.replace(/^https?:\/\//, '');
  const src = (path: string, computed: string | null = null): Source => ({ method: 'GET', url: `${host}${path}`, fetchedAt: at, block: null, raw: null, computed });
  const agentPath = `/v1/agents/${agent}`;
  const escrowsPath = `${agentPath}/escrows`;

  let record: Record<string, unknown> | null = null;
  let agentReason: string | null = null;
  try {
    const raw = await indexer.getJson(agentPath);
    if (!isRecord(raw)) throw new IndexerResponseError(`${agentPath} is not an object`);
    record = raw;
  } catch (error) {
    agentReason = error instanceof Error ? error.message : String(error);
  }

  let escrows: Record<string, unknown>[] | null = null;
  let escrowsReason: string | null = null;
  try {
    const raw = await indexer.getJson(escrowsPath);
    if (!isRecord(raw) || !Array.isArray(raw.items)) throw new IndexerResponseError(`${escrowsPath} has no items list`);
    escrows = raw.items.filter(isRecord);
  } catch (error) {
    escrowsReason = error instanceof Error ? error.message : String(error);
  }

  const fromRecord = <T>(path: string, field: string, pick: (r: Record<string, unknown>) => T | null, computed: string | null = null): Read<T> => {
    const source = src(path, computed);
    if (record === null) return { value: null, source, reason: agentReason ?? 'not read' };
    const value = pick(record);
    return value === null ? { value: null, source, reason: `${path} carries no ${field}` } : { value, source, reason: null };
  };
  const fromEscrows = <T>(pick: (rows: Record<string, unknown>[]) => T, computed: string | null = null): Read<T> => {
    const source = src(escrowsPath, computed);
    return escrows === null ? { value: null, source, reason: escrowsReason ?? 'not read' } : { value: pick(escrows), source, reason: null };
  };

  const counterparties = fromEscrows((rows) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const other = row.role === 'buyer' ? row.provider : row.buyer;
      if (typeof other === 'string' && other !== agent) counts.set(other, (counts.get(other) ?? 0) + 1);
    }
    return [...counts.entries()].map(([address, count]) => ({ address, count })).sort((a, b) => b.count - a.count);
  }, 'distinct other party over open agreements');

  return {
    renderedAt: at,
    name: record !== null && typeof record.name === 'string' ? record.name : null,
    earnedAllTime: { value: null, source: src(agentPath), reason: `${agentPath} carries no all-time earnings field` },
    earnedThisEra: fromRecord(agentPath, 'eraVolumePlancks', (r) => wideInteger(r, 'eraVolumePlancks'), 'eraVolumePlancks · escrow volume this era'),
    agreementsOpen: fromRecord(agentPath, 'activeEscrowCount', (r) => (typeof r.activeEscrowCount === 'number' ? r.activeEscrowCount : null)),
    inDispute: fromEscrows((rows) => rows.filter((row) => row.status === 'Disputed').length, "count of status = 'Disputed'"),
    counterparties,
    earningsByEra: {
      value: null,
      source: src(escrowsPath),
      reason: `${escrowsPath} carries open agreements only; the index has no settled earnings by era for an agent`,
    },
    decayed: false,
    cooldown: record !== null && typeof record.unstakeAtBlock === 'number',
  };
}

/** Builds the explorer HTTP server around an already-connected chain client. */
export function createExplorerServer(options: ExplorerServerOptions): Server {
  const { chain, indexer } = options;
  const onError = options.onError ?? ((error: unknown) => console.error('[explorer]', error));
  const info = chain.chainInfo();
  const chromeDir = options.chromeDir ?? defaultChromeDir();
  const stylesheet = Buffer.from(readChromeStylesheet(chromeDir), 'utf8');
  const fonts = new Map(FONT_FILES.map((name) => [name, readFileSync(new URL(`fonts/${name}`, pathToDirUrl(chromeDir)))]));

  async function indexerRead<T>(path: string, shape: (raw: unknown) => T): Promise<Read<T> | undefined> {
    if (indexer === undefined) return undefined;
    const source: Source = { method: 'GET', url: `${indexer.baseUrl.replace(/^https?:\/\//, '')}${path}`, fetchedAt: new Date().toISOString(), block: null, raw: null };
    try {
      return { value: shape(await indexer.getJson(path)), source, reason: null };
    } catch (error) {
      return { value: null, source, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Resolves the search field to the view it names, or null when nothing matches. */
  async function resolveSearch(query: string): Promise<string | null> {
    if (query === '') return null;
    const ref = parseBlockRef(query);
    if (ref?.kind === 'number') return blockPath(ref);
    if (HASH_64.test(query)) {
      const hash = query.toLowerCase();
      try {
        await chain.block({ kind: 'hash', hash });
        return blockPath({ kind: 'hash', hash });
      } catch (error) {
        if (!(error instanceof BlockNotFoundError)) throw error;
      }
      const found = await chain.findExtrinsic(hash);
      return found === null ? null : extrinsicPath({ kind: 'number', number: found.number }, found.index);
    }
    if (isAddress(query)) return accountPath(query);
    if (indexer !== undefined) {
      const agents = await indexer.getJson('/v1/agents?limit=200').catch(() => null);
      const address = findAgentByName(agents, query);
      if (address !== null) return activityPath(address);
    }
    return null;
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = parseRoute(request.url ?? '/');

    switch (route.kind) {
      case 'home': {
        const view = await chain.home();
        const status = await indexerRead('/v1/status', toIndexerStatus);
        send(response, 200, renderHome(status === undefined ? view : { ...view, indexer: status }));
        return;
      }

      case 'block':
        send(response, 200, renderBlock(await chain.block(route.ref), info));
        return;

      case 'extrinsic':
        send(response, 200, renderExtrinsic(await chain.extrinsic(route.ref, route.index), info));
        return;

      case 'account': {
        const view = await chain.account(route.address);
        const history = await indexerRead(`/v1/accounts/${view.address}/extrinsics?limit=${ACTIVITY_PAGE_SIZE}`, toHistory);
        send(response, 200, renderAccount(history === undefined ? view : { ...view, history }, info));
        return;
      }

      case 'activity': {
        const query = { agent: route.agent, offset: route.offset };
        // The agent's readings first, the feed last: the feed is the page's
        // one required read, and its failure is the page's 502.
        const agentReadings = route.agent !== null && indexer !== undefined ? await readAgent(indexer, route.agent, new Date().toISOString()) : undefined;
        const raw = await options.activity.activity({ ...query, limit: ACTIVITY_PAGE_SIZE });
        const view = toActivityView(raw, (section, method) => chain.eventFieldTypes(section, method), query);
        send(response, 200, renderActivity(agentReadings === undefined ? view : { ...view, agentReadings }, info));
        return;
      }

      case 'search': {
        const target = await resolveSearch(route.query);
        if (target === null) {
          send(response, 404, renderError(404, `nothing is logged for: ${route.query}`, info));
          return;
        }
        redirect(response, target);
        return;
      }

      case 'chrome':
        sendBytes(response, 200, 'text/css; charset=utf-8', stylesheet);
        return;

      case 'font':
        sendBytes(response, 200, 'font/woff2', fonts.get(route.name) ?? Buffer.alloc(0));
        return;

      case 'badRequest':
        send(response, 400, renderError(400, route.message, info));
        return;

      case 'notFound':
        send(response, 404, renderError(404, `no such page: ${request.url ?? '/'}`, info));
        return;
    }
  }

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (error instanceof BlockNotFoundError || error instanceof ExtrinsicNotFoundError) {
        send(response, 404, renderError(404, error.message, info));
        return;
      }
      if (error instanceof InvalidAddressError) {
        send(response, 400, renderError(400, error.message, info));
        return;
      }
      // The activity page's upstream is the indexer, not the node, so its
      // failures say so rather than blaming a node that was never asked.
      if (error instanceof IndexerUnavailableError || error instanceof IndexerResponseError) {
        onError(error);
        send(response, 502, renderError(502, error.message, info));
        return;
      }
      // Anything else is the node failing or the runtime not matching what the
      // explorer read at connect time. Report it as an upstream failure rather
      // than dressing it up as an empty page.
      onError(error);
      send(
        response,
        502,
        renderError(502, `the node did not answer: ${error instanceof Error ? error.message : String(error)}`, info),
      );
    });
  });
}
