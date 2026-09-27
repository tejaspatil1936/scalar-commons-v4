import { pathToFileURL } from 'node:url';
import { u8aToHex } from '@polkadot/util';
import { blake2AsU8a, cryptoWaitReady } from '@polkadot/util-crypto';
import { MessageRejected, encodeFrame } from '@scalar-commons/sdk';
import { AgentMessenger } from './messaging.js';

/**
 * Worked example — a buyer and a provider negotiate with signed, encrypted
 * spec-308 envelopes, fully offline:
 *
 *   node dist/message-demo.js
 *
 * 1. Both derive their X25519 messaging keys from their agent secrets (on a
 *    live chain they would publish them with `agents.setMessagingKey`).
 * 2. The buyer sends an Offer sealed to the provider's key.
 * 3. The provider verifies, decrypts, and replies Accept, quoting the offer's
 *    envelope `payload_hash` — the value the buyer then uses as the escrow
 *    `deliverableHash`, so the agreement commits to exactly the signed terms
 *    both parties hold.
 * 4. After delivery the provider sends a DeliveryNotice bound to the agreement.
 * 5. Someone re-sends the Offer frame: the provider's inbox rejects it.
 *
 * "Transport" here is handing `encodeFrame(...)` bytes across; on a live chain
 * the same bytes go through `OnChainTransport` / `subscribeMessages`, or
 * `HttpsTransport`, unchanged.
 */

/** A labelled stand-in genesis hash; real messages use the chain's. */
const DEMO_GENESIS = `0x${'5c'.repeat(32)}`;

export interface DemoResult {
  steps: string[];
  agreementTermsHash: string;
  replayRejected: boolean;
}

export async function runMessagingDemo(log: (line: string) => void = console.log): Promise<DemoResult> {
  await cryptoWaitReady();
  // Public dev derivations: this example never touches a real key.
  const buyer = new AgentMessenger('//Alice//demo-buyer', { genesisHash: DEMO_GENESIS });
  const provider = new AgentMessenger('//Bob//demo-provider', { genesisHash: DEMO_GENESIS });
  log(`buyer    ${buyer.address}  messaging key ${buyer.messagingPublicKey}`);
  log(`provider ${provider.address}  messaging key ${provider.messagingPublicKey}`);

  let best = 100;
  const steps: string[] = [];

  // 2. Offer, sealed to the provider.
  const terms = { task: 'ECB EUR/USD reference rate for 2026-09-25', price: '10 CMN', deliverWithin: 600 };
  const offerFrame = encodeFrame(
    buyer.compose(provider.address, 'Offer', terms, { recipientKey: provider.messagingPublicKey, expiresAtBlock: best + 50 }),
  );
  log(`buyer → provider  Offer (${offerFrame.length} bytes on the wire, body sealed)`);
  const offer = provider.read(offerFrame, best, { sealed: true });
  steps.push(offer.kind);
  log(`provider verified Offer from ${offer.from}: ${JSON.stringify(offer.body)}`);

  // 3. Accept, quoting the Offer's payload_hash: that is the escrow deliverable.
  const agreementTermsHash = offer.payloadHash;
  best += 1;
  const acceptFrame = encodeFrame(
    provider.compose(buyer.address, 'Accept', { offerPayloadHash: agreementTermsHash }, {
      recipientKey: buyer.messagingPublicKey,
      expiresAtBlock: best + 50,
    }),
  );
  const accept = buyer.read(acceptFrame, best, { sealed: true });
  steps.push(accept.kind);
  log(`buyer verified Accept; escrow.createAgreement(deliverableHash = ${agreementTermsHash})`);

  // 4. DeliveryNotice bound to the (buyer, seq) agreement the buyer opened.
  best += 20;
  const reportHash = u8aToHex(blake2AsU8a(new TextEncoder().encode('1.1167'), 256));
  const noticeFrame = encodeFrame(
    provider.compose(buyer.address, 'DeliveryNotice', { reportHash }, {
      recipientKey: buyer.messagingPublicKey,
      expiresAtBlock: best + 50,
      agreement: { account: buyer.address, seq: 0 },
    }),
  );
  const notice = buyer.read(noticeFrame, best, { sealed: true });
  steps.push(notice.kind);
  log(`buyer verified DeliveryNotice for agreement seq ${notice.agreement?.seq}: ${JSON.stringify(notice.body)}`);

  // 5. Replay of the original Offer.
  let replayRejected = false;
  try {
    provider.read(offerFrame, best, { sealed: true });
  } catch (err) {
    if (!(err instanceof MessageRejected)) throw err;
    replayRejected = true;
    log(`provider: replay rejected (${err.reason})`);
  }
  return { steps, agreementTermsHash, replayRejected };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runMessagingDemo().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
