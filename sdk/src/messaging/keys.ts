/**
 * Messaging keys (D14) and payload encryption to them.
 *
 * Every agent may publish one X25519 public key with `agents.set_messaging_key`.
 * Senders encrypt payloads to that key, so negotiation terms travel over a
 * public chain (or any relay) without being readable by anyone but the
 * counterparty. Authenticity does not come from this layer: the signed
 * envelope already binds the ciphertext's hash to the sender's account key.
 *
 * Derivation — one secret to back up, not two:
 *
 *   x25519_secret = blake2_256(b"ScalarMsg/x25519/v1|" ++ u32_le(rotation) ++ sr25519_secret_key)
 *
 * where `sr25519_secret_key` is the 64-byte expanded key the keyring derives
 * from the agent's mnemonic / URI (path and password applied). The hash is
 * one-way, so leaking the messaging key never leaks the account key; the
 * rotation index gives unrelated keys for `set_messaging_key` rotation without
 * a new mnemonic.
 *
 * Sealing — anonymous-sender box, NaCl primitives:
 *
 *   ephemeral X25519 keypair (e, E); shared = X25519(e, recipient_pub)
 *   key  = blake2_256(b"ScalarMsg/seal/v1|" ++ shared ++ E ++ recipient_pub)
 *   body = 0x01 ++ E(32) ++ nonce(24) ++ XSalsa20-Poly1305(key, nonce, plaintext)
 *
 * X25519 is `@noble/curves` (the implementation `@polkadot/util-crypto`
 * itself depends on); XSalsa20-Poly1305 is util-crypto's `naclEncrypt`
 * (`nacl.secretbox`). util-crypto 13/14 no longer ship `naclSeal`, so this is
 * the documented equivalent of libsodium's `crypto_box_seal`.
 */
import { x25519 } from '@noble/curves/ed25519';
import { DEV_PHRASE } from '@polkadot/keyring';
import { hexToU8a, isHex, stringToU8a, u8aConcat } from '@polkadot/util';
import {
  blake2AsU8a,
  keyExtractSuri,
  keyFromPath,
  mnemonicToMiniSecret,
  naclDecrypt,
  naclEncrypt,
  randomAsU8a,
  sr25519PairFromSeed,
} from '@polkadot/util-crypto';

import { MessageRejected } from './envelope.js';

const KEY_DOMAIN = 'ScalarMsg/x25519/v1|';
const SEAL_DOMAIN = 'ScalarMsg/seal/v1|';

/** First byte of every sealed body. */
export const SEAL_VERSION = 1;

/** Bytes a sealed body adds to the plaintext: version + ephemeral key + nonce + Poly1305 tag. */
export const SEAL_OVERHEAD = 1 + 32 + 24 + 16;

/** An agent's X25519 messaging keypair, plus the account it was derived from. */
export interface MessagingKeypair {
  /** Publish this with `agents.set_messaging_key`. */
  publicKey: Uint8Array;
  /** Never leaves the agent. */
  secretKey: Uint8Array;
  /** The sr25519 AccountId the key was derived from. */
  accountId: Uint8Array;
}

/**
 * The sr25519 pair the keyring would build for `suri`: mnemonic, 32-byte hex
 * seed, or dev `//URI`, with `//hard`, `/soft` and `///password` applied.
 * Raw short-string seeds, which the keyring pads and accepts, are refused.
 */
function sr25519FromSuri(suri: string): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const full = suri.startsWith('//') ? `${DEV_PHRASE}${suri}` : suri;
  const { password, path, phrase } = keyExtractSuri(full);
  let seed: Uint8Array;
  if (isHex(phrase, 256)) {
    seed = hexToU8a(phrase);
  } else if ([12, 15, 18, 21, 24].includes(phrase.split(' ').length)) {
    seed = mnemonicToMiniSecret(phrase, password);
  } else {
    throw new Error('secret must be a mnemonic, a 32-byte hex seed or a dev //URI');
  }
  return keyFromPath(sr25519PairFromSeed(seed), path, 'sr25519');
}

/** Derive the agent's X25519 messaging keypair from its account secret. Deterministic. */
export function deriveMessagingKey(suri: string, opts: { rotation?: number } = {}): MessagingKeypair {
  const rotation = opts.rotation ?? 0;
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 0xffff_ffff) {
    throw new Error(`rotation must be a u32, got ${rotation}`);
  }
  const account = sr25519FromSuri(suri);
  const index = new Uint8Array(4);
  new DataView(index.buffer).setUint32(0, rotation, true);
  const secretKey = blake2AsU8a(u8aConcat(stringToU8a(KEY_DOMAIN), index, account.secretKey), 256);
  return { publicKey: x25519.getPublicKey(secretKey), secretKey, accountId: account.publicKey };
}

function shared(secret: Uint8Array, pub: Uint8Array): Uint8Array {
  // noble rejects low-order points (all-zero shared secret); keep the check
  // explicit so a future library change cannot silently weaken it.
  const s = x25519.getSharedSecret(secret, pub);
  if (s.every((b) => b === 0)) throw new Error('low-order X25519 public key');
  return s;
}

function boxKey(sharedSecret: Uint8Array, ephemeralPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  return blake2AsU8a(u8aConcat(stringToU8a(SEAL_DOMAIN), sharedSecret, ephemeralPub, recipientPub), 256);
}

/** Encrypt `plaintext` so only the holder of `recipientPublicKey`'s secret can read it. */
export function sealTo(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== 32) throw new Error('recipient messaging key must be 32 bytes');
  const ephemeralSecret = randomAsU8a(32);
  const ephemeralPub = x25519.getPublicKey(ephemeralSecret);
  const key = boxKey(shared(ephemeralSecret, recipientPublicKey), ephemeralPub, recipientPublicKey);
  const { encrypted, nonce } = naclEncrypt(plaintext, key, randomAsU8a(24));
  return u8aConcat([SEAL_VERSION], ephemeralPub, nonce, encrypted);
}

/** Decrypt a body produced by {@link sealTo}. Any failure is `MessageRejected('decrypt-failed')`. */
export function openSealed(body: Uint8Array, keypair: Pick<MessagingKeypair, 'publicKey' | 'secretKey'>): Uint8Array {
  if (body.length < SEAL_OVERHEAD) throw new MessageRejected('decrypt-failed', 'sealed body too short');
  if (body[0] !== SEAL_VERSION) throw new MessageRejected('decrypt-failed', `unknown seal version ${body[0]}`);
  const ephemeralPub = body.slice(1, 33);
  const nonce = body.slice(33, 57);
  let plaintext: Uint8Array | null;
  try {
    const key = boxKey(shared(keypair.secretKey, ephemeralPub), ephemeralPub, keypair.publicKey);
    plaintext = naclDecrypt(body.slice(57), nonce, key);
  } catch (err) {
    throw new MessageRejected('decrypt-failed', err instanceof Error ? err.message : String(err));
  }
  if (plaintext === null) throw new MessageRejected('decrypt-failed', 'authentication tag mismatch');
  return plaintext;
}
