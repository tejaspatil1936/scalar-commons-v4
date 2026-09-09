import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';

import type { ApiPromise } from '@polkadot/api';
import { WsProvider } from '@polkadot/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiServer, ROUTES } from '../src/api.ts';
import type { ChainConnection } from '../src/chain.ts';
import type { ConnectionStatus } from '../src/reconnect.ts';
import { ConnectionSupervisor, backoffDelayMs } from '../src/reconnect.ts';
import type { ChainIndexer } from '../src/indexer.ts';
import { IndexerStore } from '../src/store.ts';
import type { IndexerConfig } from '../src/config.ts';

/**
 * Recovery from a dropped node socket — issue #155.
 *
 * The 2026-09-09 launch left the indexer answering
 * `500 {"error":"WebSocket is not connected"}` on `/v1/status` for 74 minutes
 * after Alice restarted, with the node healthy on loopback the whole time and
 * `systemctl` reporting the unit `active (running)`. Two defects: the client
 * never reconnected, and "the node is absent" was reported as `500` — a fault
 * in the indexer — rather than `503`, which is what it is.
 *
 * No chain is needed to hold either fix down. The reconnect path runs against a
 * real websocket that is killed mid-connection (a 1006 abnormal close, exactly
 * what journald recorded), and the status mapping runs against a real HTTP
 * server over a real in-memory index.
 */

const ENDPOINT = 'ws://127.0.0.1:9944';

const ABNORMAL_CLOSURE = 'disconnected from ws://127.0.0.1:9944: 1006:: Abnormal Closure';

describe('backoffDelayMs', () => {
  it('backs off exponentially from the first retry', () => {
    const policy = { initialDelayMs: 1_000, maxDelayMs: 30_000, factor: 2 };
    expect(backoffDelayMs(1, policy)).toBe(1_000);
    expect(backoffDelayMs(2, policy)).toBe(2_000);
    expect(backoffDelayMs(3, policy)).toBe(4_000);
    expect(backoffDelayMs(4, policy)).toBe(8_000);
  });

  it('caps the delay, so a long outage still retries on a bounded interval', () => {
    const policy = { initialDelayMs: 1_000, maxDelayMs: 30_000, factor: 2 };
    expect(backoffDelayMs(6, policy)).toBe(30_000);
    expect(backoffDelayMs(500, policy)).toBe(30_000);
  });

  it('never returns a zero or negative delay, which would busy-loop the retry', () => {
    for (const attempt of [0, 1, 2, 3, 10]) {
      expect(backoffDelayMs(attempt), `attempt ${attempt}`).toBeGreaterThan(0);
    }
  });
});

/** A stand-in for `WsProvider` that reports and emits what the real one does. */
class FakeProvider {
  isConnected = true;
  connectCalls = 0;
  nodeUp = true;

  private readonly listeners = new Map<string, Set<(value?: unknown) => unknown>>();

  on(type: string, handler: (value?: unknown) => unknown): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);
    return () => set.delete(handler);
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (!this.nodeUp) {
      this.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:9944'));
      this.drop('connect ECONNREFUSED 127.0.0.1:9944');
      return;
    }
    this.isConnected = true;
    this.emit('connected');
  }

  drop(reason = ABNORMAL_CLOSURE): void {
    this.isConnected = false;
    this.emit('error', new Error(reason));
    this.emit('disconnected');
  }

  private emit(type: string, value?: unknown): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(value);
    }
  }
}

function recordingLogger() {
  const lines: string[] = [];
  return {
    lines,
    log: (message?: unknown) => lines.push(String(message)),
    error: (message?: unknown) => lines.push(String(message)),
  };
}

describe('ConnectionSupervisor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the socket as down the moment it closes, and says why', () => {
    const provider = new FakeProvider();
    const logger = recordingLogger();
    vi.useFakeTimers();
    const supervisor = new ConnectionSupervisor({ provider, endpoint: ENDPOINT, logger });

    expect(supervisor.status().connected).toBe(true);

    provider.drop();

    expect(supervisor.status().connected).toBe(false);
    expect(supervisor.status().downtimeMs).not.toBeNull();
    expect(supervisor.status().lastError).toContain('1006');
    expect(logger.lines.join('\n')).toMatch(/lost the connection to ws:\/\/127\.0\.0\.1:9944/);

    supervisor.stop();
  });

  it('reconnects on its own, and logs the recovery', async () => {
    const provider = new FakeProvider();
    const logger = recordingLogger();
    vi.useFakeTimers();
    const supervisor = new ConnectionSupervisor({
      provider,
      endpoint: ENDPOINT,
      policy: { initialDelayMs: 1_000, maxDelayMs: 30_000, factor: 2 },
      logger,
    });

    provider.drop();
    expect(provider.connectCalls, 'the retry must be scheduled, not immediate').toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(provider.connectCalls).toBe(1);
    expect(supervisor.status().connected).toBe(true);
    expect(supervisor.status().downtimeMs).toBeNull();
    expect(supervisor.status().attempts).toBe(0);
    expect(logger.lines.join('\n')).toMatch(/reconnected to ws:\/\/127\.0\.0\.1:9944/);

    supervisor.stop();
  });

  it('keeps retrying while the node is still down, on a growing then capped delay', async () => {
    const provider = new FakeProvider();
    provider.nodeUp = false;
    vi.useFakeTimers();
    const supervisor = new ConnectionSupervisor({
      provider,
      endpoint: ENDPOINT,
      policy: { initialDelayMs: 1_000, maxDelayMs: 4_000, factor: 2 },
      logger: recordingLogger(),
    });

    provider.drop();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(provider.connectCalls, 'first retry after 1s').toBe(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(provider.connectCalls, 'second retry is 2s out, not 1s').toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(provider.connectCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(provider.connectCalls).toBe(3);

    await vi.advanceTimersByTimeAsync(4_000 * 10);
    expect(provider.connectCalls).toBe(13);
    expect(supervisor.status().connected).toBe(false);

    provider.nodeUp = true;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(supervisor.status().connected).toBe(true);

    supervisor.stop();
  });

  it('does not stack retries when the provider reports the same drop twice', async () => {
    const provider = new FakeProvider();
    vi.useFakeTimers();
    const supervisor = new ConnectionSupervisor({
      provider,
      endpoint: ENDPOINT,
      policy: { initialDelayMs: 1_000, maxDelayMs: 1_000, factor: 2 },
      logger: recordingLogger(),
    });

    provider.drop();
    provider.drop();
    provider.drop();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(provider.connectCalls).toBe(1);

    supervisor.stop();
  });

  it('stops retrying once stopped, so a shutdown does not resurrect the socket', async () => {
    const provider = new FakeProvider();
    provider.nodeUp = false;
    vi.useFakeTimers();
    const supervisor = new ConnectionSupervisor({
      provider,
      endpoint: ENDPOINT,
      policy: { initialDelayMs: 1_000, maxDelayMs: 1_000, factor: 2 },
      logger: recordingLogger(),
    });

    provider.drop();
    supervisor.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.connectCalls).toBe(0);
  });
});

/**
 * A websocket server that completes the handshake and serves nothing else —
 * enough for `WsProvider` to connect, and to be killed without a close frame so
 * the client sees the 1006 the outage produced.
 */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function handshakeServer() {
  const sockets = new Set<Socket>();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', (chunk: Buffer) => {
      const key = /sec-websocket-key:\s*(\S+)/i.exec(chunk.toString('utf8'))?.[1] ?? '';
      const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          '',
        ].join('\r\n'),
      );
    });
  });

  return {
    /** Listens on `port`, or on any free port when it is 0. Re-listenable after `close`. */
    listen: (port = 0) =>
      new Promise<number>((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
      }),
    /** Kills every live connection without a close frame: a 1006 for the client. */
    killConnections: () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        sockets.clear();
        server.close(() => resolve());
      }),
  };
}

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`condition still false after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('a real websocket close', () => {
  it('is recovered from without a restart, once the node is back', async () => {
    const node = handshakeServer();
    const port = await node.listen();
    const endpoint = `ws://127.0.0.1:${port}`;

    // autoConnect off: reconnection is the supervisor's job, and two retry
    // loops on one socket race each other.
    const provider = new WsProvider(endpoint, false);
    const logger = recordingLogger();
    const supervisor = new ConnectionSupervisor({
      provider,
      endpoint,
      policy: { initialDelayMs: 20, maxDelayMs: 100, factor: 2 },
      logger,
    });

    try {
      await provider.connect();
      await until(() => supervisor.status().connected);

      node.killConnections();
      await until(() => !supervisor.status().connected);
      // The loss is reported with the endpoint on it. The close *code* is not
      // asserted here because `WsProvider` does not pass one: its `disconnected`
      // event carries no arguments, and the `1006:: Abnormal Closure` string
      // journald recorded is built inside the provider and handed only to the
      // RPC calls that were in flight. What a service can know is asserted; what
      // it cannot is left to the fake-provider cases above.
      expect(logger.lines.join('\n')).toMatch(new RegExp(`lost the connection to ${endpoint}`));
      expect(supervisor.status().downtimeMs).toBeGreaterThanOrEqual(0);

      await until(() => supervisor.status().connected, 10_000);
      expect(provider.isConnected).toBe(true);
      expect(supervisor.status().downtimeMs).toBeNull();
      expect(logger.lines.join('\n')).toMatch(/reconnected to/);
    } finally {
      supervisor.stop();
      await provider.disconnect().catch(() => undefined);
      await node.close();
    }
  });

  it('recovers even when a retry finds the node still down', async () => {
    // The case that made the outage permanent, and the reason
    // `releaseStuckSocket` exists. When a reconnect attempt cannot complete its
    // handshake — the node is mid-restart, so the connection is refused — Node's
    // WebSocket fires `error` and never fires `close`, so `WsProvider` keeps
    // holding a socket in CONNECTING and every later `connect()` throws
    // `WebSocket is already connected`. One failed retry used to disable the
    // client for good; the only recovery was `systemctl restart`.
    const node = handshakeServer();
    const port = await node.listen();
    const endpoint = `ws://127.0.0.1:${port}`;

    const provider = new WsProvider(endpoint, false);
    const logger = recordingLogger();
    const supervisor = new ConnectionSupervisor({
      provider,
      endpoint,
      policy: { initialDelayMs: 50, maxDelayMs: 250, factor: 2 },
      logger,
    });

    try {
      await provider.connect();
      await until(() => supervisor.status().connected);

      // The node goes away completely: listener closed, further connects refused.
      await node.close();
      await until(() => !supervisor.status().connected);
      // Wait for at least one retry to have failed against the closed port.
      await until(() => supervisor.status().attempts >= 2, 10_000);
      expect(provider.isConnected).toBe(false);

      // It comes back on the same port, and nothing restarts this process.
      await node.listen(port);
      await until(() => supervisor.status().connected, 20_000);

      expect(provider.isConnected).toBe(true);
      expect(supervisor.status().downtimeMs).toBeNull();
      // The half-open socket had to be discarded for that to be possible, and
      // saying so once per outage is what makes it auditable. If a future
      // polkadot-js release changes how the socket is held, this line stops
      // appearing and this test fails rather than the next node restart.
      expect(logger.lines.join('\n')).toMatch(/discarded a socket the failed attempt left half-open/);
      expect(logger.lines.join('\n')).toMatch(/reconnected to/);
    } finally {
      supervisor.stop();
      await provider.disconnect().catch(() => undefined);
      await node.close();
    }
  });
});

// ─── HTTP status mapping ─────────────────────────────────────────────────────

const CONFIG: IndexerConfig = {
  rpcUrl: ENDPOINT,
  host: '127.0.0.1',
  port: 0,
  dbPath: ':memory:',
  backfillDepth: 256,
};

/**
 * The little of `ApiPromise` that `/v1/status` reads, and a switch to make every
 * read fail with the polkadot-js message a closed socket produces.
 */
function fakeApi(isConnected: () => boolean) {
  const requireSocket = () => {
    if (!isConnected()) {
      throw new Error('WebSocket is not connected\nFailed WS Request: {"method":"chain_getHeader"}');
    }
  };
  const header = (height: number) => ({ number: { toNumber: () => height } });

  return {
    get isConnected() {
      return isConnected();
    },
    runtimeVersion: {
      specName: { toString: () => 'scalar-commons' },
      specVersion: { toNumber: () => 305 },
    },
    rpc: {
      system: {
        chain: async () => {
          requireSocket();
          return { toString: () => 'Scalar Commons Local Testnet' };
        },
      },
      chain: {
        getHeader: async () => {
          requireSocket();
          return header(529_821);
        },
        getFinalizedHead: async () => {
          requireSocket();
          return `0x${'ab'.repeat(32)}`;
        },
      },
    },
  } as unknown as ApiPromise;
}

async function httpHarness() {
  let connected = true;
  let downSince: number | null = null;

  const store = IndexerStore.open(':memory:');
  const api = fakeApi(() => connected);
  const chain: ChainConnection = {
    api,
    ss58Format: 42,
    tokenSymbol: 'CMN',
    tokenDecimals: 12,
    connection: (): ConnectionStatus => ({
      endpoint: ENDPOINT,
      connected,
      downtimeMs: downSince === null ? null : Math.max(0, Date.now() - downSince),
      attempts: connected ? 0 : 12,
      lastError: connected ? null : ABNORMAL_CLOSURE,
    }),
    disconnect: async () => undefined,
  };
  const indexer = {
    syncedHeight: 529_815,
    indexedBlocks: 32_630,
  } as unknown as ChainIndexer;

  const server: Server = createApiServer({ store, api, chain, indexer, config: CONFIG });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setConnected: (next: boolean) => {
      connected = next;
      downSince = next ? null : Date.now();
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

describe('GET /v1/status while the node socket is down', () => {
  it('answers 503 naming the reason, not 500', async () => {
    const h = await httpHarness();
    try {
      expect((await fetch(`${h.url}/v1/status`)).status).toBe(200);

      h.setConnected(false);
      const response = await fetch(`${h.url}/v1/status`);
      const body = (await response.json()) as Record<string, unknown>;

      // 500 read as "the indexer is broken" to every monitor and to nginx for
      // 74 minutes. It was not broken; it was waiting for its node.
      expect(response.status).toBe(503);
      expect(String(body.error)).toContain(ENDPOINT);
      expect(response.headers.get('retry-after')).toBeTruthy();

      const connection = body.connection as Record<string, unknown>;
      expect(connection.connected).toBe(false);
      expect(String(connection.lastError)).toContain('1006');
    } finally {
      await h.close();
    }
  });

  it('still reports how far the index got, which is the useful part while degraded', async () => {
    const h = await httpHarness();
    try {
      h.setConnected(false);
      const body = (await (await fetch(`${h.url}/v1/status`)).json()) as Record<string, unknown>;
      const indexer = body.indexer as Record<string, unknown>;
      expect(indexer.syncedHeight).toBe(529_815);
      expect(indexer.indexedBlocks).toBe(32_630);
      expect((body.api as Record<string, unknown>).endpoints).toBe(ROUTES.length);
    } finally {
      await h.close();
    }
  });

  it('goes back to 200 once the socket is back, with no restart in between', async () => {
    const h = await httpHarness();
    try {
      h.setConnected(false);
      expect((await fetch(`${h.url}/v1/status`)).status).toBe(503);

      h.setConnected(true);

      const response = await fetch(`${h.url}/v1/status`);
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(200);
      expect((body.chain as Record<string, unknown>).name).toBe('Scalar Commons Local Testnet');
      expect((body.chain as Record<string, unknown>).bestBlock).toBe(529_821);
    } finally {
      await h.close();
    }
  });

  it('answers any other chain-backed route with 503 too, rather than a bare 500', async () => {
    const h = await httpHarness();
    try {
      h.setConnected(false);
      const response = await fetch(`${h.url}/v1/emissions/supply`);
      expect(response.status).toBe(503);
      expect(String(((await response.json()) as Record<string, unknown>).error)).toContain(ENDPOINT);
    } finally {
      await h.close();
    }
  });

  it('keeps serving the index itself, which does not need the node', async () => {
    const h = await httpHarness();
    try {
      h.setConnected(false);
      // Blocks already indexed are in SQLite. A dropped socket must not turn a
      // question the indexer can answer into an error.
      const response = await fetch(`${h.url}/v1/blocks`);
      expect(response.status).toBe(200);
      expect((await response.json()) as Record<string, unknown>).toMatchObject({ total: 0, items: [] });
    } finally {
      await h.close();
    }
  });
});
