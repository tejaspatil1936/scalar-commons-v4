/**
 * URL parsing and link building.
 *
 * The explorer's navigation contract lives here: a block links to its
 * extrinsics, an extrinsic links to the accounts it touched, and an account
 * links back to the extrinsics that named it. Keeping both halves — parsing and
 * building — in one pure module is what lets a test prove those links actually
 * resolve, instead of proving that two hand-written strings happen to match.
 */

import { decodeAddress } from '@polkadot/util-crypto';

/** How a block was addressed in a URL. Numbers, hashes and the head all resolve. */
export type BlockRef =
  | { readonly kind: 'latest' }
  | { readonly kind: 'number'; readonly number: number }
  | { readonly kind: 'hash'; readonly hash: string };

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'block'; readonly ref: BlockRef }
  | { readonly kind: 'extrinsic'; readonly ref: BlockRef; readonly index: number }
  | { readonly kind: 'account'; readonly address: string }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'badRequest'; readonly message: string }
  | { readonly kind: 'notFound' };

const BLOCK_HASH = /^0x[0-9a-f]{64}$/i;
const BLOCK_NUMBER = /^\d+$/;

/**
 * Parses a block reference, or returns null.
 *
 * Deliberately strict: a partially-valid hash is a typo, and resolving it to
 * "something close" would show a visitor a block that is not the one they asked
 * for. Refusing is the honest answer.
 */
export function parseBlockRef(raw: string): BlockRef | null {
  if (raw === 'latest') {
    return { kind: 'latest' };
  }
  if (BLOCK_NUMBER.test(raw)) {
    const number = Number(raw);
    return Number.isSafeInteger(number) ? { kind: 'number', number } : null;
  }
  if (BLOCK_HASH.test(raw)) {
    return { kind: 'hash', hash: raw.toLowerCase() };
  }
  return null;
}

/** True when the string decodes as an SS58 address for any network. */
export function isAddress(raw: string): boolean {
  try {
    decodeAddress(raw);
    return true;
  } catch {
    return false;
  }
}

/** Maps a request URL onto a view. Unknown paths are 404; malformed ones are 400. */
export function parseRoute(url: string): Route {
  const parsed = new URL(url, 'http://explorer.invalid');
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { kind: 'home' };
  }

  const [head, first, second] = segments;

  if (head === 'search' && segments.length === 1) {
    return { kind: 'search', query: parsed.searchParams.get('q') ?? '' };
  }

  if (head === 'block' && segments.length === 2 && first !== undefined) {
    const ref = parseBlockRef(decodeURIComponent(first));
    return ref
      ? { kind: 'block', ref }
      : { kind: 'badRequest', message: `not a block number, block hash, or "latest": ${decodeURIComponent(first)}` };
  }

  if (head === 'extrinsic' && segments.length === 3 && first !== undefined && second !== undefined) {
    const ref = parseBlockRef(decodeURIComponent(first));
    if (!ref) {
      return {
        kind: 'badRequest',
        message: `not a block number, block hash, or "latest": ${decodeURIComponent(first)}`,
      };
    }
    if (!BLOCK_NUMBER.test(second)) {
      return { kind: 'badRequest', message: `not an extrinsic index: ${decodeURIComponent(second)}` };
    }
    return { kind: 'extrinsic', ref, index: Number(second) };
  }

  if (head === 'account' && segments.length === 2 && first !== undefined) {
    const address = decodeURIComponent(first);
    return isAddress(address)
      ? { kind: 'account', address }
      : { kind: 'badRequest', message: `not a valid SS58 account address: ${address}` };
  }

  return { kind: 'notFound' };
}

/**
 * Decides what a search box entry meant.
 *
 * The three things a visitor holds in hand are a block number, a hash, and an
 * address, and each has a distinguishable shape — so classification is by shape,
 * never by trying candidates against the node and taking whichever answers.
 */
export function classifySearch(query: string): Route {
  const trimmed = query.trim();
  const ref = parseBlockRef(trimmed);
  if (ref && trimmed !== 'latest') {
    return { kind: 'block', ref };
  }
  if (trimmed === 'latest') {
    return { kind: 'block', ref: { kind: 'latest' } };
  }
  if (isAddress(trimmed)) {
    return { kind: 'account', address: trimmed };
  }
  return {
    kind: 'badRequest',
    message: `not a block number, block hash, or account address: ${trimmed}`,
  };
}

/** Renders a block reference back into its URL segment. */
export function blockRefSegment(ref: BlockRef): string {
  switch (ref.kind) {
    case 'latest':
      return 'latest';
    case 'number':
      return String(ref.number);
    case 'hash':
      return ref.hash;
  }
}

export function blockPath(ref: BlockRef): string {
  return `/block/${blockRefSegment(ref)}`;
}

export function extrinsicPath(ref: BlockRef, index: number): string {
  return `/extrinsic/${blockRefSegment(ref)}/${index}`;
}

export function accountPath(address: string): string {
  return `/account/${address}`;
}
