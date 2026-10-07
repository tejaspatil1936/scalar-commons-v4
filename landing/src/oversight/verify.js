// The two checks the reader's browser performs for itself, and the decoder
// that gives them something live to check against.
//
// Nothing here fetches and nothing here touches the DOM: every function is
// pure, so test/oversight/verify.test.mjs can hold it to the real bytes from
// the recorded sample. That matters more here than anywhere else on the site —
// a page that claims to verify a hash must be verifying it, so the code that
// does is the code under test.
//
// blake2b-256 is blakejs, pinned at 1.2.1. It is the same function the chain
// calls `blake2_256`, which is what lets a browser recompute a commitment the
// runtime wrote.

import { blake2b } from 'blakejs';

import { bytesToHex, hexToBytes, readCompact } from '../observatory/scale.js';

export { bytesToHex, hexToBytes };

/** `MessageKind` by SCALE index. Append-only on chain, so the order is the encoding. */
export const MESSAGE_KINDS = ['Offer', 'Bid', 'Accept', 'Reject', 'DeliveryNotice', 'DisputeNote', 'Announce', 'Ping'];

/** blake2_256 of some bytes, as 0x-hex. The chain's `payload_hash` is this over the plaintext. */
export function blake2_256(bytes) {
  return bytesToHex(blake2b(bytes, undefined, 32));
}

/** blake2_256 of a UTF-8 string. The plaintext is stored as text, hashed as its bytes. */
export function hashText(text) {
  return blake2_256(new TextEncoder().encode(text));
}

/** How many bytes a SCALE compact length prefix takes for a vector of `n` bytes. */
export function compactPrefixLength(n) {
  if (n < 64) return 1;
  if (n < 16_384) return 2;
  if (n < 1_073_741_824) return 4;
  return 5;
}

/** First offset of `needle` in `haystack`, or -1. Both are byte arrays. */
export function indexOfBytes(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Read the live `messages.send` call out of a signed extrinsic, anchored on the
 * payload bytes and validated against the call index.
 *
 * WHY BACKWARDS. A signed extrinsic begins with a length, a version byte, the
 * signer, the signature, and then as many signed extensions as the runtime
 * declares. That tail is version-dependent, so walking FORWARDS to the call
 * means guessing how many bytes of era, nonce, tip and metadata hash sit in
 * front of it. The call's own layout, by contrast, is fixed:
 *
 *   call_index(2) ‖ to(32) ‖ kind(1) ‖ agreement(Option) ‖ payload_hash(Option) ‖ payload(Vec<u8>)
 *
 * so finding the payload fixes every field in front of it. Both shapes of the
 * agreement option are tried, and the one whose implied `call_index` is
 * actually `messages.send` is the answer. That check is why this is a decode
 * and not a guess: a wrong hypothesis lands on two bytes that are not 42/0 and
 * is rejected, and if neither lands the function says so instead of returning
 * a field the page would then present as fact.
 */
export function decodeSendCall(extrinsicHex, { payloadHex, callIndex }) {
  let extrinsic;
  let payload;
  try {
    extrinsic = hexToBytes(extrinsicHex);
    payload = hexToBytes(payloadHex);
  } catch {
    return { ok: false, reason: 'the node returned something that is not a hex byte string' };
  }

  const at = indexOfBytes(extrinsic, payload);
  if (at < 0) return { ok: false, reason: 'this extrinsic does not carry the recorded payload bytes' };

  const hashEnd = at - compactPrefixLength(payload.length);
  if (hashEnd - 33 < 0 || extrinsic[hashEnd - 33] !== 0x01) {
    return { ok: false, reason: 'no Some(payload_hash) sits in front of the payload' };
  }
  const payloadHash = bytesToHex(extrinsic.slice(hashEnd - 32, hashEnd));

  // Option<(AccountId32, u32)>: 0x00, or 0x01 ‖ 32-byte account ‖ u32 LE.
  for (const [tag, size] of [
    [0x00, 1],
    [0x01, 37],
  ]) {
    const agreementAt = hashEnd - 33 - size;
    if (agreementAt < 0 || extrinsic[agreementAt] !== tag) continue;
    const kindAt = agreementAt - 1;
    const toAt = agreementAt - 33;
    const callAt = agreementAt - 35;
    if (callAt < 0) continue;
    if (extrinsic[callAt] !== callIndex.pallet || extrinsic[callAt + 1] !== callIndex.call) continue;

    let signer;
    try {
      const { next } = readCompact(extrinsic, 0);
      // 0x84 is a signed extrinsic, format version 4; 0x00 is MultiAddress::Id.
      if (extrinsic[next] !== 0x84 || extrinsic[next + 1] !== 0x00) {
        return { ok: false, reason: 'not a version-4 signed extrinsic with an account-id signer' };
      }
      signer = bytesToHex(extrinsic.slice(next + 2, next + 34));
    } catch {
      return { ok: false, reason: 'the extrinsic has no readable length prefix' };
    }

    const seq =
      tag === 0x00
        ? null
        : extrinsic[agreementAt + 33] |
          (extrinsic[agreementAt + 34] << 8) |
          (extrinsic[agreementAt + 35] << 16) |
          (extrinsic[agreementAt + 36] << 24);

    return {
      ok: true,
      from: signer,
      to: bytesToHex(extrinsic.slice(toAt, toAt + 32)),
      kindIndex: extrinsic[kindAt],
      kind: MESSAGE_KINDS[extrinsic[kindAt]] ?? `kind #${extrinsic[kindAt]}`,
      agreement:
        tag === 0x00
          ? null
          : { account: bytesToHex(extrinsic.slice(agreementAt + 1, agreementAt + 33)), seq: seq >>> 0 },
      payloadHash,
      payloadLen: payload.length,
    };
  }
  return { ok: false, reason: 'no messages.send call index in front of the payload' };
}

/**
 * The verdict for one row, given what the chain just said.
 *
 * `live` is the decode above (or null when the node could not be reached), and
 * `row` is the recorded sample. The commitment is compared against the LIVE
 * `payload_hash` whenever there is one, and falls back to the recorded value
 * only when offline — and `against` says which, so the page never implies it
 * checked the chain when it checked a file.
 */
export function verifyRow(row, live, { extrinsicHex = null } = {}) {
  const out = {
    extrinsicHashMatches: null,
    commitment: null,
    against: live?.ok ? 'live' : 'recorded',
    fieldsAgree: null,
    reason: null,
  };

  if (extrinsicHex !== null) {
    try {
      out.extrinsicHashMatches = blake2_256(hexToBytes(extrinsicHex)) === row.extrinsicHash;
    } catch {
      out.extrinsicHashMatches = false;
    }
  }

  const commitment = live?.ok ? live.payloadHash : row.payloadHashOnChain;
  if (row.plaintext === null) {
    out.reason = row.reason;
  } else if (commitment === null || commitment === undefined) {
    out.reason = 'no commitment to check against';
  } else {
    out.commitment = { computed: hashText(row.plaintext), onChain: commitment };
    out.commitment.matches = out.commitment.computed === commitment;
  }

  if (live?.ok) {
    // Only the fields the decoder actually reads are compared. `kind` and the
    // commitment are the two that carry meaning for a reader.
    out.fieldsAgree = live.kind === row.kind && live.payloadHash === row.payloadHashOnChain;
  }
  return out;
}
