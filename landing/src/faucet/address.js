// SS58 decoding for /faucet, the inverse of src/network/ss58.js (which
// only encodes): base58 → prefix · 32-byte key · 2-byte checksum, the checksum
// recomputed with the same blake2b-512 the encoder uses. The chain's prefix is
// 42 and arrives from chain-facts.json, never typed here.
import { blake2b } from '../network/ss58.js';

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
 * single-byte prefix; `{ ok: false, reason }` otherwise. The reason is for the
 * console; the page shows the one refusal sentence the brief fixes.
 */
export function decodeSs58(address, { prefix = 42 } = {}) {
  const bytes = base58Decode(String(address ?? '').trim());
  if (!bytes) return { ok: false, reason: 'not base58' };
  if (bytes.length !== 35) return { ok: false, reason: `expected 35 bytes, got ${bytes.length}` };
  if (bytes[0] >= 64) return { ok: false, reason: 'multi-byte prefix' };
  if (bytes[0] !== prefix) return { ok: false, reason: `prefix ${bytes[0]}, not ${prefix}` };
  const body = bytes.subarray(0, 33);
  const hashed = new Uint8Array(SS58_PREFIX.length + body.length);
  hashed.set(SS58_PREFIX);
  hashed.set(body, SS58_PREFIX.length);
  const checksum = blake2b(hashed, 64);
  if (checksum[0] !== bytes[33] || checksum[1] !== bytes[34]) return { ok: false, reason: 'checksum' };
  return { ok: true, publicKey: bytes.slice(1, 33), prefix: bytes[0] };
}
