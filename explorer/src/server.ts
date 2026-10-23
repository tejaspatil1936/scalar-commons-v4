/**
 * The HTTP surface.
 *
 * A thin adapter: parse the URL into a route, ask the chain client (single
 * items) and the indexer (lists) for the view model, render it. It is read-only
 * by construction — the chain client it wraps has no `tx` surface at all, so no
 * request can change chain or server state.
 *
 * Every failure mode has a distinct status, because they mean different things
 * to a visitor: 400 for "that is not a block/address at all", 404 for "the chain
 * does not have it", 502 for "the node or the indexer did not answer".
 * Collapsing them would make an unreachable node look like an empty chain. The
 * sentence on an error page is written here from what the server knows; the
 * upstream error's own text (which may name an internal address) goes to the
 * log only.
 *
 * Besides the views it serves the chrome: `/chrome.css` (tokens + fonts +
 * chrome, read once at startup from the synced copy under `src/chrome/`), the
 * two font files under `/fonts/`, `/chrome.js` (the copy buttons) and
 * `/favicon.svg`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  ACTIVITY_PAGE_SIZE,
  HOME_ROWS,
  IndexerNotFoundError,
  IndexerResponseError,
  IndexerUnavailableError,
  accountEventsPath,
  activityFeedPath,
  agentEventsPath,
  toActivityView,
  toAgentRecord,
  toAgentsTotal,
  toBlocksPage,
  toEmissions,
  toEventsPage,
  toHistoryPage,
  type IndexerReader,
} from './activity.js';
import { BlockNotFoundError, ExtrinsicNotFoundError, InvalidAddressError, type ExplorerChain } from './chain.js';
import { CHROME_JS, FAVICON_SVG } from './chrome-templates.js';
import { renderAccount, renderActivity, renderBlock, renderBlocks, renderError, renderExtrinsic, renderHome, renderSearchMiss } from './render.js';
import { accountPath, blockPath, extrinsicPath, FONT_FILES, HASH_64, isAddress, parseBlockRef, parseExtrinsicId, parseRoute } from './routes.js';
import type { ActivityEntry, AgentRecord, BlockRow, ListPage, Read, Source } from './types.js';

export interface ExplorerServerOptions {
  readonly chain: ExplorerChain;
  /**
   * The indexer, for every list: blocks, activity, an account's history, the
   * agent record and the home page's counts. Optional: without it the lists
   * render as "not read" and the activity page cannot be served.
   */
  readonly indexer?: IndexerReader;
  /** Where to report upstream failures. Defaults to stderr; tests can silence it. */
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
 * copies nothing else, so a process started from `dist/index.js` reads the
 * copy at `../src/chrome/`; one started from the sources (vitest) reads
 * `./chrome/` beside this file.
 */
export function defaultChromeDir(): string {
  const beside = fileURLToPath(new URL('./chrome/', import.meta.url));
  if (existsSync(beside)) return beside;
  return fileURLToPath(new URL('../src/chrome/', import.meta.url));
}

/** The chrome stylesheet as one file: tokens, then the faces, then the components. */
export function readChromeStylesheet(dir: string): string {
  return ['tokens.css', 'fonts.css', 'chrome.css'].map((name) => readFileSync(new URL(name, pathToDirUrl(dir)), 'utf8')).join('\n');
}

const pathToDirUrl = (dir: string): URL => new URL(`file://${dir.endsWith('/') ? dir : `${dir}/`}`);

/** The sentence an error page shows for an upstream failure; the detail goes to the log. */
const publicMessage = (error: unknown): string =>
  error instanceof IndexerUnavailableError || error instanceof IndexerResponseError ? error.publicMessage : 'The node did not answer.';

/** Builds the explorer HTTP server around an already-connected chain client. */
export function createExplorerServer(options: ExplorerServerOptions): Server {
  const { chain, indexer } = options;
  const onError = options.onError ?? ((error: unknown) => console.error('[explorer]', error));
  const info = chain.chainInfo();
  const chromeDir = options.chromeDir ?? defaultChromeDir();
  const stylesheet = Buffer.from(readChromeStylesheet(chromeDir), 'utf8');
  const script = Buffer.from(CHROME_JS, 'utf8');
  const favicon = Buffer.from(FAVICON_SVG, 'utf8');
  const fonts = new Map(FONT_FILES.map((name) => [name, readFileSync(new URL(`fonts/${name}`, pathToDirUrl(chromeDir)))]));

  /** One indexer read as a `Read`: a failure is one unavailable figure with its public reason, never a 502 for the page. */
  async function indexerRead<T>(path: string, shape: (raw: unknown) => T): Promise<Read<T> | undefined> {
    if (indexer === undefined) return undefined;
    const source: Source = { method: 'GET', url: path, fetchedAt: new Date().toISOString(), block: null, raw: null };
    try {
      return { value: shape(await indexer.getJson(path)), source, reason: null };
    } catch (error) {
      onError(error);
      return { value: null, source, reason: publicMessage(error) };
    }
  }

  /**
   * The events naming an address, one page: `/v1/agents/:address/events` for a
   * registered agent, `/v1/events?account=` for any other account (the agent
   * route answers 404 for those). Both are one paged query on the indexer.
   */
  async function eventsNaming(address: string, offset: number): Promise<unknown> {
    if (indexer === undefined) throw new IndexerUnavailableError('no indexer configured', 'The indexer is not configured.');
    try {
      return await indexer.getJson(agentEventsPath(address, offset, ACTIVITY_PAGE_SIZE));
    } catch (error) {
      if (!(error instanceof IndexerNotFoundError)) throw error;
      return indexer.getJson(accountEventsPath(address, offset, ACTIVITY_PAGE_SIZE));
    }
  }

  /** Resolves the search field to the view it names, or null when nothing matches. */
  async function resolveSearch(query: string): Promise<string | null> {
    if (query === '') return null;
    const ref = parseBlockRef(query);
    if (ref?.kind === 'number') return blockPath(ref);
    const id = parseExtrinsicId(query);
    if (id !== null) return extrinsicPath({ kind: 'number', number: id.number }, id.index);
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
    return null;
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = parseRoute(request.url ?? '/');
    const fieldTypes = (section: string, method: string) => chain.eventFieldTypes(section, method);

    switch (route.kind) {
      case 'home': {
        const indexerReadAt = new Date().toISOString();
        const [view, agents, emission, activity] = await Promise.all([
          chain.home(),
          indexerRead('/v1/agents?limit=1', toAgentsTotal),
          indexerRead('/v1/emissions', toEmissions),
          indexerRead(`/v1/activity?limit=${HOME_ROWS}`, (raw) => toActivityView(raw, fieldTypes, { agent: null, filter: null, offset: 0 }).entries as readonly ActivityEntry[]),
        ]);
        send(response, 200, renderHome({ ...view, ...(agents ? { agents } : {}), ...(emission ? { emission } : {}), ...(activity ? { activity } : {}), indexerReadAt }));
        return;
      }

      case 'blocks': {
        if (indexer === undefined) throw new IndexerUnavailableError('no indexer configured', 'The indexer is not configured.');
        const renderedAt = new Date().toISOString();
        const [page, heads] = await Promise.all([indexer.getJson(`/v1/blocks?limit=${ACTIVITY_PAGE_SIZE}&offset=${route.offset}`).then(toBlocksPage), chain.heads()]);
        const authors = await chain.authors(page.items);
        const rows: ListPage<BlockRow> = { ...page, items: page.items.map((b) => ({ ...b, author: authors.get(b.hash) ?? null })) };
        send(response, 200, renderBlocks({ chain: info, best: heads.best, finalized: heads.finalized, page: rows, renderedAt }));
        return;
      }

      case 'block':
        send(response, 200, renderBlock(await chain.block(route.ref), info, route.tab));
        return;

      case 'extrinsic':
        send(response, 200, renderExtrinsic(await chain.extrinsic(route.ref, route.index), info));
        return;

      case 'account': {
        const view = await chain.account(route.address);
        const agent = await readAgent(view.address);
        const list =
          route.tab === 'extrinsics'
            ? { extrinsics: await indexerRead(`/v1/accounts/${encodeURIComponent(view.address)}/extrinsics?limit=${ACTIVITY_PAGE_SIZE}&offset=${route.offset}`, toHistoryPage) }
            : { events: await indexerReadFrom(() => eventsNaming(view.address, route.offset), (raw) => toEventsPage(raw, fieldTypes)) };
        send(response, 200, renderAccount({ ...view, ...(agent ? { agent } : {}), tab: route.tab, ...list }, info));
        return;
      }

      case 'activity': {
        if (indexer === undefined) throw new IndexerUnavailableError('no indexer configured', 'The indexer is not configured.');
        const query = { agent: route.agent, filter: route.filter, offset: route.offset };
        const readAt = new Date().toISOString();
        // One agent and no kind: the indexer's per-agent event route. Anything
        // else: the activity feed with the indexer's own agent and kind filters.
        const [raw, heads] = await Promise.all([
          route.agent !== null && route.filter === null ? eventsNaming(route.agent, route.offset) : indexer.getJson(activityFeedPath(query, ACTIVITY_PAGE_SIZE)),
          chain.heads(),
        ]);
        send(response, 200, renderActivity({ ...toActivityView(raw, fieldTypes, query, readAt), best: heads.best }, info));
        return;
      }

      case 'search': {
        const target = await resolveSearch(route.query);
        if (target === null) {
          const heads = await chain.heads();
          send(response, 404, renderSearchMiss(route.query, info, heads.best, new Date().toISOString()));
          return;
        }
        redirect(response, target);
        return;
      }

      case 'chrome':
        sendBytes(response, 200, 'text/css; charset=utf-8', stylesheet);
        return;

      case 'script':
        sendBytes(response, 200, 'text/javascript; charset=utf-8', script);
        return;

      case 'favicon':
        sendBytes(response, 200, 'image/svg+xml', favicon);
        return;

      case 'font':
        sendBytes(response, 200, 'font/woff2', fonts.get(route.name) ?? Buffer.alloc(0));
        return;

      case 'badRequest':
        send(response, 400, renderError(400, `${capitalize(route.message)}.`, info));
        return;

      case 'notFound':
        send(response, 404, renderError(404, `There is nothing at ${new URL(request.url ?? '/', 'http://explorer.invalid').pathname}.`, info));
        return;
    }
  }

  /** The indexer's agent record: null (an answer, not a failure) when the address is not a registered agent. */
  async function readAgent(address: string): Promise<Read<AgentRecord | null> | undefined> {
    if (indexer === undefined) return undefined;
    const path = `/v1/agents/${encodeURIComponent(address)}`;
    const source: Source = { method: 'GET', url: path, fetchedAt: new Date().toISOString(), block: null, raw: null };
    try {
      return { value: toAgentRecord(await indexer.getJson(path)), source, reason: null };
    } catch (error) {
      if (error instanceof IndexerNotFoundError) return { value: null, source, reason: null };
      onError(error);
      return { value: null, source, reason: publicMessage(error) };
    }
  }

  /** As {@link indexerRead}, for a read that is not one fixed path. */
  async function indexerReadFrom<T>(fetch: () => Promise<unknown>, shape: (raw: unknown) => T): Promise<Read<T> | undefined> {
    if (indexer === undefined) return undefined;
    const source: Source = { method: 'GET', url: 'indexer', fetchedAt: new Date().toISOString(), block: null, raw: null };
    try {
      return { value: shape(await fetch()), source, reason: null };
    } catch (error) {
      onError(error);
      return { value: null, source, reason: publicMessage(error) };
    }
  }

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (error instanceof BlockNotFoundError || error instanceof ExtrinsicNotFoundError) {
        send(response, 404, renderError(404, `${capitalize(error.message)}.`, info));
        return;
      }
      if (error instanceof InvalidAddressError) {
        send(response, 400, renderError(400, `${capitalize(error.message.replace(/ \(.*\)$/, ''))}.`, info));
        return;
      }
      // The indexer's failures say so rather than blaming a node that was never
      // asked; the node's failures say that. Neither sentence names an address.
      onError(error);
      send(response, 502, renderError(502, publicMessage(error), info));
    });
  });
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
