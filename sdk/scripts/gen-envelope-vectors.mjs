// Regenerate tests/vectors/envelope.json from the built SDK (npm run vectors).
//
// Keys are the public Substrate dev accounts (//Alice, //Bob, //Charlie), so the
// file holds no secret. sr25519 signatures and seals are randomised, so those
// entries are samples that must *verify*; every other field is deterministic
// and tests/vectors.test.ts recomputes it byte for byte.
import { writeFileSync } from 'node:fs';
import { Keyring } from '@polkadot/keyring';
import { stringToU8a, u8aToHex } from '@polkadot/util';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  createMessage,
  deriveMessagingKey,
  encodeEnvelope,
  encodeFrame,
  envelopeSigningPayload,
  sealTo,
} from '../dist/index.js';

await cryptoWaitReady();
const kr = new Keyring({ type: 'sr25519', ss58Format: 42 });
const alice = kr.addFromUri('//Alice');
const bob = kr.addFromUri('//Bob');
const charlie = kr.addFromUri('//Charlie');
// A fixed, labelled test genesis. Real messages use the chain's genesis hash.
const genesisHash = u8aToHex(new Uint8Array(32).fill(0x5c));
const bobKey = deriveMessagingKey('//Bob');

const cases = [
  { name: 'offer-plain', signer: alice, signerUri: '//Alice', to: bob, kind: 'Offer', agreement: null, nonce: 1n, expiresAtBlock: 1_000, payload: stringToU8a('{"offer":"10 CMN","deliverWithin":600}') },
  { name: 'accept-with-agreement', signer: bob, signerUri: '//Bob', to: alice, kind: 'Accept', agreement: { account: alice.address, seq: 3 }, nonce: 1_700_000_000_000_000n, expiresAtBlock: 4_294_967_295, payload: stringToU8a('{"accept":true}') },
  { name: 'delivery-notice-sealed', signer: alice, signerUri: '//Alice', to: bob, kind: 'DeliveryNotice', agreement: { account: alice.address, seq: 0 }, nonce: 2n, expiresAtBlock: 1_200, payload: sealTo(stringToU8a('{"report":"0x11"}'), bobKey.publicKey) },
  { name: 'ping-empty-payload', signer: charlie, signerUri: '//Charlie', to: alice, kind: 'Ping', agreement: null, nonce: 18_446_744_073_709_551_615n, expiresAtBlock: 0, payload: new Uint8Array() },
];

const vectors = {
  description: 'Scalar Commons spec-308 signed envelope test vectors. See docs/reference/messaging.md.',
  generator: 'sdk/scripts/gen-envelope-vectors.mjs',
  signingDomain: 'ScalarMsg/v1|',
  genesisHash,
  ss58Format: 42,
  envelopes: cases.map((c) => {
    const m = createMessage(c.signer, { ...c, to: c.to.address, genesisHash });
    return {
      name: c.name,
      signerUri: c.signerUri,
      input: {
        from: c.signer.address,
        to: c.to.address,
        kind: c.kind,
        agreement: c.agreement,
        nonce: c.nonce.toString(),
        expiresAtBlock: c.expiresAtBlock,
        payload: u8aToHex(c.payload),
      },
      expected: {
        payloadHash: u8aToHex(m.envelope.payloadHash),
        scale: u8aToHex(encodeEnvelope(m.envelope)),
        signingPayload: u8aToHex(envelopeSigningPayload(m.envelope, genesisHash)),
      },
      sample: { signature: u8aToHex(m.signature), frame: u8aToHex(encodeFrame(m)) },
    };
  }),
  messagingKeys: [
    { suri: '//Alice', rotation: 0 },
    { suri: '//Bob', rotation: 0 },
    { suri: '//Bob', rotation: 1 },
  ].map((k) => ({ ...k, publicKey: u8aToHex(deriveMessagingKey(k.suri, { rotation: k.rotation }).publicKey) })),
  sealed: {
    recipientUri: '//Bob',
    plaintext: u8aToHex(stringToU8a('sealed to Bob')),
    sample: u8aToHex(sealTo(stringToU8a('sealed to Bob'), bobKey.publicKey)),
  },
};

const path = new URL('../tests/vectors/envelope.json', import.meta.url);
writeFileSync(path, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${vectors.envelopes.length} envelope vectors to ${path.pathname}`);
