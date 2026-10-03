/**
 * The HTTP surface.
 *
 * A thin adapter: parse the URL into a route, ask the chain client for the view
 * model, render it. It is read-only by construction — the chain client it wraps
 * has no `tx` surface at all, so no request can change chain or server state.
 *
 * Every failure mode has a distinct status, because they mean different things
 * to a visitor: 400 for "that is not a block/address at all", 404 for "the chain
 * does not have it", 503 for "the node socket is down and we are reconnecting",
 * 502 for "the node answered, but not with something we could use". Collapsing
 * them would make an unreachable node look like an empty chain.
 *
 * The 503 is issue #155: after a node restart on 2026-09-09 every page here
 * answered a bare 502 for 74 minutes, with no indication that the site was
 * waiting for a chain rather than broken. A page that says what it is waiting
 * for, and a client that reconnects on its own, replace that.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  ACTIVITY_PAGE_SIZE,
  IndexerResponseError,
  IndexerUnavailableError,
  toActivityView,
  type ActivitySource,
} from './activity.js';
import {
  BlockNotFoundError,
  ExtrinsicNotFoundError,
  InvalidAddressError,
  type ExplorerChain,
} from './chain.js';
import { unavailableReason, type ConnectionStatus } from './reconnect.js';
import {
  renderAccount,
  renderActivity,
  renderBlock,
  renderError,
  renderExtrinsic,
  renderHome,
} from './render.js';
import { parseRoute } from './routes.js';

export interface ExplorerServerOptions {
  readonly chain: ExplorerChain;
  /** Where the agent-activity page reads from — the indexer. */
  readonly activity: ActivitySource;
  /** Where to report node failures. Defaults to stderr; tests can silence it. */
  readonly onError?: (error: unknown) => void;
}

/**
 * `Retry-After` on a 503, in seconds.
 *
 * Short on purpose: the reconnect backoff caps at 30s, so a visitor who reloads
 * after this long will usually get a real page.
 */
const RETRY_AFTER_SECONDS = 5;

function send(
  response: ServerResponse,
  status: number,
  html: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(html),
    ...headers,
  });
  response.end(html);
}

/** Builds the explorer HTTP server around an already-connected chain client. */
export function createExplorerServer(options: ExplorerServerOptions): Server {
  const { chain } = options;
  const onError = options.onError ?? ((error: unknown) => console.error('[explorer]', error));
  const info = chain.chainInfo();

  /**
   * The degraded page: 503, naming the node it is waiting for.
   *
   * Rendered in the normal layout rather than as a bare error string, so the
   * chain the explorer belongs to and its navigation are still on the page. A
   * visitor who lands here should be able to tell that the site is up and the
   * chain connection is not.
   */
  function sendDegraded(response: ServerResponse, connection: ConnectionStatus): void {
    send(
      response,
      503,
      renderError(503, `waiting to reconnect to the node — ${unavailableReason(connection)}`, info),
      { 'retry-after': String(RETRY_AFTER_SECONDS) },
    );
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = parseRoute(request.url ?? '/');

    // Only the pages that read chain state are gated. A 400 for a malformed
    // address and a 404 for an unknown path are still the right answers with no
    // node at all, and answering them keeps the site navigable while degraded.
    if (route.kind === 'home' || route.kind === 'block' || route.kind === 'extrinsic' || route.kind === 'account') {
      const connection = chain.connection();
      if (!connection.connected) {
        sendDegraded(response, connection);
        return;
      }
    }

    switch (route.kind) {
      case 'home':
        send(response, 200, renderHome(await chain.home()));
        return;

      case 'block':
        send(response, 200, renderBlock(await chain.block(route.ref), info));
        return;

      case 'extrinsic':
        send(response, 200, renderExtrinsic(await chain.extrinsic(route.ref, route.index), info));
        return;

      case 'account':
        send(response, 200, renderAccount(await chain.account(route.address), info));
        return;

      case 'activity': {
        const query = { agent: route.agent, offset: route.offset };
        const raw = await options.activity.activity({ ...query, limit: ACTIVITY_PAGE_SIZE });
        const view = toActivityView(raw, (section, method) => chain.eventFieldTypes(section, method), query);
        send(response, 200, renderActivity(view, info));
        return;
      }

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
      // A request that raced the socket closing gets the same degraded page as
      // one that arrived after it: the failure is the same failure, and which
      // side of the drop the request landed on is not the visitor's problem.
      const connection = chain.connection();
      if (!connection.connected) {
        onError(error);
        sendDegraded(response, connection);
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
