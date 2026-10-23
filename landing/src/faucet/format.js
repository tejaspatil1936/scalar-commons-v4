// Figures for /faucet, composed from the faucet's own answers and never typed:
// an amount in plancks becomes a token figure with the chain's decimals; a
// duration in milliseconds becomes the words beside it.
const groups = new Intl.NumberFormat('en-US');

/** `plancks` (string | bigint | number) with `decimals` → "1,100" or "1.5"; trailing zeros dropped. */
export function formatPlancks(plancks, decimals = 12) {
  const n = BigInt(String(plancks));
  const unit = 10n ** BigInt(decimals);
  const whole = n / unit;
  const frac = (n % unit).toString().padStart(Number(decimals), '0').replace(/0+$/, '');
  return `${groups.format(whole)}${frac ? `.${frac}` : ''}`;
}

/** Milliseconds → "once every 1 h" / "once every 30 min" / "once every 45 s"; coarse on purpose. */
export function formatInterval(ms) {
  const s = Math.round(Number(ms) / 1000);
  if (s % 3600 === 0) return `once every ${groups.format(s / 3600)} h`;
  if (s % 60 === 0) return `once every ${groups.format(s / 60)} min`;
  return `once every ${groups.format(s)} s`;
}
