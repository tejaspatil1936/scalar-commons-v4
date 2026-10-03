/**
 * Reconnection for the node websocket, and the state a degraded service reports.
 *
 * Why this exists: on 2026-09-09 the validator was restarted at 12:59:48 and all
 * three services — faucet, indexer, explorer — held a socket that closed with
 * `1006:: Abnormal Closure` and never came back. Seventy-four minutes later
 * every chain-backed route was still answering an error, the node was healthy on
 * loopback, and `systemctl` reported all three units `active (running)`. Only a
 * manual restart fixed it. A coordination substrate whose public API needs a
 * human after every node restart is not infrastructure, so recovery is owned
 * here rather than left to whatever the transport happens to do.
 *
 * Three decisions worth stating:
 *
 * - **The supervisor drives reconnection, and `WsProvider`'s own auto-connect is
 *   switched off.** Two retry loops on one socket race each other: one calls
 *   `connect()` while the other's socket is half-open, and the loser throws
 *   `WebSocket is already connected`. One owner, one timer.
 * - **Backoff is capped, not unbounded.** The outage lasted 74 minutes and the
 *   node came back on its own; a delay that keeps doubling would have been an
 *   hour out by then. Capping at 30s bounds how long recovery lags the node
 *   while keeping a long outage cheap.
 * - **A failed attempt has to be cleaned up before the next one**, because the
 *   transport does not do it. See {@link releaseStuckSocket}: this is why the
 *   provider's own retry loop could not have recovered either, and therefore why
 *   the outage lasted until a human intervened.
 *
 * This module deliberately imports nothing. Each of the three services is an
 * independently installed npm package with its own `node_modules` and its own
 * build, so the same supervisor is carried by each of them rather than shared
 * through a fourth package they would all have to resolve at runtime; keeping it
 * dependency-free is what keeps those copies interchangeable.
 */

/** How the retry delay grows while the node is away. */
export interface ReconnectPolicy {
  /** Delay before the first retry. */
  readonly initialDelayMs: number;
  /** Ceiling for the delay: a long outage still gets retried this often. */
  readonly maxDelayMs: number;
  /** Multiplier applied per attempt. */
  readonly factor: number;
  /**
   * How long a connect attempt may be in flight before it is assumed to have
   * hung.
   *
   * Deliberately *not* the backoff cap. The retry interval answers "how often
   * should we try a node that is down"; this answers "how long can a handshake
   * legitimately take", and they have no reason to agree. Tying them together
   * means any node whose handshake outlasts the retry interval has every
   * attempt killed a fraction of the way through and a new one started — a
   * livelock against a node that is merely slow, which is a worse failure than
   * the outage being recovered from. Generous on purpose: the cost of waiting
   * too long is a late recovery, the cost of waiting too little is no recovery.
   */
  readonly handshakeTimeoutMs: number;
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  factor: 2,
  handshakeTimeoutMs: 30_000,
};

/**
 * Delay before reconnect attempt `attempt` (1-based).
 *
 * Always at least 1ms: a zero delay would turn an outage into a busy loop that
 * spins a core and floods the journal, which is a worse failure than the one
 * being recovered from.
 */
export function backoffDelayMs(attempt: number, policy: Partial<ReconnectPolicy> = {}): number {
  const { initialDelayMs, maxDelayMs, factor } = { ...DEFAULT_RECONNECT_POLICY, ...policy };
  const exponent = Math.max(0, attempt - 1);
  // `Math.min` also pins the overflow to `Infinity` that a very long outage
  // reaches after ~1000 attempts back onto the cap.
  return Math.max(1, Math.min(initialDelayMs * factor ** exponent, maxDelayMs));
}

/**
 * The part of `WsProvider` the supervisor drives.
 *
 * Narrow on purpose: the supervisor needs to know whether the socket is up, to
 * hear when that changes, and to be able to ask for a new one. Everything else
 * about the provider is the caller's business, and a narrow shape is one a test
 * can stand in for.
 */
export interface ReconnectableProvider {
  readonly isConnected: boolean;
  on(type: 'connected' | 'disconnected' | 'error', handler: (value?: unknown) => unknown): () => void;
  connect(): Promise<void>;
}

/** What a service reports about its node socket while it is degraded. */
export interface ConnectionStatus {
  readonly endpoint: string;
  readonly connected: boolean;
  /** How long the socket has been down, or null while it is up. */
  readonly downtimeMs: number | null;
  /** Reconnect attempts made during the current outage; 0 while connected. */
  readonly attempts: number;
  /** The last transport error seen, when the provider reported one. */
  readonly lastError: string | null;
}

/**
 * A sentence naming what a degraded service is waiting for, for the 503 body.
 *
 * The status code says "come back later"; this says what we are waiting for and
 * for how long, which is the part an operator reading a monitor needs. A body
 * that only repeated "WebSocket is not connected" is what made the 2026-09-09
 * outage read as a faucet bug.
 */
export function unavailableReason(status: ConnectionStatus): string {
  const parts = [`no connection to the node at ${status.endpoint}`];
  if (status.downtimeMs !== null) {
    parts.push(`down for ${Math.round(status.downtimeMs / 1000)}s`);
  }
  parts.push(`${status.attempts} reconnect attempt(s) so far`);
  return `${parts.join(', ')}${status.lastError === null ? '' : `: ${status.lastError}`}`;
}

export interface ConnectionSupervisorOptions {
  readonly provider: ReconnectableProvider;
  /** The endpoint, for the log lines and for the status body. */
  readonly endpoint: string;
  readonly policy?: Partial<ReconnectPolicy>;
  readonly logger?: Pick<Console, 'log' | 'error'>;
  /** Prefix carried by every log line, so it matches the service's other output. */
  readonly label?: string;
}

function messageOf(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  // Node's built-in WebSocket reports failures as an `ErrorEvent`, which is not
  // an `Error` but does carry the message worth reporting.
  if (typeof value === 'object' && value !== null) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return 'the websocket closed without a reason';
}

/** `WebSocket.OPEN`, without needing the global to be present. */
const WEBSOCKET_OPEN = 1;

/**
 * Frees a `WsProvider` that a *failed* connect attempt left unusable.
 *
 * This is the bug behind issue #155, and it is worth spelling out because it
 * makes the outage inevitable rather than unlucky.
 *
 * `WsProvider.connect()` refuses to run while it still holds a socket:
 *
 *     if (this.__internal__websocket) throw new Error('WebSocket is already connected')
 *
 * and it clears that field only from the socket's `close` handler. On Node 22 the
 * socket is Node's own global `WebSocket` (undici), and a connection that never
 * completes its handshake — a node that is still restarting, so the TCP connect
 * is refused — fires `error` and **never** fires `close`. The socket is left in
 * `CONNECTING` forever, so every later `connect()` throws
 * `WebSocket is already connected`, and `disconnect()` does not help: it closes
 * the socket it holds, which fires no `close` either.
 *
 * The consequence is that the *first* reconnect attempt against a node that is
 * still down permanently disables the provider. That is exactly what journald
 * shows on 2026-09-09: one `1006:: Abnormal Closure` line at 12:59:48, then
 * nothing, for 74 minutes, until the units were restarted by hand — the
 * transport's own retry loop had wedged itself on its first try.
 *
 * So a dead socket is detached through the public `WebSocket` surface (its
 * handlers are cleared and it is closed, so a late `open` cannot resurrect it)
 * and the provider's reference to it is dropped, which is the one thing that
 * cannot be done through a public API. Returns whether it had to do anything, so
 * the caller can say so once per outage instead of on every retry.
 */
export function releaseStuckSocket(provider: ReconnectableProvider): boolean {
  const holder = provider as unknown as {
    __internal__websocket?: {
      readyState?: number;
      close?: () => void;
      onopen?: unknown;
      onclose?: unknown;
      onerror?: unknown;
      onmessage?: unknown;
    } | null;
  };
  const socket = holder.__internal__websocket;
  if (socket === null || socket === undefined || socket.readyState === WEBSOCKET_OPEN) {
    // Nothing held, or a socket that is genuinely open: not ours to discard.
    return false;
  }

  socket.onopen = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  try {
    socket.close?.();
  } catch {
    // A socket that cannot even be closed is exactly the one being discarded.
  }
  holder.__internal__websocket = null;
  return true;
}

/**
 * Keeps one provider connected, and answers "is the node there?" for HTTP.
 *
 * Both halves matter. Reconnecting without reporting the gap would let a service
 * answer from a socket it does not have; reporting without reconnecting is the
 * outage this replaces.
 */
export class ConnectionSupervisor {
  private readonly provider: ReconnectableProvider;
  private readonly endpoint: string;
  private readonly policy: Partial<ReconnectPolicy>;
  private readonly logger: Pick<Console, 'log' | 'error'>;
  private readonly label: string;
  private readonly unsubscribers: (() => void)[] = [];

  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The handshake deadline, held apart from the retry timer on purpose.
   *
   * If one timer served both, the deadline armed when `connect()` resolves
   * would occupy the slot, and the transport's own `error` — which a real
   * `WsProvider` reports *after* `connect()` has resolved — would find a timer
   * already set and schedule nothing. Every retry would then land on the
   * deadline rather than on the backoff, and the ramp would be dead.
   */
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private connected: boolean;
  private downSince: number | null = null;
  private attempts = 0;
  private lastError: string | null = null;
  private stopped = false;
  private reportedStuckSocket = false;

  constructor(options: ConnectionSupervisorOptions) {
    this.provider = options.provider;
    this.endpoint = options.endpoint;
    this.policy = options.policy ?? {};
    this.logger = options.logger ?? console;
    this.label = options.label ?? '[chain]';
    this.connected = options.provider.isConnected;

    this.unsubscribers.push(
      this.provider.on('connected', () => this.onConnected()),
      this.provider.on('disconnected', () => this.onDisconnected()),
      this.provider.on('error', (error) => this.onError(error)),
    );

    // A socket that was already down when we attached will never announce
    // itself: `disconnected` and `error` both fired before these handlers
    // existed. Every service attaches the supervisor only once its API is
    // ready, so a drop during that window — `ApiPromise.create`, the metadata
    // reads — would otherwise leave the process permanently down with no retry
    // scheduled, nothing in the journal, and a status body claiming a null
    // downtime and zero attempts. Reconciling the initial state is what makes
    // the startup window recoverable rather than a second way to need a human.
    if (!this.connected) {
      // Said differently from a loss this supervisor watched happen: it did not
      // see this socket close and must not claim it did. An operator reading
      // the journal needs to know the difference between "the node went away"
      // and "the node was already away when we started looking".
      this.markDown(
        `${this.label} found the node at ${this.endpoint} already down ` +
          `(no socket was open when supervision began)`,
      );
    }
  }

  /** Whether the socket is up right now. */
  get isConnected(): boolean {
    return this.connected;
  }

  status(): ConnectionStatus {
    return {
      endpoint: this.endpoint,
      connected: this.connected,
      downtimeMs: this.downSince === null ? null : Math.max(0, Date.now() - this.downSince),
      attempts: this.attempts,
      lastError: this.lastError,
    };
  }

  /** Stops supervising. Called on shutdown, so a close is not fought with a retry. */
  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.clearDeadline();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  private onConnected(): void {
    if (this.stopped || this.connected) {
      return;
    }
    this.clearTimer();
    this.clearDeadline();
    const downtimeMs = this.downSince === null ? null : Date.now() - this.downSince;
    const attempts = this.attempts;

    this.connected = true;
    this.downSince = null;
    this.attempts = 0;
    this.lastError = null;
    this.reportedStuckSocket = false;

    // Only an actual recovery is logged. The first connect of a process is the
    // service's own startup line, and duplicating it would make a restart read
    // like a reconnection in the journal.
    if (downtimeMs !== null) {
      this.logger.log(
        `${this.label} reconnected to ${this.endpoint} after ${Math.round(downtimeMs / 1000)}s ` +
          `and ${attempts} attempt(s)`,
      );
    }
  }

  private onDisconnected(): void {
    if (this.stopped) {
      return;
    }
    this.markDown(
      `${this.label} lost the connection to ${this.endpoint}: ${this.lastError ?? 'socket closed'}`,
    );
  }

  /**
   * Records that the node is away, and starts trying to get it back.
   *
   * Shared by the `disconnected` handler and the constructor, because a socket
   * found already down is in the same state as one seen closing: both owe the
   * status body a downtime and the journal a line, and both need a retry armed.
   * They do not owe the journal the *same* line, so the caller supplies it.
   */
  private markDown(message: string): void {
    this.connected = false;
    if (this.downSince === null) {
      this.downSince = Date.now();
      // Logged at error level, and only once per outage: this is the line the
      // 2026-09-09 report was reconstructed from, and it has to be findable
      // without being repeated for every retry.
      this.logger.error(message);
    }
    this.scheduleReconnect();
  }

  private onError(error: unknown): void {
    this.lastError = messageOf(error);
    if (this.stopped || this.connected) {
      return;
    }
    // A failed *attempt* reports `error` and nothing else — there is no socket
    // to close, so no `disconnected` follows it. Without rescheduling here the
    // retry chain would stop after the first attempt that found the node still
    // down, which is the original bug wearing a different hat.
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer !== null || this.connected) {
      return;
    }
    // A retry is now scheduled on the backoff, so a deadline still counting
    // down on the attempt that just failed has nothing left to guard.
    this.clearDeadline();
    const attempt = this.attempts + 1;
    const delayMs = backoffDelayMs(attempt, this.policy);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.attempts = attempt;
      void this.attemptConnect();
    }, delayMs);
    // Do not hold the event loop open on our own: the HTTP listener is what
    // keeps a degraded service alive, and a reconnect timer that outlives it
    // would keep a shutting-down process from exiting.
    this.timer.unref?.();
  }

  private async attemptConnect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.provider.isConnected) {
      // The transport came back without us hearing about it; take the state
      // from the socket rather than reporting a down node that is up.
      this.onConnected();
      return;
    }
    // Without this the second attempt of every outage throws
    // `WebSocket is already connected` and never recovers. Reported once per
    // outage: an operator should be able to see that it is happening, and a
    // line per retry for 74 minutes is not a report, it is noise.
    if (releaseStuckSocket(this.provider) && !this.reportedStuckSocket) {
      this.reportedStuckSocket = true;
      this.logger.log(
        `${this.label} discarded a socket the failed attempt left half-open ` +
          `(it would otherwise block every reconnect to ${this.endpoint})`,
      );
    }
    try {
      await this.provider.connect();
    } catch (error) {
      this.lastError = messageOf(error);
      this.scheduleReconnect();
      return;
    }
    // `connect()` resolves when the socket is *created*, not when it opens, so
    // an attempt can return having achieved nothing. A node whose listener is
    // up before its RPC server is — mid-restart, exactly the case this module
    // exists for — leaves the handshake hanging, and Node's WebSocket then
    // fires neither `error` nor `close`. With no event to re-arm from, the
    // retry chain would end on that attempt and the service would stay down
    // until a human restarted it. Arming a deadline is what closes that.
    if (!this.connected) {
      this.armHandshakeDeadline();
    }
  }

  /**
   * Gives the attempt in flight a bounded time to open, and retries if it does
   * not.
   *
   * Skipped when a retry is already scheduled: the transport reported the
   * failure itself, which is better evidence than a timeout, and the backoff is
   * where that retry belongs.
   */
  private armHandshakeDeadline(): void {
    if (this.stopped || this.connected || this.deadlineTimer !== null || this.timer !== null) {
      return;
    }
    const { handshakeTimeoutMs } = { ...DEFAULT_RECONNECT_POLICY, ...this.policy };
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      if (!this.connected) {
        this.scheduleReconnect();
      }
    }, handshakeTimeoutMs);
    this.deadlineTimer.unref?.();
  }

  private clearDeadline(): void {
    if (this.deadlineTimer !== null) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
