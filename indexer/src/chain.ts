/**
 * Connection to the node this indexer follows.
 *
 * Type shapes are taken from the runtime metadata the node serves, never
 * hand-written here: the pallets this indexer reads (`agents`, `escrow`,
 * `emissions`) are chain-specific, and a hard-coded shape would decode into
 * plausible-looking nonsense the first time the runtime changed.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';

import { ConnectionSupervisor, type ConnectionStatus, type ReconnectPolicy } from './reconnect.ts';

export type { ConnectionStatus } from './reconnect.ts';

/** Raised when the configured node cannot be reached. */
export class ChainUnreachableError extends Error {
  constructor(rpcUrl: string, cause: string) {
    super(`cannot reach node at ${rpcUrl}: ${cause}`);
    this.name = 'ChainUnreachableError';
  }
}

export interface ChainConnection {
  readonly api: ApiPromise;
  /** SS58 prefix the chain identifies itself with, used for every address we emit. */
  readonly ss58Format: number;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  /**
   * State of the node socket.
   *
   * Read by the API before it answers anything that needs the node: while the
   * socket is down the index is still serveable but live chain reads are not,
   * and those two facts have different status codes.
   */
  connection(): ConnectionStatus;
  disconnect(): Promise<void>;
}

/**
 * Connects and reads the chain's own properties.
 *
 * **Startup** still fails fast: an indexer that cannot reach its node at boot
 * has nothing truthful to serve, and systemd restarting it is the right answer.
 *
 * A socket lost **later** is a different case, and it used to be handled the
 * same way — which is to say not at all. On 2026-09-09 the node was restarted
 * and this client never reconnected: `/v1/status` answered
 * `500 WebSocket is not connected` for 74 minutes while the node was healthy on
 * loopback, and `api.scalarnet.io` was down until a human restarted the unit. So
 * the socket is now supervised and reconnected on a capped backoff. The old
 * objection to that — a reconnect loop behind a running API would serve a stale
 * index as though it were live — is answered by reporting the gap instead of
 * hiding it: while the socket is down, chain-backed routes answer 503 with the
 * downtime on them, and only the index itself keeps answering 200.
 */
export async function connectChain(
  rpcUrl: string,
  timeoutMs = 30_000,
  options: {
    readonly reconnectPolicy?: Partial<ReconnectPolicy>;
    readonly logger?: Pick<Console, 'log' | 'error'>;
  } = {},
): Promise<ChainConnection> {
  // `false` disables the provider's own retry loop: reconnection is the
  // supervisor's job, and two loops on one socket race each other.
  const provider = new WsProvider(rpcUrl, false);

  let api: ApiPromise;
  try {
    await provider.connect();
    api = await withTimeout(
      ApiPromise.create({ provider, noInitWarn: true, throwOnConnect: true }),
      timeoutMs,
      rpcUrl,
    );
  } catch (error) {
    await provider.disconnect().catch(() => undefined);
    if (error instanceof ChainUnreachableError) {
      throw error;
    }
    throw new ChainUnreachableError(rpcUrl, error instanceof Error ? error.message : String(error));
  }

  const properties = api.registry.getChainProperties();
  const ss58Format = properties?.ss58Format.unwrapOr(undefined)?.toNumber() ?? 42;
  const tokenSymbol = properties?.tokenSymbol.unwrapOr(undefined)?.[0]?.toString() ?? 'UNIT';
  const tokenDecimals = properties?.tokenDecimals.unwrapOr(undefined)?.[0]?.toNumber() ?? 12;

  // Attached only once the API is ready, so a failed startup connect stays a
  // startup failure instead of becoming a retry loop behind a process that is
  // already exiting.
  const supervisor = new ConnectionSupervisor({
    provider,
    endpoint: rpcUrl,
    ...(options.reconnectPolicy === undefined ? {} : { policy: options.reconnectPolicy }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    label: 'indexer:',
  });

  return {
    api,
    ss58Format,
    tokenSymbol,
    tokenDecimals,
    connection: () => supervisor.status(),
    disconnect: () => {
      // Stop supervising first: a deliberate close must not be met with a
      // reconnect, which is what would happen if the order were reversed.
      supervisor.stop();
      return api.disconnect();
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, rpcUrl: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ChainUnreachableError(rpcUrl, `no response within ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
