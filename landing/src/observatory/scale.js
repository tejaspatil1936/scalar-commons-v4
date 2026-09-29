// SCALE decoding for the handful of raw storage values the observatory reads
// straight off the node: the validator set, the BABE authority list, queued
// session keys, and the BABE pre-runtime digest on each block header.
//
// Only fixed-layout values are decoded here, and every decoder checks that the
// bytes are exactly the length its layout implies. A value that does not fit
// is a runtime whose layout moved, and it must surface as an error, not as a
// plausible-looking list of the wrong length.

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error('storage value is not a hex byte string');
  }
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(2 + 2 * i, 4 + 2 * i), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  let out = '0x';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Reads a SCALE compact integer at `offset`. Returns the value and the offset after it. */
export function readCompact(bytes, offset = 0) {
  if (offset >= bytes.length) throw new Error('storage value is empty');
  const mode = bytes[offset] & 0b11;
  if (mode === 0) return { value: bytes[offset] >> 2, next: offset + 1 };
  if (mode === 1) {
    if (offset + 2 > bytes.length) throw new Error('truncated compact integer');
    return { value: (bytes[offset] | (bytes[offset + 1] << 8)) >> 2, next: offset + 2 };
  }
  if (mode === 2) {
    if (offset + 4 > bytes.length) throw new Error('truncated compact integer');
    const raw = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
    return { value: raw >>> 2, next: offset + 4 };
  }
  // Big-integer mode: the top six bits give the byte count minus four.
  const length = (bytes[offset] >> 2) + 4;
  if (offset + 1 + length > bytes.length) throw new Error('truncated compact integer');
  let value = 0n;
  for (let i = length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + 1 + i]);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('compact integer too large');
  return { value: Number(value), next: offset + 1 + length };
}

/** The SCALE length prefix of a hex-encoded storage vector. */
export function decodeCompactLength(hex) {
  return readCompact(hexToBytes(hex)).value;
}

/**
 * A `Vec<T>` where every `T` is exactly `entryBytes` long. Throws unless the
 * value is exactly the prefix plus `count × entryBytes`.
 */
export function decodeFixedVec(hex, entryBytes) {
  const bytes = hexToBytes(hex);
  const { value: count, next } = readCompact(bytes);
  if (bytes.length !== next + count * entryBytes) {
    throw new Error(
      `storage value is ${bytes.length} bytes, expected ${next + count * entryBytes} for ${count} entries of ${entryBytes}`,
    );
  }
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    entries.push(bytes.subarray(next + i * entryBytes, next + (i + 1) * entryBytes));
  }
  return entries;
}

/** `Session.Validators`: `Vec<AccountId32>`. */
export function decodeValidators(hex) {
  return decodeFixedVec(hex, 32).map((entry) => Uint8Array.from(entry));
}

function readU64LE(bytes, offset) {
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[offset + i]);
  return value;
}

/** `Babe.Authorities`: `Vec<(AuthorityId, BabeAuthorityWeight)>` — 32-byte key + u64 weight. */
export function decodeBabeAuthorities(hex) {
  return decodeFixedVec(hex, 40).map((entry) => ({
    key: Uint8Array.from(entry.subarray(0, 32)),
    weight: Number(readU64LE(entry, 32)),
  }));
}

/**
 * `Session.QueuedKeys`: `Vec<(ValidatorId, SessionKeys)>` for this runtime's
 * `SessionKeys { babe, grandpa, authority_discovery }` — three 32-byte keys
 * after the 32-byte stash. See `impl_opaque_keys!` in runtime/src/lib.rs.
 */
export function decodeQueuedKeys(hex) {
  return decodeFixedVec(hex, 128).map((entry) => ({
    stash: Uint8Array.from(entry.subarray(0, 32)),
    babe: Uint8Array.from(entry.subarray(32, 64)),
    grandpa: Uint8Array.from(entry.subarray(64, 96)),
    authorityDiscovery: Uint8Array.from(entry.subarray(96, 128)),
  }));
}

const BABE_ENGINE = [0x42, 0x41, 0x42, 0x45]; // "BABE"

/**
 * The BABE pre-runtime digest of a header, or null if the log is not one.
 *
 * Layout: `0x06` (PreRuntime), the four-byte engine id, a compact length, then
 * the pre-digest: a variant byte (1 primary, 2 secondary plain, 3 secondary
 * VRF), the authority index as u32 LE and the slot as u64 LE.
 */
export function decodeBabePreDigest(logHex) {
  const bytes = hexToBytes(logHex);
  if (bytes.length < 6 || bytes[0] !== 0x06) return null;
  if (!BABE_ENGINE.every((b, i) => bytes[1 + i] === b)) return null;
  const { value: length, next } = readCompact(bytes, 5);
  if (bytes.length !== next + length) throw new Error('BABE pre-digest length does not match its prefix');
  const kinds = { 1: 'primary', 2: 'secondary-plain', 3: 'secondary-vrf' };
  const kind = kinds[bytes[next]];
  if (!kind || length < 13) throw new Error(`unrecognised BABE pre-digest variant ${bytes[next]}`);
  const authorityIndex =
    (bytes[next + 1] | (bytes[next + 2] << 8) | (bytes[next + 3] << 16) | (bytes[next + 4] << 24)) >>> 0;
  return { kind, authorityIndex, slot: Number(readU64LE(bytes, next + 5)) };
}

/** The BABE pre-digest from a header's `digest.logs`, or null if none is present. */
export function babePreDigestOf(header) {
  for (const log of header?.digest?.logs ?? []) {
    const decoded = decodeBabePreDigest(log);
    if (decoded) return decoded;
  }
  return null;
}
