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

export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'block'; readonly ref: BlockRef }
  | { readonly kind: 'extrinsic'; readonly ref: BlockRef; readonly index: number }
  | { readonly kind: 'account'; readonly address: string }
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

  if (head === 'block' && segments.length === 2 && first !== undefined) {
    const ref = parseBlockRef(decodeURIComponent(first));
    return ref
      ? { kind: 'block', ref }
      : { kind: 'badRequest', message: `not a block number or block hash: ${decodeURIComponent(first)}` };
  }

  if (head === 'extrinsic' && segments.length === 3 && first !== undefined && second !== undefined) {
    const ref = parseBlockRef(decodeURIComponent(first));
    if (!ref) {
      return {
        kind: 'badRequest',
        message: `not a block number or block hash: ${decodeURIComponent(first)}`,
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

/** Renders a block reference back into its URL segment. */
export function blockRefSegment(ref: BlockRef): string {
  switch (ref.kind) {
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
