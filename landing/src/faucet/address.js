// SS58 decoding for the faucet form: base58 → prefix · 32-byte key · 2-byte
// checksum, the checksum recomputed with blake2b-512. The form checks an
// address here before it sends anything, so a typo is answered under the
// field at once instead of costing a request against the faucet's limits.
// The chain's prefix arrives from chain-facts.json, never typed here.
import { blake2b } from './blake2b.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SS58_PREFIX = new TextEncoder().encode('SS58PRE');

/** Base58 → bytes, or null on a character outside the alphabet. */
export function base58Decode(text) {
  let value = 0n;
  for (const ch of text) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) return null;
    value = value * 58n + BigInt(index);
  }
  const out = [];
  while (value > 0n) {
    out.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

/**
 * `{ ok: true, publicKey, prefix }` for a well-formed address with the given
 * single-byte prefix; `{ ok: false, reason, prefix? }` otherwise.
 */
export function decodeSs58(address, { prefix } = {}) {
  const text = String(address ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const bytes = base58Decode(text);
  if (!bytes) return { ok: false, reason: 'alphabet' };
  if (bytes.length !== 35 || bytes[0] >= 64) return { ok: false, reason: 'length' };
  const body = bytes.subarray(0, 33);
  const hashed = new Uint8Array(SS58_PREFIX.length + body.length);
  hashed.set(SS58_PREFIX);
  hashed.set(body, SS58_PREFIX.length);
  const checksum = blake2b(hashed, 64);
  if (checksum[0] !== bytes[33] || checksum[1] !== bytes[34]) return { ok: false, reason: 'checksum' };
  if (bytes[0] !== prefix) return { ok: false, reason: 'prefix', prefix: bytes[0] };
  return { ok: true, publicKey: bytes.slice(1, 33), prefix: bytes[0] };
}

/**
 * The plain sentence shown under the field, or null when the address is fine.
 * Every figure in it is the chain's prefix (from chain-facts.json) or the
 * prefix the pasted address carries.
 */
export function addressError(address, prefix) {
  const result = decodeSs58(address, { prefix });
  if (result.ok) return null;
  switch (result.reason) {
    case 'empty':
      return 'Enter an address.';
    case 'alphabet':
      return 'That is not an SS58 address: it contains a character SS58 does not use (0, O, I, l, a space or a symbol).';
    case 'checksum':
      return 'That address has a typo: its checksum does not match. Copy it again from your wallet.';
    case 'prefix':
      return `That address is for another network (SS58 prefix ${result.prefix}). This chain uses prefix ${prefix}.`;
    default:
      return 'That is not an SS58 address: it is the wrong length.';
  }
}
