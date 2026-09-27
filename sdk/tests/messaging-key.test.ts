import { beforeAll, describe, expect, it } from 'vitest';
import { Keyring } from '@polkadot/keyring';
import { stringToU8a, u8aToHex } from '@polkadot/util';
import { cryptoWaitReady } from '@polkadot/util-crypto';

import {
  MessageRejected,
  SEAL_OVERHEAD,
  deriveMessagingKey,
  openSealed,
  sealTo,
} from '../src/index.js';

/**
 * Offline tests for the X25519 messaging key (D14) and payload encryption to it.
 * The mnemonic below is the public Substrate dev phrase — never a real key.
 */
const DEV_PHRASE = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';

beforeAll(async () => {
  await cryptoWaitReady();
});

describe('deriveMessagingKey', () => {
  it('derives from the same account secret the keyring signs with', () => {
    const kr = new Keyring({ type: 'sr25519' });
    for (const suri of ['//Alice', '//Bob//msg', `${DEV_PHRASE}//hard/soft`, `${DEV_PHRASE}///pw`, DEV_PHRASE]) {
      const k = deriveMessagingKey(suri);
      expect(u8aToHex(k.accountId), suri).toBe(u8aToHex(kr.addFromUri(suri).publicKey));
    }
  });

  it('is deterministic, 32 bytes, and distinct per account', () => {
    const a1 = deriveMessagingKey('//Alice');
    const a2 = deriveMessagingKey('//Alice');
    const b = deriveMessagingKey('//Bob');
    expect(a1.publicKey.length).toBe(32);
    expect(a1.secretKey.length).toBe(32);
    expect(u8aToHex(a1.publicKey)).toBe(u8aToHex(a2.publicKey));
    expect(u8aToHex(a1.publicKey)).not.toBe(u8aToHex(b.publicKey));
  });

  it('never reuses the sr25519 key bytes as the X25519 key', () => {
    const k = deriveMessagingKey('//Alice');
    expect(u8aToHex(k.publicKey)).not.toBe(u8aToHex(k.accountId));
  });

  it('rotates to an unrelated key per rotation index', () => {
    const r0 = deriveMessagingKey('//Alice');
    const r1 = deriveMessagingKey('//Alice', { rotation: 1 });
    expect(u8aToHex(r0.publicKey)).toBe(u8aToHex(deriveMessagingKey('//Alice', { rotation: 0 }).publicKey));
    expect(u8aToHex(r1.publicKey)).not.toBe(u8aToHex(r0.publicKey));
    expect(() => deriveMessagingKey('//Alice', { rotation: -1 })).toThrow(/rotation/);
  });

  it('refuses a secret that is neither a mnemonic, a 32-byte hex seed nor a dev URI', () => {
    expect(() => deriveMessagingKey('not a mnemonic')).toThrow(/mnemonic/);
  });
});

describe('sealTo / openSealed', () => {
  const plaintext = stringToU8a('{"price":"10 CMN","deliverBy":1200}');

  it('round-trips to the recipient key', () => {
    const bob = deriveMessagingKey('//Bob');
    const sealed = sealTo(plaintext, bob.publicKey);
    expect(sealed.length).toBe(plaintext.length + SEAL_OVERHEAD);
    expect(u8aToHex(openSealed(sealed, bob))).toBe(u8aToHex(plaintext));
  });

  it('uses a fresh ephemeral key and nonce every time', () => {
    const bob = deriveMessagingKey('//Bob');
    expect(u8aToHex(sealTo(plaintext, bob.publicKey))).not.toBe(u8aToHex(sealTo(plaintext, bob.publicKey)));
  });

  it('cannot be opened by anyone else', () => {
    const sealed = sealTo(plaintext, deriveMessagingKey('//Bob').publicKey);
    expect(() => openSealed(sealed, deriveMessagingKey('//Charlie'))).toThrow(MessageRejected);
    expect(() => openSealed(sealed, deriveMessagingKey('//Bob', { rotation: 1 }))).toThrow(/decrypt/);
  });

  it('detects tampering with any byte', () => {
    const bob = deriveMessagingKey('//Bob');
    const sealed = sealTo(plaintext, bob.publicKey);
    for (const i of [0, 1, 40, sealed.length - 1]) {
      const bad = sealed.slice();
      bad[i]! ^= 0x01;
      expect(() => openSealed(bad, bob), `byte ${i}`).toThrow(MessageRejected);
    }
  });

  it('rejects truncated input and an unknown seal version', () => {
    const bob = deriveMessagingKey('//Bob');
    expect(() => openSealed(new Uint8Array(SEAL_OVERHEAD - 1), bob)).toThrow(/short/);
    const sealed = sealTo(plaintext, bob.publicKey);
    sealed[0] = 9;
    expect(() => openSealed(sealed, bob)).toThrow(/version/);
  });

  it('refuses a low-order recipient key', () => {
    expect(() => sealTo(plaintext, new Uint8Array(32))).toThrow();
  });

  it('seals an empty payload', () => {
    const bob = deriveMessagingKey('//Bob');
    expect(openSealed(sealTo(new Uint8Array(), bob.publicKey), bob).length).toBe(0);
  });
});
