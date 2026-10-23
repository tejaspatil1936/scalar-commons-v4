/**
 * Presentation helpers.
 *
 * All of these are pure and total: they take values already decoded off chain
 * and turn them into strings. Nothing here reaches the network, so the rules
 * they encode (never print a raw planck count to a human, never trust a chain
 * string as markup, never more than two decimals in a table) are unit-testable
 * without a node.
 */

/**
 * Renders a planck amount in whole tokens at full precision.
 *
 * Balances are `u128` plancks; printing them raw is unreadable and printing them
 * through floating point is wrong (a genesis-scale balance exceeds 2^53). So the
 * split is done on the integer string: `decimals` comes from the chain's own
 * token properties rather than a constant, because a runtime is free to change
 * it and a hard-coded 12 would silently misprice every page. This is the value a
 * `title` carries; tables show {@link formatCmn}.
 */
export function formatBalance(plancks: bigint, decimals: number, symbol: string): string {
  const negative = plancks < 0n;
  const magnitude = negative ? -plancks : plancks;
  const divisor = 10n ** BigInt(decimals);
  const whole = magnitude / divisor;
  const fraction = magnitude % divisor;

  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fractionText = fraction === 0n ? '' : `.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;

  return `${negative ? '-' : ''}${groupedWhole}${fractionText} ${symbol}`;
}

/**
 * A planck amount with at most two decimals, for tables and stats (§6: money
 * never with more than 2 decimals in a table; the full value goes in `title`).
 * Rounded half up on the integer string, so no float is ever involved. An
 * amount that is not zero but rounds to 0.00 reads "<0.01", never "0.00":
 * a fee of a few plancks is still a fee.
 */
export function formatCmn(plancks: bigint, decimals: number, symbol: string): string {
  const negative = plancks < 0n;
  const magnitude = negative ? -plancks : plancks;
  // Scale to hundredths, rounding half up.
  const scale = decimals >= 2 ? 10n ** BigInt(decimals - 2) : 1n;
  const hundredths = decimals >= 2 ? (magnitude + scale / 2n) / scale : magnitude * 10n ** BigInt(2 - decimals);
  if (magnitude > 0n && hundredths === 0n) return `${negative ? '-' : ''}<0.01 ${symbol}`;
  const whole = hundredths / 100n;
  const cents = hundredths % 100n;
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${groupedWhole}.${cents.toString().padStart(2, '0')} ${symbol}`;
}

/**
 * Elides the middle of a hash for use in dense lists.
 *
 * Only ever cosmetic: every elided hash on a page is also a link carrying the
 * full value, so nothing that identifies a block or extrinsic is lost.
 */
export function shortHash(hash: string, keep = 8): string {
  const body = hash.startsWith('0x') ? hash.slice(2) : hash;
  const prefix = hash.startsWith('0x') ? '0x' : '';
  if (body.length <= keep * 2) {
    return hash;
  }
  return `${prefix}${body.slice(0, keep)}…${body.slice(-keep)}`;
}

/**
 * Escapes a string for interpolation into HTML.
 *
 * Every value on an explorer page originates on chain, and chain data is
 * attacker-controlled by construction: anyone can submit a `system.remark` full
 * of markup for the price of a fee. So escaping is applied at the renderer, to
 * everything, rather than being decided value by value.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The widest instant a JS `Date` can hold, in milliseconds either side of the
 * epoch. `toISOString()` throws `RangeError` beyond it, and the timestamp
 * pallet's value is a `u64` the runtime chose — so the range has to be checked
 * rather than assumed. A field the explorer cannot read is one unreadable
 * field; an uncaught RangeError would be a 502 for the whole page.
 */
const MAX_DATE_MS = 8_640_000_000_000_000n;

/** Renders the timestamp pallet's millisecond value as ISO-8601, or says why it cannot. */
export function formatTimestamp(timestampMs: bigint | null): string {
  if (timestampMs === null) {
    return 'unknown';
  }
  if (timestampMs > MAX_DATE_MS || timestampMs < -MAX_DATE_MS) {
    return `out of range (${timestampMs} ms)`;
  }
  return new Date(Number(timestampMs)).toISOString();
}

/** The ISO instant of a block timestamp, or null when the block has none or it is out of range. */
export function isoOf(timestampMs: bigint | null): string | null {
  const iso = formatTimestamp(timestampMs);
  return /^[+-]?\d{4,6}-\d\d-\d\dT/.test(iso) ? iso : null;
}

/**
 * "4 s ago" / "4 min ago" / "4 h ago" for anything under a day (§6), the date
 * "23 Oct 2026" beyond that; the absolute UTC time belongs in the `title` of
 * whatever prints this. `now` is a parameter so the function has no clock.
 */
export function relativeTime(timestampMs: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestampMs) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const d = new Date(timestampMs);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * A camel- or snake-case identifier as words in sentence case:
 * `transferKeepAlive` → "Transfer keep alive", `dispatch_info` → "Dispatch info".
 * The fallback for a call or event the word table does not know.
 */
export function humanize(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
