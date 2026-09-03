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
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  BlockNotFoundError,
  ExtrinsicNotFoundError,
  InvalidAddressError,
  type ExplorerChain,
} from './chain.js';
import { renderAccount, renderBlock, renderError, renderExtrinsic, renderHome } from './render.js';
import { parseRoute } from './routes.js';

export interface ExplorerServerOptions {
  readonly chain: ExplorerChain;
  /** Where to report node failures. Defaults to stderr; tests can silence it. */
  readonly onError?: (error: unknown) => void;
}

function send(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(html),
  });
  response.end(html);
}

/** Builds the explorer HTTP server around an already-connected chain client. */
export function createExplorerServer(options: ExplorerServerOptions): Server {
  const { chain } = options;
  const onError = options.onError ?? ((error: unknown) => console.error('[explorer]', error));
  const info = chain.chainInfo();

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = parseRoute(request.url ?? '/');

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
