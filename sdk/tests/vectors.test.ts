import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hexToU8a, u8aToHex } from '@polkadot/util';
import { blake2AsU8a, cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';

import {
  MessageInbox,
  decodeFrame,
  deriveMessagingKey,
  encodeEnvelope,
  envelopeSigningPayload,
  openSealed,
  type Envelope,
  type MessageKind,
} from '../src/index.js';

/**
 * Re-verifies the committed vectors (tests/vectors/envelope.json) on every CI
 * run. Deterministic fields are recomputed byte for byte; the randomised sr25519
 * signatures and seals must verify / open. A change to the encoding, the
 * signing payload or the key derivation turns this red — which is the point:
 * other implementations are built against these bytes.
 */
interface Vector {
  name: string;
  input: {
    from: string;
    to: string;
    kind: MessageKind;
    agreement: { account: string; seq: number } | null;
    nonce: string;
    expiresAtBlock: number;
    payload: string;
  };
  expected: { payloadHash: string; scale: string; signingPayload: string };
  sample: { signature: string; frame: string };
}
const file = JSON.parse(readFileSync(new URL('./vectors/envelope.json', import.meta.url), 'utf8')) as {
  genesisHash: string;
  signingDomain: string;
  envelopes: Vector[];
  messagingKeys: { suri: string; rotation: number; publicKey: string }[];
  sealed: { recipientUri: string; plaintext: string; sample: string };
};

beforeAll(async () => {
  await cryptoWaitReady();
});

function envelopeOf(v: Vector): Envelope {
  const payload = hexToU8a(v.input.payload);
  return {
    version: 1,
    from: decodeAddress(v.input.from),
    to: decodeAddress(v.input.to),
    kind: v.input.kind,
    agreement: v.input.agreement
      ? { account: decodeAddress(v.input.agreement.account), seq: v.input.agreement.seq }
      : null,
    nonce: BigInt(v.input.nonce),
    expiresAtBlock: v.input.expiresAtBlock,
    payloadHash: blake2AsU8a(payload, 256),
  };
}

describe('envelope vectors', () => {
  it('cover every shape the spec allows', () => {
    expect(file.signingDomain).toBe('ScalarMsg/v1|');
    expect(file.envelopes.length).toBeGreaterThanOrEqual(4);
    expect(file.envelopes.some((v) => v.input.agreement !== null)).toBe(true);
    expect(file.envelopes.some((v) => v.input.agreement === null)).toBe(true);
  });

  for (const v of file.envelopes) {
    describe(v.name, () => {
      it('recomputes payload hash, SCALE bytes and signing payload exactly', () => {
        const e = envelopeOf(v);
        expect(u8aToHex(e.payloadHash)).toBe(v.expected.payloadHash);
        expect(u8aToHex(encodeEnvelope(e))).toBe(v.expected.scale);
        expect(u8aToHex(envelopeSigningPayload(e, file.genesisHash))).toBe(v.expected.signingPayload);
      });

      it('sample frame decodes to the same envelope and passes every verification rule', () => {
        const frame = hexToU8a(v.sample.frame);
        expect(decodeFrame(frame).envelope).toEqual(envelopeOf(v));
        expect(u8aToHex(decodeFrame(frame).signature)).toBe(v.sample.signature);
        const inbox = new MessageInbox({ self: v.input.to, genesisHash: file.genesisHash });
        const got = inbox.receive(frame, v.input.expiresAtBlock, { origin: v.input.from });
        expect(got.from).toBe(v.input.from);
        expect(u8aToHex(got.payload)).toBe(v.input.payload);
      });
    });
  }

  it('messaging keys derive exactly', () => {
    for (const k of file.messagingKeys) {
      expect(u8aToHex(deriveMessagingKey(k.suri, { rotation: k.rotation }).publicKey), `${k.suri}#${k.rotation}`).toBe(
        k.publicKey,
      );
    }
  });

  it('sealed samples open with the recipient key', () => {
    const key = deriveMessagingKey(file.sealed.recipientUri);
    expect(u8aToHex(openSealed(hexToU8a(file.sealed.sample), key))).toBe(file.sealed.plaintext);
    const notice = file.envelopes.find((v) => v.name === 'delivery-notice-sealed')!;
    expect(new TextDecoder().decode(openSealed(hexToU8a(notice.input.payload), key))).toBe('{"report":"0x11"}');
  });
});
