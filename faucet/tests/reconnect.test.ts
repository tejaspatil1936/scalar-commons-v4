import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer as createTcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { WsProvider } from '@polkadot/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PLANCKS_PER_CMN } from '../src/amount.js';
import type { ChainClient, ChainInfo, ConnectionStatus, TransferReceipt } from '../src/chain.js';
import { FaucetService } from '../src/faucet.js';
import { ConnectionSupervisor, backoffDelayMs } from '../src/reconnect.js';
import { SlidingWindowRateLimiter } from '../src/rateLimiter.js';
import { createFaucetServer } from '../src/server.js';

/**
 * Recovery from a dropped node socket — issue #155.
 *
 * On 2026-09-09 Alice was restarted at 12:59:48 and the faucet was still
 * answering `500 {"error":"WebSocket is not connected"}` 74 minutes later, while
 * `systemctl` reported it `active (running)`. Two things were wrong and both are
 * asserted here: the client never reconnected, and a node that is merely absent
 * was reported as `500` — "we broke" — instead of `503`, "temporarily
 * unavailable", which is the difference between a monitor paging a human about
 * the faucet and a monitor waiting for the chain.
 *
 * Nothing here needs a chain. The reconnect path is exercised against a real
 * websocket — a hand-rolled handshake server, killed mid-connection so the
 * client sees the same abnormal 1006 close the outage produced — and the HTTP
 * status mapping is exercised against a real HTTP server on an ephemeral port.
 */

const ENDPOINT = 'ws://127.0.0.1:9944';

/** The close reason journald recorded when Alice went away. */
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
    // 74 minutes of downtime must not turn into a retry an hour away: the node
    // came back at 14:25 and the faucet has to notice within the cap.
    const policy = { initialDelayMs: 1_000, maxDelayMs: 30_000, factor: 2 };
    expect(backoffDelayMs(6, policy)).toBe(30_000);
    expect(backoffDelayMs(50, policy)).toBe(30_000);
    expect(backoffDelayMs(500, policy)).toBe(30_000);
  });

  it('never returns a zero or negative delay, which would busy-loop the retry', () => {
    for (const attempt of [0, 1, 2, 3, 10]) {
      expect(backoffDelayMs(attempt), `attempt ${attempt}`).toBeGreaterThan(0);
    }
  });
});

/**
 * A provider that reports and emits exactly what `WsProvider` does, so the
 * supervisor can be driven through an outage without waiting on a socket.
 */
class FakeProvider {
  isConnected = true;
  connectCalls = 0;
  /** Set false to make the next `connect()` land on a node that is still down. */
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
      // What a refused socket looks like: the connection attempt itself is
      // accepted, then the socket closes again.
      this.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:9944'));
      this.drop('connect ECONNREFUSED 127.0.0.1:9944');
      return;
    }
    this.isConnected = true;
    this.emit('connected');
  }

  /** Simulates the websocket closing under the client. */
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
    expect(supervisor.status().downtimeMs).toBeNull();

    provider.drop();

    const status = supervisor.status();
    expect(status.connected).toBe(false);
    expect(status.downtimeMs).not.toBeNull();
    expect(status.lastError).toContain('1006');
    // A drop that is not logged is a drop nobody can find afterwards; the
    // outage was diagnosed from exactly this line.
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

    // Capped: from here every further attempt is one cap apart, indefinitely.
    await vi.advanceTimersByTimeAsync(4_000 * 10);
    expect(provider.connectCalls).toBe(13);
    expect(supervisor.status().connected).toBe(false);
    expect(supervisor.status().attempts).toBe(13);

    // The node comes back 74 minutes in. Nothing restarts; the next scheduled
    // attempt finds it.
    provider.nodeUp = true;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(supervisor.status().connected).toBe(true);
    expect(supervisor.status().downtimeMs).toBeNull();

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
    // Three reported drops, one socket: one reconnect, not three racing ones.
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
 * A websocket server that completes the handshake and nothing else.
 *
 * Enough for `WsProvider` to open, report `connected`, and — when the sockets
 * are destroyed under it — report the abnormal 1006 close that started this
 * issue. No RPC is served because none is needed: the reconnect path is below
 * the RPC layer.
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

/** Resolves once `predicate` holds, or fails the wait — never sleeps a guess. */
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
    const port = await node.listen(0);
    const endpoint = `ws://127.0.0.1:${port}`;

    // autoConnect off: reconnection is the supervisor's job, and two retry
    // loops on one socket race each other.
    const provider = new WsProvider(endpoint, false);
    const logger = recordingLogger();
    const supervisor = new ConnectionSupervisor({
      provider,
      endpoint,
      // Real timers here, so keep the backoff short.
      policy: { initialDelayMs: 20, maxDelayMs: 100, factor: 2 },
      logger,
    });

    try {
      await provider.connect();
      await until(() => supervisor.status().connected);

      // The node goes away exactly as Alice did: no close frame, code 1006.
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

      // Nothing restarts the faucet. The supervisor keeps trying, and the
      // socket comes back on its own.
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

const CHAIN_INFO: ChainInfo = {
  chain: 'Scalar Commons Local Testnet',
  specName: 'scalar-commons',
  specVersion: 305,
  tokenSymbol: 'CMN',
  tokenDecimals: 12,
  ss58Format: 42,
};

const FAUCET_ADDRESS = '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL';

/**
 * A chain client whose socket can be dropped, wired the way the live one is:
 * every chain read fails with the polkadot-js message while it is down.
 */
function fakeChain(): ChainClient & { setConnected: (connected: boolean) => void } {
  let connected = true;
  let downSince: number | null = null;
  let attempts = 0;

  const requireSocket = () => {
    if (!connected) {
      throw new Error('WebSocket is not connected\nFailed WS Request: {"method":"state_getStorage"}');
    }
  };

  return {
    faucetAddress: FAUCET_ADDRESS,
    chainInfo: () => CHAIN_INFO,
    existentialDeposit: () => 10_000_000_000n,
    async freeBalance(): Promise<bigint> {
      requireSocket();
      return 500n * PLANCKS_PER_CMN;
    },
    async transfer(): Promise<TransferReceipt> {
      requireSocket();
      return { blockHash: `0x${'11'.repeat(32)}`, txHash: `0x${'22'.repeat(32)}` };
    },
    connection: (): ConnectionStatus => ({
      endpoint: ENDPOINT,
      connected,
      downtimeMs: downSince === null ? null : Math.max(0, Date.now() - downSince),
      attempts,
      lastError: connected ? null : ABNORMAL_CLOSURE,
    }),
    async disconnect(): Promise<void> {
      /* nothing to close */
    },
    setConnected(next: boolean): void {
      connected = next;
      downSince = next ? null : Date.now();
      attempts = next ? 0 : 12;
    },
  };
}

async function httpHarness() {
  const chain = fakeChain();
  const faucet = new FaucetService({
    chain,
    limiter: new SlidingWindowRateLimiter({
      perAddress: { maxRequests: 1, windowMs: 3_600_000 },
      perIp: { maxRequests: 10, windowMs: 3_600_000 },
    }),
    dripAmountPlancks: PLANCKS_PER_CMN,
  });
  const server: Server = createFaucetServer({ faucet });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    chain,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('GET /health while the node socket is down', () => {
  it('answers 503 naming the reason, not 500', async () => {
    const h = await httpHarness();
    try {
      const healthy = await fetch(`${h.url}/health`);
      expect(healthy.status).toBe(200);

      h.chain.setConnected(false);

      const response = await fetch(`${h.url}/health`);
      const body = (await response.json()) as Record<string, unknown>;

      // The whole point of the issue: 500 says "the faucet is broken", which
      // is what every monitor and load balancer read for 74 minutes. 503 says
      // "the faucet is waiting for its node".
      expect(response.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.code).toBe('CHAIN_DISCONNECTED');
      // The reason has to be in the body, not just in the status code.
      expect(String(body.error)).toContain(ENDPOINT);
      const connection = body.connection as Record<string, unknown>;
      expect(connection.connected).toBe(false);
      expect(String(connection.lastError)).toContain('1006');
      // Retryable, and it says so.
      expect(response.headers.get('retry-after')).toBeTruthy();
    } finally {
      await h.close();
    }
  });

  it('reports the chain it is waiting for, so a monitor can tell which one', async () => {
    const h = await httpHarness();
    try {
      h.chain.setConnected(false);
      const body = (await (await fetch(`${h.url}/health`)).json()) as Record<string, unknown>;
      expect(body.chain).toBe(CHAIN_INFO.chain);
      expect(body.specVersion).toBe(CHAIN_INFO.specVersion);
      expect(body.faucetAddress).toBe(FAUCET_ADDRESS);
    } finally {
      await h.close();
    }
  });

  it('goes back to 200 once the socket is back, with no restart in between', async () => {
    const h = await httpHarness();
    try {
      h.chain.setConnected(false);
      expect((await fetch(`${h.url}/health`)).status).toBe(503);

      h.chain.setConnected(true);

      const response = await fetch(`${h.url}/health`);
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect((body.connection as Record<string, unknown>).connected).toBe(true);
    } finally {
      await h.close();
    }
  });

  it('answers a chain-backed route with 503 too, rather than a bare 500', async () => {
    const h = await httpHarness();
    try {
      h.chain.setConnected(false);
      const response = await fetch(`${h.url}/balance/${FAUCET_ADDRESS}`);
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(503);
      expect(body.code).toBe('CHAIN_DISCONNECTED');
    } finally {
      await h.close();
    }
  });
});
