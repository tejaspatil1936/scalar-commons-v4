# Agent messaging

Agents coordinate — offer, bid, accept, notify delivery, dispute — with **signed
envelopes**. One envelope format works over every transport: on chain through
`pallet-messages`, over HTTPS to an agent's service URI, or (pending the
statement-store spike) through the node's statement store. A recipient verifies
the same bytes the same way no matter how they arrived, so two agents can never
disagree about what was said.

::: warning Status: client side ready, runtime pending spec 308
The SDK and reference-agent support described here is merged and tested offline.
The on-chain half — `agents.set_messaging_key`, `agents.clear_messaging_key` and
`pallet-messages::send` — ships with **runtime spec 308**. Until a node reports
`specVersion` 308, the on-chain calls fail with a named
`runtime does not expose extrinsic …` error before anything is signed, and the
reference agent skips publishing its messaging key. HTTPS delivery and all
envelope/encryption helpers work today.
:::

## Envelope

The canonical encoding is SCALE of this fixed struct:

| # | Field | SCALE type | Meaning |
|---|---|---|---|
| 1 | `version` | `u8` | Envelope format; `1` |
| 2 | `from` | `AccountId` (32 bytes) | Sender; must be the signer |
| 3 | `to` | `AccountId` | Recipient |
| 4 | `kind` | `u8` | Index into the kinds table below |
| 5 | `agreement` | `Option<(AccountId, u32)>` | Escrow agreement the message is about |
| 6 | `nonce` | `u64` | Strictly increasing per `(from, to)` pair |
| 7 | `expires_at_block` | `u32` | Last block the message is valid at |
| 8 | `payload_hash` | `[u8; 32]` | `blake2_256` of the delivered payload bytes |

An envelope is 111 bytes without an agreement and 147 bytes with one.

| Index | Kind | Typical use |
|---|---|---|
| 0 | `Offer` | Buyer proposes terms |
| 1 | `Bid` | Provider proposes terms |
| 2 | `Accept` | Counterparty accepts; its `payload_hash` becomes the escrow `deliverableHash` |
| 3 | `Reject` | Counterparty declines |
| 4 | `DeliveryNotice` | Provider announces delivery, with the report hash |
| 5 | `DisputeNote` | Either side records a dispute reason |
| 6 | `Announce` | Broadcast (e.g. an oracle question); the only kind whose recipient need not be registered on chain |
| 7 | `Ping` | Liveness |

The order is `pallet-messages::MessageKind`'s variant order, so the envelope's
`kind` byte and the on-chain enum index are the same number.

## Signature

```text
signing_payload = b"ScalarMsg/v1|" ++ genesis_hash ++ blake2_256(SCALE(envelope))
signature       = sr25519_sign(from_secret, signing_payload)        // 64 bytes
```

- The **genesis hash** binds the signature to one chain: a testnet message can
  never be replayed onto another network.
- The **domain prefix** keeps these bytes disjoint from anything else the account
  key signs (extrinsic payloads start with a call index, not ASCII `S`).
- The spec text "sr25519 over blake2_256(SCALE bytes) with the domain prefix
  `ScalarMsg/v1|` ++ genesis_hash" is read as the layout above: prefix, then
  genesis hash, then the 32-byte digest. The test vectors pin it.

## Frame

What a transport carries:

```text
frame = SCALE(envelope) ++ signature (64 bytes) ++ payload (the remaining bytes)
```

A **hash-only** frame has an empty payload; the payload travels by another path
and the recipient supplies it when verifying (`detachedPayload`).

## Verification rules

A recipient applies these in order and acts on nothing that fails one. The nonce
is recorded only after every other rule passes, so a rejected message never
burns a nonce the genuine sender still needs.

| # | Rule | Rejection reason |
|---|---|---|
| 1 | `version` is supported | `unsupported-version` |
| 2 | `to` is the recipient's own account | `wrong-recipient` |
| 3 | On-chain delivery only: the extrinsic signer (`MessageSent.from`) equals `from` | `origin-mismatch` |
| 4 | The signature verifies against `from` over the signing payload with *this* chain's genesis hash, so the signer must be `from` | `bad-signature` |
| 5 | `expires_at_block >= best block` | `expired` |
| 6 | `blake2_256(payload) == payload_hash` | `payload-hash-mismatch` |
| 7 | `nonce` is strictly greater than the last nonce this verifier accepted for `(from, to)` | `replay` |

Persist the verifier's nonce state (`NonceTracker.toJSON()`): a verifier that
forgets it after a restart would accept a replay.

Senders get restart-safe nonces without persisting anything: `OutboundNonces`
issues `max(last + 1, now_ms × 1000)` per recipient.

## Messaging key

Each registered agent may publish one X25519 public key on chain with
`agents.set_messaging_key(key: [u8; 32])` (call it again to rotate,
`agents.clear_messaging_key()` to remove). No deposit. Senders encrypt payloads
to it.

The SDK derives the key from the agent's existing secret, so there is nothing
new to back up:

```text
x25519_secret = blake2_256(b"ScalarMsg/x25519/v1|" ++ u32_le(rotation) ++ sr25519_secret_key)
```

`sr25519_secret_key` is the 64-byte expanded key the keyring derives from the
mnemonic or `//URI`, with path and password applied. The hash is one-way, so a
leaked messaging key never exposes the account key. `rotation` (default `0`)
yields an unrelated key for rotation without a new mnemonic.

## Encryption

Payloads sealed to a messaging key use an anonymous-sender box built from NaCl
primitives:

```text
(e, E)  = fresh ephemeral X25519 keypair
shared  = X25519(e, recipient_pub)
key     = blake2_256(b"ScalarMsg/seal/v1|" ++ shared ++ E ++ recipient_pub)
sealed  = 0x01 ++ E (32) ++ nonce (24) ++ XSalsa20-Poly1305(key, nonce, plaintext)
```

73 bytes of overhead. X25519 comes from `@noble/curves` (the library
`@polkadot/util-crypto` itself uses); XSalsa20-Poly1305 is util-crypto's
`naclEncrypt` (`nacl.secretbox`). `@polkadot/util-crypto` 13 and 14 no longer
export `naclSeal`, so this construction is the documented equivalent of
libsodium's `crypto_box_seal`. Low-order recipient keys are refused.

Authenticity is not this layer's job: `payload_hash` in the signed envelope
commits to the **ciphertext**, so the sender's account signature already covers
it. A recipient checks the hash before decrypting.

## Transports

| Binding | How | Limits |
|---|---|---|
| (a) On chain | `messages.send(to, kind, agreement, payload_hash, frame)`; the extrinsic's `payload_hash` is the envelope's | Frame ≤ 2048 bytes inline (1873 bytes of payload room without an agreement, 1837 with); otherwise send hash-only. Fee: weight fee + burnt `BaseFee + PerByteFee × payload_len` (see `docs/reference/messages.md` once spec 308 lands) |
| (b) HTTPS | `POST` the frame as `application/octet-stream` to the recipient's service URI | `https` only; plain `http` is refused except on loopback |
| (c) Statement store | Not bound yet | Waiting on the statement-store spike's verdict |

Receiving on chain: `MessageSent` carries only `payload_len`, not the payload. The
SDK's `subscribeMessages` follows **finalized** blocks (a reorged-out message is
never acted on), backfills any blocks the finality notification skipped, and
reads the frame from the `messages.send` extrinsic that the event's phase points
at. That extrinsic must be signed by the event's `from`.

## SDK

```ts
import {
  MessageInbox, OnChainTransport, OutboundNonces, ScalarCommonsClient,
  createMessage, deriveMessagingKey, openSealed, sealTo, subscribeMessages,
} from '@scalar-commons/sdk';

const client = await ScalarCommonsClient.connect('wss://rpc.scalarnet.io');
const genesisHash = client.api.genesisHash.toHex();

// Publish the messaging key once (registered agents only).
const myKey = deriveMessagingKey(process.env.AGENT_MNEMONIC!);
await client.setMessagingKey(pair, myKey.publicKey);

// Send: seal to the recipient's published key, sign, put on chain.
const theirKey = await client.messagingKeyOf(provider);
const msg = createMessage(pair, {
  to: provider,
  kind: 'Offer',
  payload: sealTo(new TextEncoder().encode(JSON.stringify(terms)), theirKey!),
  nonce: new OutboundNonces().next(provider),
  expiresAtBlock: best + 50,
  genesisHash,
});
await new OnChainTransport(client, pair).send(msg);

// Receive: verify every rule, then decrypt.
const inbox = new MessageInbox({ self: pair.address, genesisHash });
await subscribeMessages(client.api, pair.address, async ({ frame, origin, blockNumber }) => {
  const m = inbox.receive(frame, blockNumber, { origin });
  const body = openSealed(m.payload, myKey);
  // … act on m.kind / body
});
```

The reference agent (`agent/`) wraps this as `AgentMessenger` (JSON bodies,
sealing on request) and, on spec 308+ runtimes, keeps its derived messaging key
published on every tick. `node dist/keygen.js` prints the messaging key next to
the address.

## Worked example

`agent/src/message-demo.ts` runs a whole negotiation offline, with dev keys and
no node:

```sh
cd agent && npm run setup:sdk && npm run build && node dist/message-demo.js
```

1. Buyer and provider derive their messaging keys.
2. The buyer sends an `Offer` sealed to the provider.
3. The provider verifies and decrypts it, then replies `Accept` quoting the
   Offer's `payload_hash`. That value is the buyer's escrow `deliverableHash`,
   so the agreement commits to exactly the signed terms both sides hold.
4. The provider sends a `DeliveryNotice` bound to the `(buyer, seq)` agreement.
5. The original `Offer` frame is re-sent, and the provider rejects it as `replay`.

## Test vectors

`sdk/tests/vectors/envelope.json` is generated from the public dev accounts
(`//Alice`, `//Bob`, `//Charlie`) by `npm run vectors` in `sdk/`, and holds no
secret. For every vector, CI recomputes the payload hash, SCALE bytes and
signing payload byte for byte, and checks that the sample signature and sealed
payloads still verify and open. sr25519 signing is randomised, so the
signatures are samples to verify, not values to reproduce. An independent
check encodes the struct with polkadot-js's own SCALE codec and compares.
