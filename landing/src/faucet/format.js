// Figures for /faucet, composed from the faucet's own answers and never typed:
// an amount in plancks becomes a CMN figure with the chain's decimals, and a
// wait in milliseconds becomes the words beside it (§6: units always, at most
// two decimals shown, the full value in a title).
const groups = new Intl.NumberFormat('en-US');

/** `plancks` (string | bigint | number) with `decimals` → "1,100" or "1.5"; full precision, trailing zeros dropped. */
export function formatPlancks(plancks, decimals = 12) {
  const n = BigInt(String(plancks));
  const unit = 10n ** BigInt(decimals);
  const whole = n / unit;
  const frac = (n % unit).toString().padStart(Number(decimals), '0').replace(/0+$/, '');
  return `${groups.format(whole)}${frac ? `.${frac}` : ''}`;
}

/** The same amount for prose: `text` with at most two decimals, `full` with every decimal (for a title when they differ). */
export function formatCmn(plancks, decimals = 12) {
  const full = formatPlancks(plancks, decimals);
  const [whole, frac = ''] = full.split('.');
  const short = frac.length > 2 ? frac.slice(0, 2).replace(/0+$/, '') : frac;
  const rounded = short ? `${whole}.${short}` : whole;
  // A value too small for two decimals keeps every decimal rather than reading as zero.
  const text = rounded === '0' && full !== '0' ? full : rounded;
  return { text, full, truncated: text !== full };
}

/** Milliseconds → "45 s" / "58 min" / "1 h" / "1 h 30 min", rounded up so a visitor never comes back a moment early. */
export function formatDuration(ms) {
  const s = Math.max(1, Math.ceil(Number(ms) / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
