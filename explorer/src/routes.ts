/**
 * URL parsing and link building.
 *
 * The explorer's navigation contract lives here: a block links to its
 * extrinsics, and an extrinsic links to the accounts it touched. Keeping both
 * halves — parsing and building — in one pure module is what lets a test prove
 * those links actually resolve, instead of proving that two hand-written
 * strings happen to match.
 */

import { decodeAddress } from '@polkadot/util-crypto';

/** How a block was addressed in a URL. A block is named by its number or its hash. */
export type BlockRef =
  | { readonly kind: 'number'; readonly number: number }
  | { readonly kind: 'hash'; readonly hash: string };

/** The two tables a block page shows; the active one is in the URL (`?tab=`). */
export type BlockTab = 'extrinsics' | 'events';
/** The two tables an account page shows. */
export type AccountTab = 'extrinsics' | 'activity';

/** The activity families a `?kind=` may name (the indexer's). */
export const ACTIVITY_KINDS = ['message', 'registration', 'heartbeat', 'agreement', 'dispute', 'oracle_vote', 'slash'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'blocks'; readonly offset: number }
  | { readonly kind: 'block'; readonly ref: BlockRef; readonly tab: BlockTab }
  | { readonly kind: 'extrinsic'; readonly ref: BlockRef; readonly index: number }
  | { readonly kind: 'account'; readonly address: string; readonly tab: AccountTab; readonly offset: number }
  | { readonly kind: 'activity'; readonly agent: string | null; readonly filter: ActivityKind | null; readonly offset: number }
  /** The search field: resolved to the matching view by the server. */
  | { readonly kind: 'search'; readonly query: string }
  /** The chrome stylesheet, served at `/chrome.css`. */
  | { readonly kind: 'chrome' }
  /** The one shared behaviour (copy buttons), served at `/chrome.js`. */
  | { readonly kind: 'script' }
  /** The favicon, served at `/favicon.svg`. */
  | { readonly kind: 'favicon' }
  /** One of the two font files the stylesheet addresses as `fonts/<name>`. */
  | { readonly kind: 'font'; readonly name: string }
  | { readonly kind: 'badRequest'; readonly message: string }
  | { readonly kind: 'notFound' };

/** The font files the chrome's stylesheet addresses; anything else under `/fonts/` is 404. */
export const FONT_FILES: readonly string[] = ['inter-latin-wght-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2'];

export const SEARCH_PATH = '/search';
export const BLOCKS_PATH = '/blocks';
export const ACTIVITY_PATH = '/activity';

const BLOCK_HASH = /^0x[0-9a-f]{64}$/i;
const BLOCK_NUMBER = /^\d+$/;
/** An extrinsic as the indexer and the search field name it: `<block>-<index>`. */
const EXTRINSIC_ID = /^(\d+)-(\d+)$/;

/**
 * The largest value a block number can take.
 *
 * The runtime's `BlockNumber` is a `u32`. A larger value is not a block this
 * chain could ever have: rejecting it here is what keeps it out of polkadot-js
 * encoding, where it would throw and be reported as "the node did not answer"
 * — a 502 blaming the node for what is a client-side typo.
 */
const MAX_BLOCK_NUMBER = 0xffff_ffff;

/**
 * Percent-decodes one path segment, or returns null when it is not decodable.
 *
 * `decodeURIComponent` throws `URIError` on a malformed escape such as a lone
 * "%". That is a malformed request, so it has to become a 400 here rather than
 * escaping to the server's catch-all, which reports everything it catches as an
 * upstream node failure.
 */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The bad-request route for a segment that is not valid percent-encoding. */
function undecodable(segment: string): Route {
  return { kind: 'badRequest', message: `not a valid URL-encoded path segment: ${segment}` };
}

/**
 * Parses a block reference, or returns null.
 *
 * Deliberately strict: a partially-valid hash is a typo, and resolving it to
 * "something close" would show a visitor a block that is not the one they asked
 * for. Refusing is the honest answer.
 */
export function parseBlockRef(raw: string): BlockRef | null {
  if (BLOCK_NUMBER.test(raw)) {
    const number = Number(raw);
    return Number.isSafeInteger(number) && number <= MAX_BLOCK_NUMBER ? { kind: 'number', number } : null;
  }
  if (BLOCK_HASH.test(raw)) {
    return { kind: 'hash', hash: raw.toLowerCase() };
  }
  return null;
}

/** `<block>-<index>` → the pair, or null. */
export function parseExtrinsicId(raw: string): { number: number; index: number } | null {
  const match = EXTRINSIC_ID.exec(raw);
  if (match === null) return null;
  const number = Number(match[1]);
  const index = Number(match[2]);
  return Number.isSafeInteger(number) && number <= MAX_BLOCK_NUMBER && Number.isSafeInteger(index) ? { number, index } : null;
}

/**
 * True when the string decodes as a 32-byte account id: an SS58 address for
 * any network, or the 0x-prefixed public key. `decodeAddress` accepts any hex
 * string as raw bytes, so the length is checked here — "0xdead" is not an
 * account and must not be sent to the account page to fail there.
 */
export function isAddress(raw: string): boolean {
  try {
    return decodeAddress(raw).length === 32;
  } catch {
    return false;
  }
}

/**
 * The largest `?offset=` a list accepts.
 *
 * Past it there is no page a reader would click through to, and a bounded value
 * keeps a hand-typed offset from being forwarded to the indexer as a number it
 * has to reject.
 */
const MAX_OFFSET = 10_000_000;

/** Reads `?offset=`: 0 when absent, a bad request when it is not a bounded whole number. */
function parseOffset(params: URLSearchParams): number | Route {
  const raw = params.get('offset') ?? '0';
  const offset = Number(raw);
  if (!BLOCK_NUMBER.test(raw) || offset > MAX_OFFSET) {
    return { kind: 'badRequest', message: `not a page offset: ${raw}` };
  }
  return offset;
}

/** Maps a request URL onto a view. Unknown paths are 404; malformed ones are 400. */
export function parseRoute(url: string): Route {
  const parsed = new URL(url, 'http://explorer.invalid');
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { kind: 'home' };
  }

  const [head, first, second] = segments;

  if (head === 'activity' && segments.length === 1) {
    return parseActivity(parsed.searchParams);
  }

  if (head === 'blocks' && segments.length === 1) {
    const offset = parseOffset(parsed.searchParams);
    return typeof offset === 'number' ? { kind: 'blocks', offset } : offset;
  }

  if (head === 'search' && segments.length === 1) {
    return { kind: 'search', query: (parsed.searchParams.get('q') ?? '').trim() };
  }

  if (head === 'chrome.css' && segments.length === 1) {
    return { kind: 'chrome' };
  }
  if (head === 'chrome.js' && segments.length === 1) {
    return { kind: 'script' };
  }
  if (head === 'favicon.svg' && segments.length === 1) {
    return { kind: 'favicon' };
  }

  if (head === 'fonts' && segments.length === 2 && first !== undefined) {
    return FONT_FILES.includes(first) ? { kind: 'font', name: first } : { kind: 'notFound' };
  }

  if (head === 'block' && segments.length === 2 && first !== undefined) {
    const raw = decodeSegment(first);
    if (raw === null) {
      return undecodable(first);
    }
    const ref = parseBlockRef(raw);
    if (!ref) {
      return { kind: 'badRequest', message: `not a block number or block hash: ${raw}` };
    }
    const tab = parsed.searchParams.get('tab') ?? 'extrinsics';
    if (tab !== 'extrinsics' && tab !== 'events') {
      return { kind: 'badRequest', message: `not a block tab: ${tab}` };
    }
    return { kind: 'block', ref, tab };
  }

  if (head === 'extrinsic' && segments.length === 3 && first !== undefined && second !== undefined) {
    const raw = decodeSegment(first);
    if (raw === null) {
      return undecodable(first);
    }
    const rawIndex = decodeSegment(second);
    if (rawIndex === null) {
      return undecodable(second);
    }
    const ref = parseBlockRef(raw);
    if (!ref) {
      return { kind: 'badRequest', message: `not a block number or block hash: ${raw}` };
    }
    if (!BLOCK_NUMBER.test(rawIndex)) {
      return { kind: 'badRequest', message: `not an extrinsic index: ${rawIndex}` };
    }
    return { kind: 'extrinsic', ref, index: Number(rawIndex) };
  }

  if (head === 'account' && segments.length === 2 && first !== undefined) {
    const address = decodeSegment(first);
    if (address === null) {
      return undecodable(first);
    }
    if (!isAddress(address)) {
      return { kind: 'badRequest', message: `not a valid SS58 account address: ${address}` };
    }
    const tab = parsed.searchParams.get('tab') ?? 'extrinsics';
    if (tab !== 'extrinsics' && tab !== 'activity') {
      return { kind: 'badRequest', message: `not an account tab: ${tab}` };
    }
    const offset = parseOffset(parsed.searchParams);
    return typeof offset === 'number' ? { kind: 'account', address, tab, offset } : offset;
  }

  return { kind: 'notFound' };
}

/**
 * Reads the activity page's query: an optional agent, an optional kind and an
 * optional offset.
 *
 * `URLSearchParams` has already percent-decoded the values. An empty agent is
 * what the filter form submits when cleared, so it means "every agent"; a value
 * that is not an address is refused rather than forwarded, because an empty feed
 * for a typo would read as "this agent has done nothing".
 */
function parseActivity(params: URLSearchParams): Route {
  const rawAgent = (params.get('agent') ?? '').trim();
  if (rawAgent !== '' && !isAddress(rawAgent)) {
    return { kind: 'badRequest', message: `not a valid SS58 account address: ${rawAgent}` };
  }
  const rawKind = (params.get('kind') ?? '').trim();
  if (rawKind !== '' && !(ACTIVITY_KINDS as readonly string[]).includes(rawKind)) {
    return { kind: 'badRequest', message: `not an activity kind: ${rawKind}` };
  }
  const offset = parseOffset(params);
  if (typeof offset !== 'number') return offset;
  return { kind: 'activity', agent: rawAgent === '' ? null : rawAgent, filter: rawKind === '' ? null : (rawKind as ActivityKind), offset };
}

/** Renders a block reference back into its URL segment. */
export function blockRefSegment(ref: BlockRef): string {
  switch (ref.kind) {
    case 'number':
      return String(ref.number);
    case 'hash':
      return ref.hash;
  }
}

export function blockPath(ref: BlockRef, tab: BlockTab = 'extrinsics'): string {
  return `/block/${blockRefSegment(ref)}${tab === 'extrinsics' ? '' : `?tab=${tab}`}`;
}

export function blocksPath(offset = 0): string {
  return offset > 0 ? `${BLOCKS_PATH}?offset=${offset}` : BLOCKS_PATH;
}

export function extrinsicPath(ref: BlockRef, index: number): string {
  return `/extrinsic/${blockRefSegment(ref)}/${index}`;
}

export function accountPath(address: string, { tab = 'extrinsics', offset = 0 }: { tab?: AccountTab; offset?: number } = {}): string {
  const params = new URLSearchParams();
  if (tab !== 'extrinsics') params.set('tab', tab);
  if (offset > 0) params.set('offset', String(offset));
  const query = params.toString();
  return query === '' ? `/account/${address}` : `/account/${address}?${query}`;
}

/** The activity feed, optionally filtered to one agent or one kind and paged back from the newest. */
export function activityPath(agent: string | null = null, offset = 0, kind: ActivityKind | null = null): string {
  const params = new URLSearchParams();
  if (agent !== null) params.set('agent', agent);
  if (kind !== null) params.set('kind', kind);
  if (offset > 0) params.set('offset', String(offset));
  const query = params.toString();
  return query === '' ? ACTIVITY_PATH : `${ACTIVITY_PATH}?${query}`;
}

/** The search field's target: `GET /search?q=…`. */
export function searchPath(query: string): string {
  return `${SEARCH_PATH}?${new URLSearchParams({ q: query }).toString()}`;
}

/** The hash of an extrinsic or a block: 0x and 64 hex digits. */
export const HASH_64 = BLOCK_HASH;
