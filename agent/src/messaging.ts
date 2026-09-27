import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { hexToU8a, stringToU8a, u8aToHex } from '@polkadot/util';
import {
  MessageInbox,
  MessageRejected,
  NonceTracker,
  OutboundNonces,
  createMessage,
  deriveMessagingKey,
  openSealed,
  sealTo,
  type MessageKind,
  type MessagingKeypair,
  type SignedMessage,
} from '@scalar-commons/sdk';

export interface MessengerOptions {
  /** Chain genesis hash (`0x…`): signatures are only valid on this chain. */
  genesisHash: string;
  /** Messaging key rotation index; bump it and republish to rotate. */
  rotation?: number;
  /** Persisted receive-side nonce state (see `NonceTracker.toJSON`). */
  nonces?: NonceTracker;
}

export interface ComposeOptions {
  /** Last block the message is valid at. Keep it short: stale offers should die. */
  expiresAtBlock: number;
  /** Recipient's published messaging key (`0x…`); when set, the body is sealed to it. */
  recipientKey?: string;
  agreement?: { account: string; seq: number } | null;
  /** Override the sender nonce (tests, or a caller that persists its own). */
  nonce?: bigint;
}

export interface ReadMessage {
  from: string;
  kind: MessageKind;
  /** Parsed JSON body. */
  body: unknown;
  /** blake2_256 of the delivered payload, as committed in the envelope. */
  payloadHash: string;
  agreement: { account: Uint8Array; seq: number } | null;
}

/**
 * The reference agent's messaging surface: one agent secret yields both the
 * sr25519 account that signs envelopes and the X25519 key others encrypt to.
 *
 * Bodies are JSON. `compose` → a signed message any transport can carry;
 * `read` → every spec-308 verification rule, then decryption, then parsing.
 * Nothing in a body is trusted before `read` returns.
 */
export class AgentMessenger {
  readonly pair: KeyringPair;
  private readonly key: MessagingKeypair;
  private readonly outbound = new OutboundNonces();
  private readonly inbox: MessageInbox;

  constructor(
    secret: string,
    private readonly opts: MessengerOptions,
  ) {
    this.pair = new Keyring({ type: 'sr25519' }).addFromUri(secret);
    this.key = deriveMessagingKey(secret, { rotation: opts.rotation ?? 0 });
    this.inbox = new MessageInbox({ self: this.pair.address, genesisHash: opts.genesisHash, nonces: opts.nonces });
  }

  get address(): string {
    return this.pair.address;
  }

  /** The key to publish with `agents.setMessagingKey`. */
  get messagingPublicKey(): string {
    return u8aToHex(this.key.publicKey);
  }

  /** Receive-side nonce state, to persist across restarts. */
  get nonces(): NonceTracker {
    return this.inbox.nonces;
  }

  /** Build and sign a message with a JSON body. */
  compose(to: string, kind: MessageKind, body: unknown, opts: ComposeOptions): SignedMessage {
    return this.composeBytes(to, kind, stringToU8a(JSON.stringify(body)), opts);
  }

  /** Build and sign a message with a raw body. */
  composeBytes(to: string, kind: MessageKind, body: Uint8Array, opts: ComposeOptions): SignedMessage {
    const payload = opts.recipientKey ? sealTo(body, hexToU8a(opts.recipientKey)) : body;
    return createMessage(this.pair, {
      to,
      kind,
      payload,
      nonce: opts.nonce ?? this.outbound.next(to),
      expiresAtBlock: opts.expiresAtBlock,
      genesisHash: this.opts.genesisHash,
      agreement: opts.agreement ?? null,
    });
  }

  /**
   * Verify, decrypt (when `sealed`) and parse a received frame.
   * `origin` is the on-chain extrinsic signer for frames read from blocks.
   */
  read(
    frame: Uint8Array,
    bestBlock: number | bigint,
    opts: { sealed?: boolean; origin?: string; detachedPayload?: Uint8Array } = {},
  ): ReadMessage {
    const m = this.inbox.receive(frame, bestBlock, { origin: opts.origin, detachedPayload: opts.detachedPayload });
    const bytes = opts.sealed ? openSealed(m.payload, this.key) : m.payload;
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (err) {
      throw new MessageRejected('malformed', `body is not UTF-8 JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {
      from: m.from,
      kind: m.kind,
      body,
      payloadHash: u8aToHex(m.envelope.payloadHash),
      agreement: m.envelope.agreement,
    };
  }
}
