import { beforeAll, describe, expect, it } from 'vitest';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { TypeRegistry } from '@polkadot/types';
import { u8aConcat, u8aToHex, stringToU8a } from '@polkadot/util';
import { blake2AsU8a, cryptoWaitReady } from '@polkadot/util-crypto';

import {
  ENVELOPE_VERSION,
  MESSAGE_KINDS,
  MessageInbox,
  MessageRejected,
  NonceTracker,
  OutboundNonces,
  SIGNING_DOMAIN,
  createMessage,
  decodeEnvelope,
  decodeFrame,
  encodeEnvelope,
  encodeFrame,
  envelopeSigningPayload,
  type Envelope,
} from '../src/index.js';

/**
 * Offline tests for the spec-308 signed envelope (docs/reference/messaging.md).
 * No node, no network: keys are the well-known dev derivations.
 */

const GENESIS = new Uint8Array(32).fill(0x42);
const OTHER_GENESIS = new Uint8Array(32).fill(0x43);

let alice: KeyringPair;
let bob: KeyringPair;
let carol: KeyringPair;

beforeAll(async () => {
  await cryptoWaitReady();
  const kr = new Keyring({ type: 'sr25519' });
  alice = kr.addFromUri('//Alice');
  bob = kr.addFromUri('//Bob');
  carol = kr.addFromUri('//Charlie');
});

const payload = stringToU8a('{"offer":"10 CMN for one ECB fix"}');

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    version: ENVELOPE_VERSION,
    from: alice.publicKey,
    to: bob.publicKey,
    kind: 'Offer',
    agreement: null,
    nonce: 7n,
    expiresAtBlock: 1_000,
    payloadHash: blake2AsU8a(payload, 256),
    ...over,
  };
}

/** Build a message from Alice to Bob with sensible defaults. */
function msg(over: Partial<Parameters<typeof createMessage>[1]> = {}, signer = alice) {
  return createMessage(signer, {
    to: bob.address,
    kind: 'Offer',
    payload,
    nonce: 1n,
    expiresAtBlock: 1_000,
    genesisHash: GENESIS,
    ...over,
  });
}

function inbox(self = bob) {
  return new MessageInbox({ self: self.address, genesisHash: GENESIS });
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof MessageRejected) return err.reason;
    throw err;
  }
  throw new Error('expected MessageRejected, nothing was thrown');
}

describe('message kinds', () => {
  it('match the pallet-messages MessageKind variant order', () => {
    expect(MESSAGE_KINDS).toEqual([
      'Offer', 'Bid', 'Accept', 'Reject', 'DeliveryNotice', 'DisputeNote', 'Announce', 'Ping',
    ]);
  });
});

describe('canonical SCALE encoding', () => {
  // An independent codec: polkadot-js's own SCALE implementation of the struct
  // the spec fixes. If encodeEnvelope drifts from SCALE, this catches it.
  const registry = new TypeRegistry();
  registry.register({
    ScalarEnvelope: {
      version: 'u8',
      from: 'AccountId32',
      to: 'AccountId32',
      kind: 'u8',
      agreement: 'Option<(AccountId32, u32)>',
      nonce: 'u64',
      expires_at_block: 'u32',
      payload_hash: '[u8; 32]',
    },
  });

  const reference = (e: Envelope) =>
    registry
      .createType('ScalarEnvelope', {
        version: e.version,
        from: e.from,
        to: e.to,
        kind: MESSAGE_KINDS.indexOf(e.kind),
        agreement: e.agreement ? [e.agreement.account, e.agreement.seq] : null,
        nonce: e.nonce,
        expires_at_block: e.expiresAtBlock,
        payload_hash: e.payloadHash,
      })
      .toU8a();

  it('equals polkadot-js SCALE without an agreement (111 bytes)', () => {
    const e = envelope({ kind: 'Ping', nonce: 2n ** 64n - 1n, expiresAtBlock: 0xffff_ffff });
    const bytes = encodeEnvelope(e);
    expect(bytes.length).toBe(111);
    expect(u8aToHex(bytes)).toBe(u8aToHex(reference(e)));
  });

  it('equals polkadot-js SCALE with an agreement (147 bytes)', () => {
    const e = envelope({ kind: 'Accept', agreement: { account: carol.publicKey, seq: 513 } });
    const bytes = encodeEnvelope(e);
    expect(bytes.length).toBe(147);
    expect(u8aToHex(bytes)).toBe(u8aToHex(reference(e)));
  });

  it('round-trips through decodeEnvelope', () => {
    for (const e of [envelope(), envelope({ kind: 'DisputeNote', agreement: { account: bob.publicKey, seq: 9 } })]) {
      expect(decodeEnvelope(encodeEnvelope(e))).toEqual({ envelope: e, length: encodeEnvelope(e).length });
    }
  });

  it('rejects out-of-range fields before encoding', () => {
    expect(() => encodeEnvelope(envelope({ nonce: -1n }))).toThrow(/nonce/);
    expect(() => encodeEnvelope(envelope({ nonce: 2n ** 64n }))).toThrow(/nonce/);
    expect(() => encodeEnvelope(envelope({ expiresAtBlock: 2 ** 32 }))).toThrow(/expiresAtBlock/);
    expect(() => encodeEnvelope(envelope({ payloadHash: new Uint8Array(31) }))).toThrow(/payloadHash/);
    expect(() => encodeEnvelope(envelope({ kind: 'Nope' as never }))).toThrow(/kind/);
  });

  it('rejects malformed bytes on decode', () => {
    const bytes = encodeEnvelope(envelope());
    expect(() => decodeEnvelope(bytes.slice(0, 100))).toThrow(/short/);
    const badKind = bytes.slice();
    badKind[65] = 8;
    expect(() => decodeEnvelope(badKind)).toThrow(/kind/);
    const badOption = bytes.slice();
    badOption[66] = 2;
    expect(() => decodeEnvelope(badOption)).toThrow(/agreement/);
  });
});

describe('signing payload', () => {
  it('is the domain prefix, then the genesis hash, then blake2_256 of the SCALE bytes', () => {
    const e = envelope();
    const expected = u8aConcat(stringToU8a('ScalarMsg/v1|'), GENESIS, blake2AsU8a(encodeEnvelope(e), 256));
    expect(SIGNING_DOMAIN).toBe('ScalarMsg/v1|');
    expect(u8aToHex(envelopeSigningPayload(e, GENESIS))).toBe(u8aToHex(expected));
  });

  it('refuses a genesis hash that is not 32 bytes', () => {
    expect(() => envelopeSigningPayload(envelope(), new Uint8Array(31))).toThrow(/genesis/);
  });
});

describe('createMessage', () => {
  it('commits to blake2_256 of the payload and signs as the sender', () => {
    const m = msg();
    expect(u8aToHex(m.envelope.payloadHash)).toBe(u8aToHex(blake2AsU8a(payload, 256)));
    expect(u8aToHex(m.envelope.from)).toBe(u8aToHex(alice.publicKey));
    expect(m.signature.length).toBe(64);
  });

  it('refuses a non-sr25519 signer', () => {
    const ed = new Keyring({ type: 'ed25519' }).addFromUri('//Alice');
    expect(() => msg({}, ed)).toThrow(/sr25519/);
  });

  it('frames round-trip: SCALE(envelope) ++ signature ++ payload', () => {
    const m = msg({ agreement: { account: bob.address, seq: 3 } });
    const frame = encodeFrame(m);
    expect(frame.length).toBe(147 + 64 + payload.length);
    expect(decodeFrame(frame)).toEqual(m);
  });
});

describe('MessageInbox.receive — verification rules', () => {
  it('accepts a valid message and returns the sender address and payload', () => {
    const got = inbox().receive(encodeFrame(msg()), 999);
    expect(got.from).toBe(alice.address);
    expect(got.kind).toBe('Offer');
    expect(u8aToHex(got.payload)).toBe(u8aToHex(payload));
  });

  it('rejects a signature by anyone other than `from` (wrong signer)', () => {
    const forged = { ...msg(), signature: msg({}, carol).signature };
    expect(reason(() => inbox().receive(encodeFrame(forged), 1))).toBe('bad-signature');
  });

  it('rejects a `from` that is not a valid public key as bad-signature, not a crash', () => {
    const m = msg();
    const bogus = { ...m, envelope: { ...m.envelope, from: new Uint8Array(32).fill(0xff) } };
    const box = new MessageInbox({ self: bob.address, genesisHash: GENESIS });
    expect(reason(() => box.receive(encodeFrame(bogus), 1))).toBe('bad-signature');
  });

  it('rejects any field changed after signing', () => {
    const m = msg();
    const tampered = { ...m, envelope: { ...m.envelope, expiresAtBlock: 5_000 } };
    expect(reason(() => inbox().receive(encodeFrame(tampered), 1))).toBe('bad-signature');
  });

  it('rejects a message signed for another chain (genesis binding)', () => {
    const other = msg({ genesisHash: OTHER_GENESIS });
    expect(reason(() => inbox().receive(encodeFrame(other), 1))).toBe('bad-signature');
  });

  it('rejects a message addressed to someone else', () => {
    expect(reason(() => inbox(carol).receive(encodeFrame(msg()), 1))).toBe('wrong-recipient');
  });

  it('rejects expires_at_block < best block, accepts equality', () => {
    expect(reason(() => inbox().receive(encodeFrame(msg()), 1_001))).toBe('expired');
    expect(() => inbox().receive(encodeFrame(msg()), 1_000)).not.toThrow();
  });

  it('rejects a payload whose blake2_256 differs from payload_hash', () => {
    const m = msg();
    const swapped = { ...m, payload: stringToU8a('{"offer":"1 CMN"}') };
    expect(reason(() => inbox().receive(encodeFrame(swapped), 1))).toBe('payload-hash-mismatch');
  });

  it('rejects replays and non-increasing nonces per (from, to)', () => {
    const box = inbox();
    box.receive(encodeFrame(msg({ nonce: 5n })), 1);
    expect(reason(() => box.receive(encodeFrame(msg({ nonce: 5n })), 1))).toBe('replay');
    expect(reason(() => box.receive(encodeFrame(msg({ nonce: 4n })), 1))).toBe('replay');
    expect(() => box.receive(encodeFrame(msg({ nonce: 6n })), 1)).not.toThrow();
  });

  it('tracks nonces independently per sender', () => {
    const box = inbox();
    box.receive(encodeFrame(msg({ nonce: 5n })), 1);
    expect(() => box.receive(encodeFrame(msg({ nonce: 1n }, carol)), 1)).not.toThrow();
  });

  it('does not consume a nonce when a later check fails', () => {
    const box = inbox();
    const m = msg({ nonce: 9n });
    expect(reason(() => box.receive(encodeFrame({ ...m, payload: new Uint8Array([1]) }), 1))).toBe(
      'payload-hash-mismatch',
    );
    expect(() => box.receive(encodeFrame(m), 1)).not.toThrow();
  });

  it('rejects an unknown envelope version', () => {
    const m = msg();
    const v2 = { ...m, envelope: { ...m.envelope, version: 2 } };
    expect(reason(() => inbox().receive(encodeFrame(v2), 1))).toBe('unsupported-version');
  });

  it('rejects when the on-chain origin differs from `from`', () => {
    expect(reason(() => inbox().receive(encodeFrame(msg()), 1, { origin: carol.address }))).toBe(
      'origin-mismatch',
    );
    expect(() => inbox().receive(encodeFrame(msg()), 1, { origin: alice.address })).not.toThrow();
  });

  it('verifies a hash-only frame against a detached payload', () => {
    const m = msg();
    const hashOnly = encodeFrame({ ...m, payload: new Uint8Array() });
    expect(reason(() => inbox().receive(hashOnly, 1))).toBe('payload-hash-mismatch');
    const got = inbox().receive(hashOnly, 1, { detachedPayload: payload });
    expect(u8aToHex(got.payload)).toBe(u8aToHex(payload));
  });

  it('shares state through an injected NonceTracker (restart safety)', () => {
    const tracker = new NonceTracker();
    new MessageInbox({ self: bob.address, genesisHash: GENESIS, nonces: tracker }).receive(
      encodeFrame(msg({ nonce: 3n })),
      1,
    );
    const restored = new NonceTracker(tracker.toJSON());
    const box = new MessageInbox({ self: bob.address, genesisHash: GENESIS, nonces: restored });
    expect(reason(() => box.receive(encodeFrame(msg({ nonce: 3n })), 1))).toBe('replay');
  });
});

describe('OutboundNonces', () => {
  it('is strictly increasing per recipient, and survives a restart without reuse', () => {
    let now = 1_700_000_000_000;
    const a = new OutboundNonces(() => now);
    const n1 = a.next(bob.address);
    const n2 = a.next(bob.address);
    expect(n2).toBeGreaterThan(n1);
    // Restart one millisecond later with no persisted state: the clock
    // component alone moves the nonce past everything issued before.
    now += 1;
    const b = new OutboundNonces(() => now);
    expect(b.next(bob.address)).toBeGreaterThan(n2);
  });

  it('never goes backwards when the clock does', () => {
    let now = 1_700_000_000_000;
    const a = new OutboundNonces(() => now);
    const n1 = a.next(bob.address);
    now -= 60_000;
    expect(a.next(bob.address)).toBeGreaterThan(n1);
  });
});
