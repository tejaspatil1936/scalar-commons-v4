// The data layer for /network: one WebSocket to the public node, one poller
// for the indexer, and the list of everything the page reads.
//
// Three rules hold for every figure on the page, and they are enforced here
// rather than in each section:
//
//   1. Every response is wrapped in a record carrying where it came from and
//      the UTC instant of the read, so the sources table at the foot of the
//      page can say when each figure was last read.
//   2. A failed request is a record with `ok: false` and the plain reason. It
//      is handed to the section the same way a success is; the section keeps
//      its last value, marks the figure Stale and the page shows the reason.
//   3. `field()` throws on a missing key instead of defaulting, so a response
//      whose shape moved becomes a failed read, never a zero.
//
// Everything pauses while the tab is hidden.

import { storageKey } from './scale.js';

export const API_ORIGIN = 'https://api.scalarnet.io';
export const RPC_URL = 'wss://rpc.scalarnet.io';
export const EXPLORER_ORIGIN = 'https://explorer.scalarnet.io';

/** The indexer's `MAX_LIMIT` (indexer/src/pagination.ts). */
export const INDEXER_MAX_LIMIT = 200;
export const FETCH_TIMEOUT_MS = 8_000;
/** A read that failed is tried again after this long, whatever its interval, so a figure is not Stale for a minute longer than it must be. */
export const RETRY_MS = 12_000;
/** Rows the recent-blocks table shows. */
export const BLOCK_ROWS = 12;
/** Blocks the validators' "blocks authored" column counts over. */
export const BLOCK_WINDOW = 48;
/** Rows the activity table shows. */
export const ACTIVITY_ROWS = 25;
/** Rows the agents table shows. */
export const AGENT_ROWS = 10;

/** The plain storage values read raw off the node, located by their names (see scale.js). */
export const STORAGE_KEYS = {
  sessionValidators: storageKey('Session', 'Validators'),
  sessionQueuedKeys: storageKey('Session', 'QueuedKeys'),
  babeAuthorities: storageKey('Babe', 'Authorities'),
  stakingValidatorCount: storageKey('Staking', 'ValidatorCount'),
};

/** `reads: 'live'` is chain state the indexer reads off the node for the request; `'index'` is its own finalized-block index. */
const rpc = (method, params, label) => ({ kind: 'rpc', method, params, label, reads: 'live' });
const api = (path, reads = 'index') => ({ kind: 'api', path, reads });
const events = (section, method, limit = INDEXER_MAX_LIMIT) => api(`/v1/events?section=${section}&method=${method}&limit=${limit}`);

/** Where each figure comes from. The sources table names these; the tests check every indexer path exists in indexer/src/api.ts. */
export const SOURCES = {
  // Pushed by the node.
  newHeads: { kind: 'subscription', method: 'chain_subscribeNewHeads', unsubscribe: 'chain_unsubscribeNewHeads', label: 'chain_subscribeNewHeads', reads: 'live' },
  finalizedHeads: { kind: 'subscription', method: 'chain_subscribeFinalizedHeads', unsubscribe: 'chain_unsubscribeFinalizedHeads', label: 'chain_subscribeFinalizedHeads', reads: 'live' },

  // The indexer.
  status: api('/v1/status', 'live'),
  era: api('/v1/eras/current', 'live'),
  escrowStats: api('/v1/escrows/stats', 'live'),
  supply: api('/v1/emissions/supply', 'live'),
  emissions: api('/v1/emissions', 'live'),
  agents: api(`/v1/agents?limit=${INDEXER_MAX_LIMIT}`, 'live'),
  blocks: api(`/v1/blocks?limit=${BLOCK_WINDOW}`),
  activity: api(`/v1/activity?limit=${ACTIVITY_ROWS}`),
  messagesSent: events('messages', 'MessageSent', 1),
  disputesOpened: events('escrow', 'DisputeOpened'),
  disputesResolved: events('escrow', 'DisputeResolved'),
  slashes: events('agents', 'SlashExecuted'),

  // The node, read raw and decoded in scale.js.
  validators: rpc('state_getStorage', [STORAGE_KEYS.sessionValidators], 'Session.Validators'),
  queuedKeys: rpc('state_getStorage', [STORAGE_KEYS.sessionQueuedKeys], 'Session.QueuedKeys'),
  babeAuthorities: rpc('state_getStorage', [STORAGE_KEYS.babeAuthorities], 'Babe.Authorities'),
  validatorCount: rpc('state_getStorage', [STORAGE_KEYS.stakingValidatorCount], 'Staking.ValidatorCount'),
};

/** The two reads made for a block as it arrives: its hash at a height, then the block by hash (extrinsics, timestamp). */
export const blockHashSource = (number) => rpc('chain_getBlockHash', [number], `chain_getBlockHash(${number})`);
export const blockSource = (hash) => rpc('chain_getBlock', [hash], 'chain_getBlock');
/** A header by hash: its BABE pre-digest names the block's author. */
export const headerSource = (hash) => rpc('chain_getHeader', [hash], 'chain_getHeader');

/** The activity feed, filtered to one kind (the indexer's `?kind=`), or all of it. */
export const activitySource = (kind) => api(`/v1/activity?limit=${ACTIVITY_ROWS}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`);

// ── pure helpers ─────────────────────────────────────────────────────────────

/** Reads a dotted path out of a response, refusing to guess at a missing one. */
export function field(value, path) {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || !(key in current)) {
      throw new Error(`response has no ${path}`);
    }
    current = current[key];
  }
  if (current === undefined || current === null) {
    throw new Error(`response has no ${path}`);
  }
  return current;
}

/** Counts newest-first events at or after `startBlock`; `reachedStart` says the list went past it. */
export function countSince(items, startBlock) {
  let count = 0;
  for (const item of items) {
    if (item.blockNumber < startBlock) return { count, reachedStart: true };
    count += 1;
  }
  return { count, reachedStart: false };
}

/** The same source, one page further on. */
export function pageOf(source, offset) {
  return `${source.path}&offset=${offset}`;
}

/** The plain name of a source: an indexer route or a node read. */
export function labelOf(source, path = source.path) {
  if (source.kind === 'api') return path.replace(/\?.*$/, '');
  return source.label;
}

/** The parts of a failed read's reason: which service (`where`), what was asked of it (`what`, null for the connection itself), and what went wrong. */
export function failureParts(record) {
  const error = record?.error ?? 'no answer';
  if (record?.source?.kind === 'socket') return { where: `the node (${RPC_URL})`, what: null, error };
  const where = record?.source?.kind === 'api' ? `the indexer (${API_ORIGIN}/v1)` : `the node (${RPC_URL})`;
  return { where, what: labelOf(record?.source ?? {}, record?.source?.path ?? ''), error };
}

/** "a", "a and b", "a, b and 3 more". */
const listOf = (items) => (items.length <= 1 ? items[0] ?? '' : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items[0]}, ${items[1]} and ${items.length - 2} more`);

/**
 * The plain sentences for a set of failed reads: one per service and reason,
 * naming what could not be read. `records` may hold many failures of one
 * service; a visitor reads one sentence for them.
 */
export function failureSentences(records) {
  const groups = new Map();
  for (const record of records) {
    const { where, what, error } = failureParts(record);
    const key = `${where}\u0000${error}`;
    const group = groups.get(key) ?? { where, error, whats: [] };
    if (what && !group.whats.includes(what)) group.whats.push(what);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ where, error, whats }) => (whats.length === 0 ? `Can't reach ${where}: ${error}.` : `Can't read ${listOf(whats)} from ${where}: ${error}.`));
}

/** The plain reason one failed record carries. */
export const failureReason = (record) => failureSentences([record])[0];

// ── HTTP ─────────────────────────────────────────────────────────────────────

/** One HTTP request as a record. Never throws; a failure is a record with `ok: false`. */
export async function fetchHttp(source, path = source.path) {
  const at = new Date();
  const url = `${API_ORIGIN}${path}`;
  const base = { at, label: labelOf(source, path), source };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: { accept: 'application/json' } });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ...base, ok: false, error: `HTTP ${response.status}, the answer is not JSON` };
    }
    if (!response.ok) {
      const detail = typeof data?.error === 'string' ? data.error : data?.message;
      return { ...base, ok: false, error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    return { ...base, ok: true, data };
  } catch (error) {
    // "Failed to fetch" is the browser's word for no connection at all (DNS, refused, offline, blocked).
    const reason = error.name === 'AbortError' ? `no answer within ${FETCH_TIMEOUT_MS / 1000} s` : error.name === 'TypeError' ? 'no connection' : error.message;
    return { ...base, ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every page of a list endpoint up to `maxPages`, concatenated newest-first.
 * `complete` says whether the whole list was read; `total` is the indexer's
 * own count of the list. A failed page is a failed record.
 */
export async function fetchAllPages(source, { maxPages = 5, fetcher = fetchHttp } = {}) {
  const items = [];
  let first = null;
  let total = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const record = await fetcher(source, page === 0 ? source.path : pageOf(source, items.length));
    first ??= record;
    if (!record.ok) return { ...record, items, complete: false };
    const pageItems = field(record.data, 'items');
    total = field(record.data, 'total');
    items.push(...pageItems);
    if (items.length >= total || pageItems.length === 0) {
      return { ...first, items, total, complete: true, pages: page + 1 };
    }
  }
  return { ...first, items, total, complete: false, pages: maxPages };
}

// ── the shared WebSocket ─────────────────────────────────────────────────────

/** A minimal event emitter. */
export class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        fn(payload);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

/**
 * One JSON-RPC WebSocket for the page: calls and subscriptions share it, it
 * re-subscribes after a reconnect, and it is closed while the tab is hidden.
 */
export class RpcSocket extends Emitter {
  constructor(url = RPC_URL, { WebSocketImpl = globalThis.WebSocket } = {}) {
    super();
    this.url = url;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.opening = null;
    this.state = 'idle';
    this.paused = false;
    this.attempts = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.subscriptions = new Map(); // local key -> { source, handler, remoteId }
    this.retryTimer = null;
    this.subscriptionCounter = 0;
  }

  setState(state, detail) {
    this.state = state;
    this.emit('state', { state, detail, attempts: this.attempts });
  }

  /** Opens the socket if needed; resolves once it is open. */
  connect() {
    if (this.socket && this.socket.readyState === 1) return Promise.resolve();
    if (this.opening) return this.opening;
    if (this.paused) return Promise.reject(new Error('socket paused while the tab is hidden'));
    this.setState('connecting');
    this.opening = new Promise((resolve, reject) => {
      let socket;
      try {
        socket = new this.WebSocketImpl(this.url);
      } catch (error) {
        this.opening = null;
        this.setState('failed', error.message);
        reject(error);
        return;
      }
      const timer = setTimeout(() => {
        socket.close();
        settle(new Error(`no connection within ${FETCH_TIMEOUT_MS / 1000} s`));
      }, FETCH_TIMEOUT_MS);
      let settled = false;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.opening = null;
        if (error) {
          this.setState('failed', error.message);
          reject(error);
        } else {
          this.attempts = 0;
          this.setState('open');
          resolve();
        }
      };
      socket.onopen = () => {
        this.socket = socket;
        settle(null);
        for (const [key, sub] of this.subscriptions) this.sendSubscribe(key, sub);
      };
      socket.onmessage = (event) => this.receive(String(event.data));
      socket.onerror = () => settle(new Error('the WebSocket connection failed'));
      socket.onclose = (event) => {
        // One wording for the connection and for the reads it took down, so the page says it once.
        const closed = `the connection closed (code ${event.code})`;
        settle(new Error(closed));
        if (this.socket === socket) this.socket = null;
        this.failPending(new Error(closed));
        for (const sub of this.subscriptions.values()) sub.remoteId = null;
        if (!this.paused) {
          this.setState('closed', closed);
          this.scheduleReconnect();
        }
      };
    });
    return this.opening;
  }

  scheduleReconnect() {
    if (this.retryTimer || this.paused) return;
    this.attempts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, this.attempts - 1));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  failPending(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(`RPC error ${message.error.code}: ${message.error.message}`));
      else resolve(message);
      return;
    }
    if (message.method && message.params && message.params.subscription !== undefined) {
      for (const sub of this.subscriptions.values()) {
        if (sub.remoteId === message.params.subscription) {
          sub.handler({ ok: true, at: new Date(), label: labelOf(sub.source), data: message.params.result, source: sub.source });
        }
      }
    }
  }

  send(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no answer within ${FETCH_TIMEOUT_MS / 1000} s`));
      }, FETCH_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, jsonrpc: '2.0', method, params }));
    return promise;
  }

  /** One JSON-RPC call, as a record. Never throws. */
  async call(source) {
    const at = new Date();
    const base = { at, label: labelOf(source), source };
    try {
      await this.connect();
      const { result } = await this.send(source.method, source.params);
      return { ...base, ok: true, data: result };
    } catch (error) {
      return { ...base, ok: false, error: error.message };
    }
  }

  sendSubscribe(key, sub) {
    if (!this.socket || this.socket.readyState !== 1 || sub.remoteId) return;
    this.send(sub.source.method, sub.source.params ?? [])
      .then(({ result }) => {
        if (this.subscriptions.get(key) === sub) sub.remoteId = result;
      })
      .catch((error) => this.emit('subscription-error', { source: sub.source, error }));
  }

  /** Subscribes; the handler receives one record per notification. Returns an unsubscribe. */
  subscribe(source, handler) {
    this.subscriptionCounter += 1;
    const key = this.subscriptionCounter;
    const sub = { source, handler, remoteId: null };
    this.subscriptions.set(key, sub);
    this.connect()
      .then(() => this.sendSubscribe(key, sub))
      .catch((error) => this.emit('subscription-error', { source, error }));
    return () => {
      this.subscriptions.delete(key);
      if (sub.remoteId && this.socket?.readyState === 1) {
        this.send(source.unsubscribe, [sub.remoteId]).catch(() => {});
      }
    };
  }

  /** Closes the socket without reconnecting; subscriptions resume on `resume()`. */
  pause() {
    this.paused = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close();
    this.setState('paused');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.attempts = 0;
    if (this.subscriptions.size > 0 || this.pending.size > 0) this.connect().catch(() => {});
  }
}

// ── polling ──────────────────────────────────────────────────────────────────

/**
 * Deduplicated polling: several sections may watch the same source, and it
 * is fetched once per interval and handed to all of them. Paused while the
 * tab is hidden; resumed with an immediate refresh.
 */
export class Scheduler {
  constructor(fetcher) {
    this.fetcher = fetcher;
    this.watches = new Map(); // name -> { source, handlers: Map<fn, interval>, timer, inFlight, latest }
    this.paused = false;
  }

  watch(name, source, handler, intervalMs) {
    let entry = this.watches.get(name);
    if (!entry) {
      entry = { source, handlers: new Map(), timer: null, inFlight: null, latest: null };
      this.watches.set(name, entry);
    }
    entry.handlers.set(handler, intervalMs);
    if (entry.latest) handler(entry.latest);
    if (!entry.inFlight && !entry.timer) this.run(name);
    return () => {
      entry.handlers.delete(handler);
      if (entry.handlers.size === 0) {
        clearTimeout(entry.timer);
        this.watches.delete(name);
      }
    };
  }

  /** The next read's delay: the shortest interval a watcher asked for, or RETRY_MS after a failed read. */
  interval(entry) {
    const asked = Math.min(...entry.handlers.values());
    return entry.latest && !entry.latest.ok ? Math.min(asked, RETRY_MS) : asked;
  }

  async run(name) {
    const entry = this.watches.get(name);
    if (!entry || this.paused) return;
    clearTimeout(entry.timer);
    entry.timer = null;
    const source = entry.source;
    entry.inFlight = this.fetcher(source);
    const record = await entry.inFlight;
    entry.inFlight = null;
    // The source was replaced while this read was in flight: its answer is for a question nobody asks now.
    if (entry.source !== source) {
      if (this.watches.get(name) === entry && !this.paused) this.run(name);
      return;
    }
    entry.latest = record;
    for (const handler of entry.handlers.keys()) {
      try {
        handler(record);
      } catch (error) {
        console.error(error);
      }
    }
    if (this.watches.get(name) === entry && !this.paused) {
      entry.timer = setTimeout(() => this.run(name), this.interval(entry));
    }
  }

  /** Re-fetches a source now, ahead of its interval. */
  refresh(name) {
    const entry = this.watches.get(name);
    if (entry && !entry.inFlight) this.run(name);
  }

  /** Replaces a watched source (a new filter, say) and re-fetches it now. */
  replace(name, source) {
    const entry = this.watches.get(name);
    if (!entry) return;
    entry.source = source;
    entry.latest = null;
    this.refresh(name);
  }

  latest(name) {
    return this.watches.get(name)?.latest ?? null;
  }

  pause() {
    this.paused = true;
    for (const entry of this.watches.values()) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const name of this.watches.keys()) this.run(name);
  }
}
