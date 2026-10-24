/**
 * The HTTP surface.
 *
 * A thin adapter: parse the URL into a route, read what the page needs from
 * the node (single items) and the indexer (lists), render it. Read-only by
 * construction — the chain client it wraps has no `tx` surface at all.
 *
 * Every failure mode has a distinct status and one plain sentence: 400 for
 * "that is not a block or an address", 404 for "the chain does not have it",
 * 502/504 for "the node or the indexer did not answer". An error page never
 * shows an internal address or a stack trace.
 *
 * Speed: every page answers within two seconds. Each upstream read is bounded
 * (`READ_TIMEOUT_MS`); a list read that fails keeps the last value it had,
 * marked Stale, rather than showing nothing or a zero.
 *
 * Besides the pages it serves the shared chrome: `/chrome.css` (tokens, fonts,
 * components — the synced copy under `src/chrome/` — plus the explorer's few
 * page-scoped layout rules), the two font files under `/fonts/`, and
 * `/favicon.svg`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  IndexerResponseError,
  IndexerUnavailableError,
  isRecord,
  toActivityView,
  toHistory,
  wideInteger,
  type ActivitySource,
  type IndexerReader,
} from './activity.js';
import { BlockNotFoundError, ExtrinsicNotFoundError, InvalidAddressError, type ExplorerChain } from './chain.js';
import { EXPLORER_CSS } from './explorer-css.js';
import { FAVICON_SVG } from './favicon.js';
import {
  PAGE_SIZE,
  renderAccount,
  renderActivity,
  renderBlock,
  renderBlocks,
  renderError,
  renderExtrinsic,
  renderHome,
  renderNothingFound,
  type AgentCard,
  type BlockRow,
  type Live,
  type PageContext,
} from './render.js';
import { accountPath, blockPath, extrinsicPath, FONT_FILES, HASH_64, isAddress, parseBlockRef, parseExtrinsicId, parseRoute } from './routes.js';
import type { ActivityEntry, HistoryEntry } from './types.js';

export interface ExplorerServerOptions {
  readonly chain: ExplorerChain;
  /** Where the agent-activity feed reads from — the indexer. */
  readonly activity: ActivitySource;
  /** The indexer's other endpoints (status, blocks, agents, account history). */
  readonly indexer?: IndexerReader;
  /** Where to report upstream failures. Defaults to stderr; tests can silence it. */
  readonly onError?: (error: unknown) => void;
  /** The synced chrome directory. Defaults to `src/chrome/` beside the sources (or `dist/`). */
  readonly chromeDir?: string;
  /** How long one upstream read may take before the page gives up on it. */
  readonly readTimeoutMs?: number;
}

/** One upstream read's budget: the page as a whole answers within two seconds. */
export const READ_TIMEOUT_MS = 1_500;

/** The whole message for an indexer that did not answer in time. */
export const INDEXER_TIMEOUT = 'The indexer did not answer in time.';
const INDEXER_FAILED = 'The indexer could not answer this request.';
const NODE_TIMEOUT = 'The node did not answer in time.';

/** Responses whose request accepts gzip: pages and the stylesheet go compressed (the §7 budget is bytes transferred). */
const acceptsGzip = new WeakSet<ServerResponse>();

function finish(response: ServerResponse, status: number, headers: Record<string, string>, body: Buffer, compressible: boolean): void {
  const gzip = compressible && acceptsGzip.has(response);
  const payload = gzip ? gzipSync(body) : body;
  response.writeHead(status, { ...headers, ...(gzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}), 'content-length': String(payload.byteLength) });
  response.end(payload);
}

function send(response: ServerResponse, status: number, html: string): void {
  finish(response, status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, Buffer.from(html, 'utf8'), true);
}

function sendBytes(response: ServerResponse, status: number, contentType: string, body: Buffer): void {
  finish(response, status, { 'content-type': contentType, 'cache-control': 'public, max-age=3600' }, body, /^text\/|svg/.test(contentType));
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
  const beside = fileURLToPath(new URL('./chrome/', import.meta.url));
  if (existsSync(beside)) return beside;
  return fileURLToPath(new URL('../src/chrome/', import.meta.url));
}

const pathToDirUrl = (dir: string): URL => new URL(`file://${dir.endsWith('/') ? dir : `${dir}/`}`);

/** The chrome stylesheet as one file: tokens, fonts, components, then the explorer's page-scoped rules. */
export function readChromeStylesheet(dir: string): string {
  return [...['tokens.css', 'fonts.css', 'chrome.css'].map((name) => readFileSync(new URL(name, pathToDirUrl(dir)), 'utf8')), EXPLORER_CSS].join('\n');
}

class TimeoutError extends Error {
  constructor(what: string) {
    super(`${what} did not answer in time`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with a TimeoutError when `promise` takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(what)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const isTimeout = (error: unknown): boolean =>
  error instanceof TimeoutError || (error instanceof Error && /time ?out|aborted/i.test(error.message));

/** The plain cause of a failed indexer read. */
const indexerCause = (error: unknown): string => (isTimeout(error) ? INDEXER_TIMEOUT : INDEXER_FAILED);

/** Builds the explorer HTTP server around an already-connected chain client. */
export function createExplorerServer(options: ExplorerServerOptions): Server {
  const { chain, indexer } = options;
  const onError = options.onError ?? ((error: unknown) => console.error('[explorer]', error));
  const info = chain.chainInfo();
  const timeoutMs = options.readTimeoutMs ?? READ_TIMEOUT_MS;
  const chromeDir = options.chromeDir ?? defaultChromeDir();
  const stylesheet = Buffer.from(readChromeStylesheet(chromeDir), 'utf8');
  const favicon = Buffer.from(FAVICON_SVG, 'utf8');
  const fonts = new Map(FONT_FILES.map((name) => [name, readFileSync(new URL(`fonts/${name}`, pathToDirUrl(chromeDir)))]));

  /** The last good value of each list read, kept so a failed read can show it marked Stale. */
  const lastGood = new Map<string, { value: unknown; at: string }>();

  /** One bounded read; on failure the last good value under `key`, marked Stale, with the plain cause. */
  async function live<T>(key: string, read: () => Promise<T>, what: 'node' | 'indexer'): Promise<Live<T>> {
    try {
      const value = await within(read(), timeoutMs, what);
      const at = new Date().toISOString();
      lastGood.set(key, { value, at });
      return { value, stale: false, at, reason: null };
    } catch (error) {
      onError(error);
      const reason = what === 'indexer' ? indexerCause(error) : isTimeout(error) ? NODE_TIMEOUT : 'The node could not answer this request.';
      const kept = lastGood.get(key);
      return kept ? { value: kept.value as T, stale: true, at: kept.at, reason } : { value: null, stale: false, at: null, reason };
    }
  }

  const getJson = (path: string): Promise<unknown> => {
    if (indexer === undefined) return Promise.reject(new IndexerUnavailableError('no indexer configured'));
    return indexer.getJson(path);
  };

  /** Indexer `/v1/blocks` rows plus each block's author from the node. */
  async function blockRows(limit: number, offset: number): Promise<{ total: number | null; rows: BlockRow[] }> {
    const raw = await getJson(`/v1/blocks?limit=${limit}&offset=${offset}`);
    if (!isRecord(raw) || !Array.isArray(raw.items)) throw new IndexerResponseError('/v1/blocks has no items list');
    const items = raw.items.filter(isRecord);
    const numbers = items.map((i) => Number(i.number)).filter((n) => Number.isInteger(n));
    const authors = await within(chain.blockAuthors(numbers), timeoutMs, 'node').catch(() => new Map<number, string | null>());
    const rows = items.map(
      (i): BlockRow => ({
        number: Number(i.number),
        hash: String(i.hash),
        timestampMs: typeof i.timestampMs === 'number' ? i.timestampMs : null,
        author: authors.get(Number(i.number)) ?? null,
        extrinsics: typeof i.extrinsicCount === 'number' ? i.extrinsicCount : null,
        events: typeof i.eventCount === 'number' ? i.eventCount : null,
      }),
    );
    return { total: typeof raw.total === 'number' ? raw.total : null, rows };
  }

  /** The feed: `/v1/activity` for every agent; `/v1/agents/:address/events` (paged on the indexer) for one. */
  async function feed(agent: string | null, kind: string | null, page: number, limit: number): Promise<{ total: number | null; historyFrom: number | null; entries: ActivityEntry[]; notAgent?: boolean }> {
    const offset = (page - 1) * limit;
    if (agent === null) {
      const raw = await options.activity.activity({ agent: null, offset, limit, ...(kind ? { kind } : {}) });
      const view = toActivityView(raw, (section, method) => chain.eventFieldTypes(section, method), { agent: null, offset });
      return { total: view.total, historyFrom: view.historyFrom, entries: [...view.entries] };
    }
    let raw: unknown;
    try {
      raw = await getJson(`/v1/agents/${encodeURIComponent(agent)}/events?limit=${limit}&offset=${offset}`);
    } catch (error) {
      // The route answers 404 for an address that is not a registered agent:
      // that is an answer ("no agent events"), not a failure.
      if (error instanceof IndexerUnavailableError && /answered 404/.test(error.message)) return { total: 0, historyFrom: null, entries: [], notAgent: true };
      throw error;
    }
    if (!isRecord(raw) || !Array.isArray(raw.items)) throw new IndexerResponseError('/v1/agents/:address/events has no items list');
    const items = raw.items.filter(isRecord).map((item) => ({
      ...item,
      agents: Array.isArray(item.agents) ? item.agents : Array.isArray(item.accounts) ? item.accounts : [],
      kind: typeof item.kind === 'string' ? item.kind : kindOf(String(item.section), String(item.method)),
      timestampMs: typeof item.timestampMs === 'number' ? item.timestampMs : null,
      extrinsicId: typeof item.extrinsicId === 'string' ? item.extrinsicId : null,
    }));
    const view = toActivityView({ total: raw.total, limit: raw.limit ?? limit, historyFrom: null, items }, (section, method) => chain.eventFieldTypes(section, method), { agent, offset });
    const entries = kind === null ? [...view.entries] : view.entries.filter((e) => e.kind === kind);
    return { total: kind === null ? view.total : null, historyFrom: null, entries };
  }

  /** Resolves the search field to the page it names, or null when nothing matches. */
  async function resolveSearch(raw: string): Promise<string | null> {
    if (raw === '') return null;
    // The explorer prints block numbers and extrinsic ids with separators ("1,167,523-0"); a pasted copy resolves too.
    const query = /^\d{1,3}(?:,\d{3})+(?:-\d+)?$/.test(raw) ? raw.replace(/,/g, '') : raw;
    const ref = parseBlockRef(query);
    if (ref?.kind === 'number') return blockPath(ref);
    const id = parseExtrinsicId(query);
    if (id !== null) return extrinsicPath({ kind: 'number', number: id.number }, id.index);
    if (HASH_64.test(query)) {
      const hash = query.toLowerCase();
      try {
        await within(chain.block({ kind: 'hash', hash }), timeoutMs, 'node');
        return blockPath({ kind: 'hash', hash });
      } catch (error) {
        if (!(error instanceof BlockNotFoundError)) throw error;
      }
      return null;
    }
    if (isAddress(query)) return accountPath(query);
    return null;
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = parseRoute(request.url ?? '/');
    const renderedAt = new Date().toISOString();
    const ctx = (block: number | null): PageContext => ({ info, renderedAt, block });

    switch (route.kind) {
      case 'home': {
        const [heads, agents, lastEmission, blocks, activity] = await Promise.all([
          live('heads', async () => {
            const h = await chain.heads();
            return { best: h.best.number, finalized: h.finalized };
          }, 'node'),
          live('agents', async () => {
            const raw = await getJson('/v1/agents?limit=1');
            if (!isRecord(raw) || typeof raw.total !== 'number') throw new IndexerResponseError('/v1/agents has no total');
            return raw.total;
          }, 'indexer'),
          live('emission', async () => {
            const raw = await getJson('/v1/emissions');
            const v = isRecord(raw) ? wideInteger(raw, 'lastEraEmissionPlancks') : null;
            if (v === null || !isRecord(raw)) throw new IndexerResponseError('/v1/emissions has no lastEraEmissionPlancks');
            return { amount: v, era: typeof raw.lastSettledEra === 'number' ? raw.lastSettledEra : null };
          }, 'indexer'),
          live('home-blocks', async () => (await blockRows(10, 0)).rows, 'indexer'),
          live('home-activity', async () => (await feed(null, null, 1, 10)).entries, 'indexer'),
        ]);
        send(response, 200, renderHome({ ctx: ctx(heads.value?.best ?? null), heads, agents, lastEmission, blocks, activity }));
        return;
      }

      case 'blocks': {
        const [list, heads] = await Promise.all([
          live(`blocks-${route.page}`, () => blockRows(PAGE_SIZE, (route.page - 1) * PAGE_SIZE), 'indexer'),
          live('heads', async () => {
            const h = await chain.heads();
            return { best: h.best.number, finalized: h.finalized };
          }, 'node'),
        ]);
        if (list.value === null) throw new IndexerUnavailableError(list.reason ?? INDEXER_FAILED);
        send(
          response,
          200,
          renderBlocks({ ctx: ctx(heads.value?.best ?? null), page: route.page, total: list.value.total, finalized: heads.value?.finalized ?? null, rows: list.value.rows, listAt: list.at ?? renderedAt }),
        );
        return;
      }

      case 'block': {
        const view = await chain.block(route.ref);
        send(response, 200, renderBlock(view, route.tab, ctx(view.detail?.best ?? null)));
        return;
      }

      case 'extrinsic': {
        const view = await chain.extrinsic(route.ref, route.index);
        send(response, 200, renderExtrinsic(view, ctx(view.block.number)));
        return;
      }

      case 'account': {
        const offset = (route.page - 1) * PAGE_SIZE;
        const [view, agentRaw, list] = await Promise.all([
          chain.account(route.address),
          indexer === undefined ? Promise.resolve(null) : within(getJson(`/v1/agents/${encodeURIComponent(route.address)}`), timeoutMs, 'indexer').catch(() => null),
          indexer === undefined
            ? Promise.resolve(null)
            : route.tab === 'activity'
              ? live(`acct-act-${route.address}-${route.page}`, async () => {
                  const f = await feed(route.address, null, route.page, PAGE_SIZE);
                  return { total: f.total, items: f.entries, notAgent: f.notAgent === true };
                }, 'indexer')
              : live(`acct-x-${route.address}-${route.page}`, async () => {
                  const raw = await getJson(`/v1/accounts/${encodeURIComponent(route.address)}/extrinsics?limit=${PAGE_SIZE}&offset=${offset}`);
                  const items: HistoryEntry[] = toHistory(raw);
                  return { total: isRecord(raw) && typeof raw.total === 'number' ? raw.total : null, items };
                }, 'indexer'),
        ]);
        const roles = view.roles;
        const name = roles?.agentName.value ?? (isRecord(agentRaw) && typeof agentRaw.name === 'string' ? agentRaw.name : null);
        const stake = roles?.agentStake.value ?? (isRecord(agentRaw) ? wideInteger(agentRaw, 'stakePlancks') : null);
        const isAgent = (roles?.agentStake.value ?? null) !== null || isRecord(agentRaw);
        const hb = roles?.heartbeat?.value ?? null;
        const agent: AgentCard | null = isAgent
          ? {
              name,
              stake,
              registeredAt: isRecord(agentRaw) && typeof agentRaw.registeredAtBlock === 'number' ? agentRaw.registeredAtBlock : null,
              lastHeartbeat: hb?.lastHeartbeat ?? (isRecord(agentRaw) && typeof agentRaw.lastHeartbeatBlock === 'number' ? agentRaw.lastHeartbeatBlock : null),
              active: hb ? hb.best - hb.lastHeartbeat <= hb.grace : null,
              operatorRun: typeof name === 'string' && name.startsWith('swarm-'),
            }
          : null;
        send(response, 200, renderAccount({ ctx: ctx(view.at.number), view, tab: route.tab, page: route.page, agent, list }));
        return;
      }

      case 'activity': {
        const result = await within(feed(route.agent, route.activityKind, route.page, PAGE_SIZE), timeoutMs, 'indexer');
        send(
          response,
          200,
          renderActivity({ ctx: ctx(null), agent: route.agent, kind: route.activityKind, page: route.page, total: result.total, historyFrom: result.historyFrom, entries: result.entries, listAt: new Date().toISOString(), notAgent: result.notAgent === true }),
        );
        return;
      }

      case 'search': {
        const target = await resolveSearch(route.query);
        if (target === null) {
          send(response, 404, renderNothingFound(route.query, ctx(null)));
          return;
        }
        redirect(response, target);
        return;
      }

      case 'chrome':
        sendBytes(response, 200, 'text/css; charset=utf-8', stylesheet);
        return;

      case 'favicon':
        sendBytes(response, 200, 'image/svg+xml', favicon);
        return;

      case 'font':
        sendBytes(response, 200, 'font/woff2', fonts.get(route.name) ?? Buffer.alloc(0));
        return;

      case 'badRequest':
        send(response, 400, renderError(400, route.message, ctx(null)));
        return;

      case 'notFound':
        send(response, 404, renderError(404, 'There is no page at this address.', ctx(null)));
        return;
    }
  }

  return createServer((request, response) => {
    if (/\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) acceptsGzip.add(response);
    const errorCtx: PageContext = { info, renderedAt: new Date().toISOString(), block: null };
    handle(request, response).catch((error: unknown) => {
      if (error instanceof BlockNotFoundError) {
        send(response, 404, renderError(404, 'This chain has no such block yet.', errorCtx));
        return;
      }
      if (error instanceof ExtrinsicNotFoundError) {
        send(response, 404, renderError(404, 'That block has no extrinsic at this position.', errorCtx));
        return;
      }
      if (error instanceof InvalidAddressError) {
        send(response, 400, renderError(400, 'That is not an account address on this chain.', errorCtx));
        return;
      }
      onError(error);
      if (error instanceof IndexerUnavailableError || error instanceof IndexerResponseError || (error instanceof TimeoutError && /indexer/.test(error.message))) {
        const timedOut = isTimeout(error);
        send(response, timedOut ? 504 : 502, renderError(timedOut ? 504 : 502, timedOut ? INDEXER_TIMEOUT : INDEXER_FAILED, errorCtx));
        return;
      }
      const timedOut = isTimeout(error);
      send(response, timedOut ? 504 : 502, renderError(timedOut ? 504 : 502, timedOut ? NODE_TIMEOUT : 'The node could not answer this request.', errorCtx));
    });
  });
}

/** The activity kind of an event, for indexer rows that do not carry one (the per-agent events route). */
function kindOf(section: string, method: string): string {
  if (section === 'escrow') return method.startsWith('Dispute') ? 'dispute' : 'agreement';
  if (section === 'agents') {
    if (method === 'AgentRegistered') return 'registration';
    if (method === 'HeartbeatSent') return 'heartbeat';
    if (method.startsWith('Slash')) return 'slash';
  }
  if (section === 'oracle') return 'oracle_vote';
  if (/messag/i.test(section)) return 'message';
  return 'other';
}
