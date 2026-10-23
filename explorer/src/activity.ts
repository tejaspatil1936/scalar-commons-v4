/**
 * The indexer, read for lists.
 *
 * Every single item in the explorer is decoded from the node at request time,
 * and each costs a bounded handful of node reads. A list — the newest blocks
 * with their counts, everything agents did, what one account signed — is a
 * question about history, and answering it from a node means walking blocks:
 * an unbounded amount of validator work per page view. The indexer already
 * holds that history and already pages it (`?limit=&offset=`), so every list
 * on these pages is one indexer request for exactly one page, never a scan.
 *
 * What the explorer adds is the part only a metadata-aware reader can: the
 * indexer serves event fields as plain JSON, and the explorer types each field
 * from its own connection's runtime metadata, so an account renders as a link
 * and a balance renders in tokens because the runtime says so.
 *
 * Failures carry two messages: `message` for the log (the URL, the status, the
 * cause) and `publicMessage` for the page, which never names an internal
 * address: "The indexer did not answer in time." is the whole message.
 */

import type { ActivityEntry, ActivityField, ActivityView, AgentRecord, BlockRow, HistoryEntry, ListPage } from './types.js';

/** Rows per page on every paginated list (§5.5). */
export const ACTIVITY_PAGE_SIZE = 25;
/** Rows in each of the home page's two lists. */
export const HOME_ROWS = 10;

const DEFAULT_TIMEOUT_MS = 10_000;

/** The indexer did not answer, timed out, or answered with an error status. Rendered as 502. */
export class IndexerUnavailableError extends Error {
  /** The sentence the page shows; no URL, no status, no stack. */
  readonly publicMessage: string;
  readonly status: number | null;

  constructor(message: string, publicMessage: string, status: number | null = null) {
    super(message);
    this.name = 'IndexerUnavailableError';
    this.publicMessage = publicMessage;
    this.status = status;
  }
}

/** The indexer answered 404: the thing asked for is not in the index. */
export class IndexerNotFoundError extends IndexerUnavailableError {
  constructor(message: string) {
    super(message, 'The indexer holds nothing for that.', 404);
    this.name = 'IndexerNotFoundError';
  }
}

/** The indexer answered 200 with something that is not what was asked for. Rendered as 502. */
export class IndexerResponseError extends Error {
  readonly publicMessage = 'The indexer answered in a shape this page does not understand.';

  constructor(message: string) {
    super(`the indexer's answer did not have the expected shape: ${message}`);
    this.name = 'IndexerResponseError';
  }
}

export interface IndexerClientOptions {
  /** The indexer's origin, e.g. `https://api.scalarnet.io` (a trailing `/v1` is tolerated and dropped). */
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}

/**
 * A plain GET of one indexer path, as JSON. Every list and record the pages
 * read goes through it; a failure is one `Read` with a public reason, never
 * a 502 for the page unless the list is the page.
 */
export interface IndexerReader {
  getJson(path: string): Promise<unknown>;
  readonly baseUrl: string;
}

export function createIndexerReader(options: IndexerClientOptions): IndexerReader {
  const base = options.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    baseUrl: base,
    async getJson(path: string): Promise<unknown> {
      let response: Response;
      try {
        response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || /timeout|aborted/i.test(cause));
        throw new IndexerUnavailableError(
          `the indexer at ${base} did not answer ${path}: ${cause}`,
          timedOut ? 'The indexer did not answer in time.' : 'The indexer did not answer.',
        );
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const reason =
          body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
            ? (body as { error: string }).error
            : `HTTP ${response.status}`;
        if (response.status === 404) throw new IndexerNotFoundError(`the indexer at ${base} answered 404 for ${path}: ${reason}`);
        throw new IndexerUnavailableError(`the indexer at ${base} answered ${response.status} for ${path}: ${reason}`, 'The indexer answered with an error.', response.status);
      }
      return body;
    },
  };
}

/** Field name → metadata type name, for one event; null when the runtime does not know the event. */
export type EventFieldTypes = (section: string, method: string) => ReadonlyMap<string, string> | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireInteger(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new IndexerResponseError(`${where}.${key} is not an integer`);
  }
  return value;
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new IndexerResponseError(`${where}.${key} is not a string`);
  }
  return value;
}

function optionalInteger(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** The `{ total, limit, offset, items }` envelope every list route shares. */
function requirePage(raw: unknown, where: string): { total: number; limit: number; offset: number; items: unknown[] } {
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new IndexerResponseError(`no items list in ${where}`);
  }
  return { total: requireInteger(raw, 'total', where), limit: requireInteger(raw, 'limit', where), offset: requireInteger(raw, 'offset', where), items: raw.items };
}

/**
 * Types one field from metadata.
 *
 * Only two types change how a value is shown: an account (a link) and a balance
 * (tokens, never raw plancks). A balance is only marked as one when its value is
 * the decimal string the indexer serves wide integers as; anything else is shown
 * as it came rather than coerced into a number it may not be.
 */
function typedField(name: string, value: unknown, typeName: string | undefined): ActivityField {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeName !== undefined && /AccountId/.test(typeName) && typeof value === 'string') {
    return { name, value: text, kind: 'account' };
  }
  if (typeName !== undefined && /Balance/.test(typeName) && /^\d+$/.test(text)) {
    return { name, value: text, kind: 'balance' };
  }
  return { name, value: text, kind: 'plain' };
}

/** The extrinsic index out of an indexer extrinsic id, `<block>-<index>`. */
function extrinsicIndexOf(raw: unknown, where: string): number | null {
  if (raw === null || raw === undefined) return null;
  const match = typeof raw === 'string' ? /^\d+-(\d+)$/.exec(raw) : null;
  if (match === null) {
    throw new IndexerResponseError(`${where}.extrinsicId is not a <block>-<index> id`);
  }
  return Number(match[1]);
}

/**
 * One event row as the feed shows it. `/v1/activity` rows carry `kind` and
 * `agents`; `/v1/agents/:address/events` and `/v1/events` rows carry
 * `accounts` and no kind. Both are the same event, so both shape to one entry.
 */
export function toActivityEntry(item: unknown, where: string, fieldTypes: EventFieldTypes): ActivityEntry {
  if (!isRecord(item)) throw new IndexerResponseError(`${where} is not an object`);
  const section = requireString(item, 'section', where);
  const method = requireString(item, 'method', where);
  const agents = item.agents ?? item.accounts;
  if (!Array.isArray(agents) || !agents.every((agent) => typeof agent === 'string')) {
    throw new IndexerResponseError(`${where}.agents is not a list of addresses`);
  }
  const timestamp = item.timestampMs;
  if (timestamp !== null && timestamp !== undefined && (typeof timestamp !== 'number' || !Number.isInteger(timestamp))) {
    throw new IndexerResponseError(`${where}.timestampMs is not an integer`);
  }
  const data = isRecord(item.data) ? item.data : {};
  const types = fieldTypes(section, method);
  return {
    id: requireString(item, 'id', where),
    blockNumber: requireInteger(item, 'blockNumber', where),
    extrinsicIndex: extrinsicIndexOf(item.extrinsicId, where),
    timestampMs: timestamp === null || timestamp === undefined ? null : BigInt(timestamp),
    kind: typeof item.kind === 'string' ? item.kind : null,
    section,
    method,
    agents: agents as string[],
    fields: Object.entries(data).map(([name, value]) => typedField(name, value, types?.get(name))),
  };
}

export interface ActivityQuery {
  readonly agent: string | null;
  readonly filter: string | null;
  readonly offset: number;
}

/**
 * Shapes an indexer page of events into the activity view.
 *
 * Strict about shape: an explorer that rendered a half-understood answer as a
 * feed would show a reader activity that is not what the index holds. Order is
 * kept exactly as the indexer served it — newest first is the indexer's
 * guarantee, and re-sorting here could only disagree with it.
 */
export function toActivityView(raw: unknown, fieldTypes: EventFieldTypes, query: ActivityQuery, readAt?: string): ActivityView {
  const page = requirePage(raw, 'feed');
  const record = raw as Record<string, unknown>;
  const historyFrom = record.historyFrom === null || record.historyFrom === undefined ? null : requireInteger(record, 'historyFrom', 'feed');
  const entries = page.items.map((item, position) => toActivityEntry(item, `items[${position}]`, fieldTypes));
  return { agent: query.agent, filter: query.filter, offset: query.offset, limit: page.limit, total: page.total, historyFrom, entries, ...(readAt ? { readAt } : {}) };
}

/** A page of events as a list page (the account page's Activity tab). */
export function toEventsPage(raw: unknown, fieldTypes: EventFieldTypes): ListPage<ActivityEntry> {
  const page = requirePage(raw, 'events');
  return { total: page.total, limit: page.limit, offset: page.offset, items: page.items.map((item, position) => toActivityEntry(item, `items[${position}]`, fieldTypes)) };
}

/** The indexer's `/v1/accounts/:address/extrinsics` page, shaped into history rows. */
export function toHistoryPage(raw: unknown): ListPage<HistoryEntry> {
  const page = requirePage(raw, '/v1/accounts/:address/extrinsics');
  const items = page.items.map((item, position): HistoryEntry => {
    const where = `items[${position}]`;
    if (!isRecord(item)) throw new IndexerResponseError(`${where} is not an object`);
    const timestamp = item.timestampMs;
    const success = item.success;
    return {
      blockNumber: requireInteger(item, 'blockNumber', where),
      index: requireInteger(item, 'index', where),
      hash: typeof item.hash === 'string' ? item.hash : null,
      section: requireString(item, 'section', where),
      method: requireString(item, 'method', where),
      timestampMs: typeof timestamp === 'number' && Number.isInteger(timestamp) ? BigInt(timestamp) : null,
      success: typeof success === 'boolean' ? success : null,
    };
  });
  return { total: page.total, limit: page.limit, offset: page.offset, items };
}

/** The indexer's `/v1/blocks` page, without authors (the node resolves those). */
export function toBlocksPage(raw: unknown): ListPage<Omit<BlockRow, 'author'>> {
  const page = requirePage(raw, '/v1/blocks');
  const items = page.items.map((item, position) => {
    const where = `items[${position}]`;
    if (!isRecord(item)) throw new IndexerResponseError(`${where} is not an object`);
    const timestamp = item.timestampMs;
    return {
      number: requireInteger(item, 'number', where),
      hash: requireString(item, 'hash', where),
      timestampMs: typeof timestamp === 'number' && Number.isInteger(timestamp) ? BigInt(timestamp) : null,
      extrinsicCount: requireInteger(item, 'extrinsicCount', where),
      eventCount: requireInteger(item, 'eventCount', where),
    };
  });
  return { total: page.total, limit: page.limit, offset: page.offset, items };
}

/** The indexer's `/v1/agents/:address` record, the fields the account page shows. */
export function toAgentRecord(raw: unknown): AgentRecord {
  if (!isRecord(raw)) throw new IndexerResponseError('/v1/agents/:address is not an object');
  const stake = wideInteger(raw, 'stakePlancks');
  if (stake === null) throw new IndexerResponseError('/v1/agents/:address carries no stakePlancks');
  const metadata = isRecord(raw.metadata) ? raw.metadata : null;
  return {
    name: metadata !== null && typeof metadata.name === 'string' && metadata.name !== '' ? metadata.name : null,
    stakePlancks: stake,
    registeredAtBlock: requireInteger(raw, 'registeredAtBlock', 'agent'),
    lastHeartbeatBlock: requireInteger(raw, 'lastHeartbeatBlock', 'agent'),
    unstakeAtBlock: optionalInteger(raw, 'unstakeAtBlock'),
    completedAgreements: optionalInteger(raw, 'completedAgreements') ?? 0,
    activeEscrowCount: optionalInteger(raw, 'activeEscrowCount') ?? 0,
  };
}

/** `/v1/agents?limit=1` → how many agents are registered (the envelope's total). */
export function toAgentsTotal(raw: unknown): number {
  return requirePage(raw, '/v1/agents').total;
}

/** `/v1/emissions` → the last era's emission and which era it was. */
export function toEmissions(raw: unknown): { lastEraEmission: bigint; lastSettledEra: number | null } {
  if (!isRecord(raw)) throw new IndexerResponseError('/v1/emissions is not an object');
  const emission = wideInteger(raw, 'lastEraEmissionPlancks');
  if (emission === null) throw new IndexerResponseError('/v1/emissions carries no lastEraEmissionPlancks');
  return { lastEraEmission: emission, lastSettledEra: optionalInteger(raw, 'lastSettledEra') };
}

/** `/v1/status` → the indexer's synced height. */
export function toIndexerStatus(raw: unknown): { syncedHeight: number } {
  if (!isRecord(raw) || !isRecord(raw.indexer)) {
    throw new IndexerResponseError('no indexer block in /v1/status');
  }
  return { syncedHeight: requireInteger(raw.indexer, 'syncedHeight', 'status.indexer') };
}

/** A field of an indexer record read as a wide integer (the indexer serves balances as decimal strings), or null when absent. */
export function wideInteger(record: Record<string, unknown>, key: string): bigint | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/** The indexer path for one page of the activity feed, by the explorer's query. */
export function activityFeedPath(query: ActivityQuery, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit), offset: String(query.offset) });
  if (query.agent !== null) params.set('agent', query.agent);
  if (query.filter !== null) params.set('kind', query.filter);
  return `/v1/activity?${params.toString()}`;
}

/** The indexer path for one page of the events naming an agent (`/v1/agents/:address/events`). */
export function agentEventsPath(address: string, offset: number, limit: number): string {
  return `/v1/agents/${encodeURIComponent(address)}/events?limit=${limit}&offset=${offset}`;
}

/** The same page for an account that is not a registered agent (`/v1/events?account=`). */
export function accountEventsPath(address: string, offset: number, limit: number): string {
  return `/v1/events?account=${encodeURIComponent(address)}&limit=${limit}&offset=${offset}`;
}

export { isRecord };
