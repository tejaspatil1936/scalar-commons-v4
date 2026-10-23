// Formatting for the network page's figures (SITE-REDESIGN.md §6): relative
// times with the absolute UTC time beside them, CMN amounts to at most two
// decimals with the full value for a title, durations in words. Pure; tested.
// Integers and UTC dates come from the chrome's formatInt and formatUtc.

/** The spaces of a short phrase made non-breaking, so a table cell never splits "4 min ago" over three lines. */
export const nowrap = (text) => String(text).replace(/ /g, '\u00a0');

/** "4 s ago" / "4 min ago" / "3 h ago" / "2 days ago", from two epoch-millisecond instants; the spaces do not break. */
export function relativeTime(thenMs, nowMs) {
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (seconds < 60) return nowrap(`${seconds} s ago`);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return nowrap(`${minutes} min ago`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return nowrap(`${hours} h ago`);
  const days = Math.floor(hours / 24);
  return nowrap(`${days} day${days === 1 ? '' : 's'} ago`);
}

/** "about 40 s" / "about 2 h 28 min" / "about 3 days 2 h", from a number of seconds. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `about ${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  if (hours < 24) return restMin === 0 ? `about ${hours} h` : `about ${hours} h ${restMin} min`;
  const days = Math.floor(hours / 24);
  const restH = hours % 24;
  return `about ${days} day${days === 1 ? '' : 's'}${restH === 0 ? '' : ` ${restH} h`}`;
}

const groups = new Intl.NumberFormat('en-US');

/**
 * Plancks → CMN: `text` with thousands separators and at most two decimals
 * (trailing zeros dropped, rounded down), `full` with every decimal the value
 * carries, for a title. Exact BigInt arithmetic, never through a float.
 */
export function formatCmn(plancks, decimals = 12) {
  const value = BigInt(plancks);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = groups.format(abs / scale);
  const frac = (abs % scale).toString().padStart(decimals, '0');
  const sign = negative ? '-' : '';
  const trimmedFull = frac.replace(/0+$/, '');
  const two = frac.slice(0, 2).replace(/0+$/, '');
  return {
    text: `${sign}${whole}${two ? `.${two}` : ''}`,
    full: `${sign}${whole}${trimmedFull ? `.${trimmedFull}` : ''}`,
  };
}

const SCALES = [
  [1_000_000_000_000n, 'trillion'],
  [1_000_000_000n, 'billion'],
  [1_000_000n, 'million'],
];

/**
 * CMN for a stat cell, which has room for about nine characters: below a
 * million as formatCmn, from a million up in words ("100 billion", "1.23
 * million") to at most two decimals. `full` is the whole value for a title.
 */
export function compactCmn(plancks, decimals = 12) {
  const { text, full } = formatCmn(plancks, decimals);
  const value = BigInt(plancks);
  const abs = value < 0n ? -value : value;
  const whole = abs / 10n ** BigInt(decimals);
  for (const [scale, word] of SCALES) {
    if (whole < scale) continue;
    const hundredths = (whole * 100n) / scale;
    const n = Number(hundredths) / 100;
    const shown = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '');
    return { text: `${value < 0n ? '-' : ''}${shown} ${word}`, full };
  }
  return { text, full };
}

/** Basis points → "30 %" (10 000 bps = 100 %). */
export function formatBps(bps) {
  const n = Number(bps);
  if (!Number.isFinite(n)) throw new Error('basis points are not a number');
  const pct = n / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} %`;
}

/** "Delivery notice" from "DeliveryNotice"; "Agreement created" from "AgreementCreated". */
export function words(camel) {
  return String(camel ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}
