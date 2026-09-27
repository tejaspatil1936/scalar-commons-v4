import { beforeAll, describe, expect, it } from 'vitest';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { blake2AsHex } from '@polkadot/util-crypto';
import { MessageRejected, encodeSignedMessage } from '@scalar-commons/sdk';

import { AgentMessenger } from '../src/messaging.js';
import { runMessagingDemo } from '../src/message-demo.js';

/** Offline: dev keys, a fixed genesis, no node. */
const GENESIS = `0x${'5c'.repeat(32)}`;

beforeAll(async () => {
  await cryptoWaitReady();
});

const make = (uri: string) => new AgentMessenger(uri, { genesisHash: GENESIS });

describe('AgentMessenger', () => {
  it('derives the account and the X25519 messaging key from the one agent secret', () => {
    const a = make('//Alice//agent');
    expect(a.address).toMatch(/^5/);
    expect(a.messagingPublicKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(make('//Alice//agent').messagingPublicKey).toBe(a.messagingPublicKey);
    expect(new AgentMessenger('//Alice//agent', { genesisHash: GENESIS, rotation: 1 }).messagingPublicKey).not.toBe(
      a.messagingPublicKey,
    );
  });

  it('sends a sealed JSON body only the recipient can read', () => {
    const alice = make('//Alice//agent');
    const bob = make('//Bob//agent');
    const carol = make('//Charlie//agent');
    const m = alice.compose(bob.address, 'Offer', { price: '10' }, {
      recipientKey: bob.messagingPublicKey,
      expiresAtBlock: 50,
    });
    const frame = encodeSignedMessage(m);
    expect(new TextDecoder().decode(frame)).not.toContain('price');
    const got = bob.read(frame, 10, { senderMessagingKey: alice.messagingPublicKey });
    expect(got).toMatchObject({ from: alice.address, kind: 'Offer', bodyType: 'Sealed', body: { price: '10' } });
    // payload_hash is over the plaintext, so it is the same as for a Plain body.
    expect(got.payloadHash).toBe(blake2AsHex(JSON.stringify({ price: '10' }), 256));
    expect(() => carol.read(frame, 10, { senderMessagingKey: alice.messagingPublicKey })).toThrow(MessageRejected);
  });

  it("refuses a sealed body whose sender key is not the sender's published key", () => {
    const alice = make('//Alice//agent');
    const bob = make('//Bob//agent');
    const frame = encodeSignedMessage(
      alice.compose(bob.address, 'Offer', {}, { recipientKey: bob.messagingPublicKey, expiresAtBlock: 50 }),
    );
    expect(() => bob.read(frame, 1)).toThrow(/sender-key-mismatch/);
    expect(() => bob.read(frame, 1, { senderMessagingKey: make('//Charlie//agent').messagingPublicKey })).toThrow(
      /sender-key-mismatch/,
    );
  });

  it('sends a plain JSON body when no recipient key is given (e.g. Announce)', () => {
    const alice = make('//Alice//agent');
    const bob = make('//Bob//agent');
    const m = alice.compose(bob.address, 'Announce', { q: 'ECB EUR/USD 2026-09-26' }, { expiresAtBlock: 5 });
    expect(bob.read(encodeSignedMessage(m), 5).body).toEqual({ q: 'ECB EUR/USD 2026-09-26' });
  });

  it('rejects a replayed frame on the second read', () => {
    const alice = make('//Alice//agent');
    const bob = make('//Bob//agent');
    const frame = encodeSignedMessage(alice.compose(bob.address, 'Ping', {}, { expiresAtBlock: 5 }));
    bob.read(frame, 1);
    expect(() => bob.read(frame, 1)).toThrow(/replay/);
  });

  it('refuses a body that is not valid JSON', () => {
    const alice = make('//Alice//agent');
    const bob = make('//Bob//agent');
    const m = alice.compose(bob.address, 'Ping', {}, { expiresAtBlock: 5 });
    const raw = alice.composeBytes(bob.address, 'Ping', new Uint8Array([0xff]), { expiresAtBlock: 5, nonce: m.envelope.nonce + 1n });
    expect(() => bob.read(encodeSignedMessage(raw), 1)).toThrow(/JSON/);
  });
});

describe('worked example: Offer → Accept → DeliveryNotice', () => {
  it('runs end to end offline and rejects the replay it attempts', async () => {
    const lines: string[] = [];
    const result = await runMessagingDemo((l) => lines.push(l));
    expect(result.steps).toEqual(['Offer', 'Accept', 'DeliveryNotice']);
    expect(result.replayRejected).toBe(true);
    expect(result.agreementTermsHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(lines.join('\n')).toContain('replay rejected');
  });
});
