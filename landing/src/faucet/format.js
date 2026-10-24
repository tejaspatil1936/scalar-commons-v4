// Figures for /faucet, composed from the faucet's own answers and never typed:
// an amount in plancks becomes a token figure with the chain's decimals; a
// wait in milliseconds becomes "45 min" or "1 h 5 min".
const groups = new Intl.NumberFormat('en-US');

/**
 * `plancks` (string | bigint | number) with `decimals` → "1,100" or "1.5":
 * thousands separators, at most two decimals (money is never shown with more),
 * trailing zeros dropped. Truncates, so a figure is never rounded up.
 */
export function formatPlancks(plancks, decimals) {
  const n = BigInt(String(plancks));
  const unit = 10n ** BigInt(decimals);
  const whole = n / unit;
  const frac = (n % unit).toString().padStart(Number(decimals), '0').slice(0, 2).replace(/0+$/, '');
  return `${groups.format(whole)}${frac ? `.${frac}` : ''}`;
}

/** Milliseconds → "45 s", "12 min", "1 h", "1 h 5 min"; rounded up so a wait is never understated. */
export function formatWait(ms) {
  const s = Math.max(1, Math.ceil(Number(ms) / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${groups.format(h)} h ${rest} min` : `${groups.format(h)} h`;
}

/** The faucet's error text as a sentence: first letter capitalised, a full stop at the end. */
export function sentence(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}
