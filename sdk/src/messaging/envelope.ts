/**
 * The spec-308 signed message envelope (docs/reference/messaging.md).
 *
 * Why an envelope at all, when `pallet-messages` already authenticates the
 * extrinsic signer: the same message must be verifiable when it arrives over
 * HTTPS or any other off-chain path, where there is no extrinsic. The envelope
 * is the transport-independent commitment — who, to whom, what kind, about
 * which agreement, which nonce, valid until when, and the hash of the exact
 * payload bytes — signed by the sender's account key.
 *
 * Mismatches between two agents' notions of "the same message" are made
 * impossible by construction: there is exactly one canonical encoding (SCALE of
 * a fixed struct), one signing payload, and the verifier recomputes both from
 * bytes it received rather than trusting any field it was told.
 */
import type { KeyringPair } from '@polkadot/keyring/types';
import { hexToU8a, isHex, stringToU8a, u8aConcat, u8aEq, u8aToHex } from '@polkadot/util';
import { blake2AsU8a, decodeAddress, encodeAddress, sr25519Verify } from '@polkadot/util-crypto';

/** Envelope format version this SDK produces and accepts. */
export const ENVELOPE_VERSION = 1;

/** Domain separator prepended to every signing payload (`b"ScalarMsg/v1|"`). */
export const SIGNING_DOMAIN = 'ScalarMsg/v1|';

/** Maximum `payload` bytes `pallet-messages::send` accepts (`BoundedVec<u8, ConstU32<2048>>`). */
export const MAX_ONCHAIN_PAYLOAD = 2048;

/** Length of an sr25519 signature. */
export const SIGNATURE_LENGTH = 64;

/**
 * Message kinds, in `pallet-messages::MessageKind` variant order: the index in
 * this array is the `kind: u8` in the envelope and the SCALE enum index on chain.
 */
export const MESSAGE_KINDS = [
  'Offer',
  'Bid',
  'Accept',
  'Reject',
  'DeliveryNotice',
  'DisputeNote',
  'Announce',
  'Ping',
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** An account given as SS58 / hex string, or as the raw 32-byte AccountId. */
export type AccountLike = string | Uint8Array;

/** Reference to an escrow agreement: `(AccountId, u32)` as `pallet-messages` names it. */
export interface AgreementRef {
  account: Uint8Array;
  seq: number;
}

/** The fixed envelope struct. All account and hash fields are raw 32-byte values. */
export interface Envelope {
  version: number;
  from: Uint8Array;
  to: Uint8Array;
  kind: MessageKind;
  agreement: AgreementRef | null;
  /** Strictly increasing per (from, to) pair; u64. */
  nonce: bigint;
  /** Last block at which the message is still valid; u32. */
  expiresAtBlock: number;
  /** blake2_256 of the delivered payload bytes. */
  payloadHash: Uint8Array;
}

/** An envelope, its sr25519 signature, and the payload it commits to. */
export interface SignedMessage {
  envelope: Envelope;
  signature: Uint8Array;
  /** The delivered payload (ciphertext when sealed). Empty in a hash-only frame. */
  payload: Uint8Array;
}

/** Why a message was refused. Stable strings: log them, branch on them. */
export type RejectReason =
  | 'malformed'
  | 'unsupported-version'
  | 'bad-signature'
  | 'wrong-recipient'
  | 'origin-mismatch'
  | 'expired'
  | 'payload-hash-mismatch'
  | 'replay'
  | 'decrypt-failed';

/** A message that failed a verification rule. Nothing about it may be acted on. */
export class MessageRejected extends Error {
  constructor(
    readonly reason: RejectReason,
    detail: string,
  ) {
    super(`message rejected (${reason}): ${detail}`);
    this.name = 'MessageRejected';
  }
}

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffff_ffff;

/** Resolve an {@link AccountLike} to its 32-byte AccountId. */
export function toAccountId(who: AccountLike, what = 'account'): Uint8Array {
  const bytes = typeof who === 'string' ? decodeAddress(who) : who;
  if (bytes.length !== 32) throw new Error(`${what} must be a 32-byte AccountId, got ${bytes.length} bytes`);
  return bytes;
}

function need32(bytes: Uint8Array, what: string): Uint8Array {
  if (bytes.length !== 32) throw new Error(`${what} must be 32 bytes, got ${bytes.length}`);
  return bytes;
}

function u32le(n: number, what: string): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > U32_MAX) throw new Error(`${what} must be a u32, got ${n}`);
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

function u64le(n: bigint, what: string): Uint8Array {
  if (n < 0n || n > U64_MAX) throw new Error(`${what} must be a u64, got ${n}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
}

/**
 * Canonical SCALE encoding of the envelope struct, field by field:
 * `u8 | [u8;32] | [u8;32] | u8 | Option<([u8;32], u32)> | u64 | u32 | [u8;32]`.
 * 111 bytes without an agreement, 147 with one.
 */
export function encodeEnvelope(e: Envelope): Uint8Array {
  const kind = MESSAGE_KINDS.indexOf(e.kind);
  if (kind < 0) throw new Error(`unknown message kind ${String(e.kind)}`);
  if (!Number.isInteger(e.version) || e.version < 0 || e.version > 0xff) {
    throw new Error(`version must be a u8, got ${e.version}`);
  }
  const agreement = e.agreement
    ? u8aConcat([1], need32(e.agreement.account, 'agreement.account'), u32le(e.agreement.seq, 'agreement.seq'))
    : new Uint8Array([0]);
  return u8aConcat(
    [e.version],
    need32(e.from, 'from'),
    need32(e.to, 'to'),
    [kind],
    agreement,
    u64le(e.nonce, 'nonce'),
    u32le(e.expiresAtBlock, 'expiresAtBlock'),
    need32(e.payloadHash, 'payloadHash'),
  );
}

/** Decode an envelope from the start of `bytes`; `length` is how many bytes it used. */
export function decodeEnvelope(bytes: Uint8Array): { envelope: Envelope; length: number } {
  let at = 0;
  const take = (n: number): Uint8Array => {
    if (at + n > bytes.length) throw new Error(`envelope too short: need ${at + n} bytes, have ${bytes.length}`);
    const out = bytes.slice(at, at + n);
    at += n;
    return out;
  };
  const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

  const version = take(1)[0]!;
  const from = take(32);
  const to = take(32);
  const kindIndex = take(1)[0]!;
  const kind = MESSAGE_KINDS[kindIndex];
  if (kind === undefined) throw new Error(`unknown message kind index ${kindIndex}`);
  const tag = take(1)[0]!;
  let agreement: AgreementRef | null;
  if (tag === 0) agreement = null;
  else if (tag === 1) agreement = { account: take(32), seq: view(take(4)).getUint32(0, true) };
  else throw new Error(`invalid agreement Option tag ${tag}`);
  const nonce = view(take(8)).getBigUint64(0, true);
  const expiresAtBlock = view(take(4)).getUint32(0, true);
  const payloadHash = take(32);
  return { envelope: { version, from, to, kind, agreement, nonce, expiresAtBlock, payloadHash }, length: at };
}

/**
 * The bytes the sender signs: `b"ScalarMsg/v1|" ++ genesis_hash ++ blake2_256(SCALE(envelope))`.
 *
 * The genesis hash binds a signature to one chain, so a message from the
 * testnet cannot be replayed onto a later network. The domain prefix keeps
 * these bytes disjoint from anything else an account key signs (extrinsic
 * payloads start with a call index, not ASCII `S`).
 */
export function envelopeSigningPayload(e: Envelope, genesisHash: AccountLike): Uint8Array {
  if (typeof genesisHash === 'string' && !isHex(genesisHash)) throw new Error('genesis hash must be 0x-prefixed hex');
  const genesis = typeof genesisHash === 'string' ? hexToU8a(genesisHash) : genesisHash;
  if (genesis.length !== 32) throw new Error(`genesis hash must be 32 bytes, got ${genesis.length}`);
  return u8aConcat(stringToU8a(SIGNING_DOMAIN), genesis, blake2AsU8a(encodeEnvelope(e), 256));
}

/** Frame = `SCALE(envelope) ++ signature(64) ++ payload`. The payload is the rest of the bytes. */
export function encodeFrame(m: SignedMessage): Uint8Array {
  if (m.signature.length !== SIGNATURE_LENGTH) throw new Error('signature must be 64 bytes');
  return u8aConcat(encodeEnvelope(m.envelope), m.signature, m.payload);
}

/** Split a frame into envelope, signature and payload. Throws on malformed bytes. */
export function decodeFrame(frame: Uint8Array): SignedMessage {
  const { envelope, length } = decodeEnvelope(frame);
  if (frame.length < length + SIGNATURE_LENGTH) throw new Error('frame too short for a signature');
  return {
    envelope,
    signature: frame.slice(length, length + SIGNATURE_LENGTH),
    payload: frame.slice(length + SIGNATURE_LENGTH),
  };
}

/** What a sender supplies; `from` comes from the signing key. */
export interface MessageInput {
  to: AccountLike;
  kind: MessageKind;
  /** Delivered payload bytes (seal them first with `sealTo` for confidentiality). */
  payload: Uint8Array;
  nonce: bigint;
  expiresAtBlock: number;
  genesisHash: AccountLike;
  agreement?: { account: AccountLike; seq: number } | null;
}

/** The part of a keyring pair the signer needs. */
export type MessageSigner = Pick<KeyringPair, 'publicKey' | 'sign' | 'type'>;

/**
 * Build and sign a message. The sender is the signing account: there is no way
 * to produce an envelope whose `from` differs from the key that signed it.
 */
export function createMessage(signer: MessageSigner, input: MessageInput): SignedMessage {
  // The envelope signature is defined as sr25519; an ed25519/ecdsa pair would
  // produce a signature no verifier accepts, so fail before anything is sent.
  if (signer.type !== 'sr25519') throw new Error(`envelope signer must be sr25519, got ${signer.type}`);
  const envelope: Envelope = {
    version: ENVELOPE_VERSION,
    from: signer.publicKey,
    to: toAccountId(input.to, 'to'),
    kind: input.kind,
    agreement: input.agreement
      ? { account: toAccountId(input.agreement.account, 'agreement.account'), seq: input.agreement.seq }
      : null,
    nonce: input.nonce,
    expiresAtBlock: input.expiresAtBlock,
    payloadHash: blake2AsU8a(input.payload, 256),
  };
  const signature = signer.sign(envelopeSigningPayload(envelope, input.genesisHash));
  return { envelope, signature, payload: input.payload };
}

/**
 * Highest nonce accepted per (from, to) pair, as seen by one verifier.
 *
 * Persist it (`toJSON()` / constructor) across restarts: an in-memory-only
 * tracker forgets what it has seen and would accept a replay after a restart.
 */
export class NonceTracker {
  private readonly seen: Map<string, bigint>;

  constructor(saved: Record<string, string> = {}) {
    this.seen = new Map(Object.entries(saved).map(([k, v]) => [k, BigInt(v)]));
  }

  private static key(from: Uint8Array, to: Uint8Array): string {
    return `${u8aToHex(from)}:${u8aToHex(to)}`;
  }

  /** Whether `nonce` is strictly above everything accepted for this pair. */
  isFresh(from: Uint8Array, to: Uint8Array, nonce: bigint): boolean {
    const last = this.seen.get(NonceTracker.key(from, to));
    return last === undefined || nonce > last;
  }

  /** Record `nonce` as accepted. Call only after every other check passed. */
  commit(from: Uint8Array, to: Uint8Array, nonce: bigint): void {
    this.seen.set(NonceTracker.key(from, to), nonce);
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries([...this.seen].map(([k, v]) => [k, v.toString()]));
  }
}

/**
 * Sender-side nonces that stay strictly increasing per recipient across restarts
 * without persisted state: `max(last + 1, now_ms * 1000)`. A restarted sender
 * starts above anything it issued in an earlier millisecond, and a clock that
 * steps backwards never makes the sequence go down within one process.
 * Up to 1000 messages per millisecond per recipient stay collision-free.
 */
export class OutboundNonces {
  private readonly last = new Map<string, bigint>();

  constructor(private readonly nowMs: () => number = Date.now) {}

  next(to: AccountLike): bigint {
    const key = u8aToHex(toAccountId(to, 'to'));
    const floor = BigInt(Math.floor(this.nowMs())) * 1000n;
    const prev = this.last.get(key);
    const n = prev !== undefined && prev + 1n > floor ? prev + 1n : floor;
    this.last.set(key, n);
    return n;
  }
}

/** A message that passed every verification rule. */
export interface ReceivedMessage {
  /** Sender SS58 address (the verified signer). */
  from: string;
  kind: MessageKind;
  envelope: Envelope;
  /** Delivered payload bytes, already checked against `payload_hash`. */
  payload: Uint8Array;
  signature: Uint8Array;
}

export interface InboxOptions {
  /** The recipient: this inbox only accepts messages whose `to` is this account. */
  self: AccountLike;
  genesisHash: AccountLike;
  /** Shared/persisted nonce state; a fresh tracker is used if omitted. */
  nonces?: NonceTracker;
  /** SS58 prefix used for `from` in results (Scalar Commons: 42). */
  ss58Format?: number;
}

export interface ReceiveOptions {
  /**
   * For on-chain delivery: the extrinsic signer from `MessageSent.from`. The
   * envelope sender must be the account that paid to put it on chain.
   */
  origin?: AccountLike;
  /** Payload delivered separately from a hash-only frame (e.g. over HTTPS). */
  detachedPayload?: Uint8Array;
}

/**
 * The receive side: decode a frame and apply every verification rule, in a
 * fixed order, before anything about the message is trusted:
 *
 * 1. version is supported;
 * 2. `to` is this inbox's account;
 * 3. the on-chain origin (if any) equals `from`;
 * 4. the sr25519 signature over the signing payload verifies against `from`
 *    (so the signer must equal `from`, and the genesis hash must match);
 * 5. `expires_at_block >= bestBlock`;
 * 6. `blake2_256(payload) == payload_hash`;
 * 7. `nonce` is strictly above the last accepted nonce for (from, to).
 *
 * The nonce is committed only after all seven pass, so a rejected message
 * never burns a nonce the genuine sender still needs.
 */
export class MessageInbox {
  private readonly self: Uint8Array;
  private readonly genesis: AccountLike;
  readonly nonces: NonceTracker;
  private readonly ss58: number;

  constructor(opts: InboxOptions) {
    this.self = toAccountId(opts.self, 'self');
    this.genesis = opts.genesisHash;
    this.nonces = opts.nonces ?? new NonceTracker();
    this.ss58 = opts.ss58Format ?? 42;
  }

  receive(frame: Uint8Array, bestBlock: number | bigint, opts: ReceiveOptions = {}): ReceivedMessage {
    let m: SignedMessage;
    try {
      m = decodeFrame(frame);
    } catch (err) {
      throw new MessageRejected('malformed', err instanceof Error ? err.message : String(err));
    }
    const e = m.envelope;
    const payload = m.payload.length === 0 && opts.detachedPayload ? opts.detachedPayload : m.payload;

    if (e.version !== ENVELOPE_VERSION) {
      throw new MessageRejected('unsupported-version', `version ${e.version}, this SDK speaks ${ENVELOPE_VERSION}`);
    }
    if (!u8aEq(e.to, this.self)) throw new MessageRejected('wrong-recipient', 'envelope is addressed to another account');
    if (opts.origin !== undefined && !u8aEq(toAccountId(opts.origin, 'origin'), e.from)) {
      throw new MessageRejected('origin-mismatch', 'extrinsic signer is not the envelope sender');
    }
    let signed: boolean;
    try {
      signed = sr25519Verify(envelopeSigningPayload(e, this.genesis), m.signature, e.from);
    } catch {
      // A `from` that is not a valid sr25519 point throws instead of returning false.
      signed = false;
    }
    if (!signed) throw new MessageRejected('bad-signature', 'signature does not verify against `from` on this chain');
    if (BigInt(e.expiresAtBlock) < BigInt(bestBlock)) {
      throw new MessageRejected('expired', `expired at block ${e.expiresAtBlock}, best is ${bestBlock}`);
    }
    if (!u8aEq(blake2AsU8a(payload, 256), e.payloadHash)) {
      throw new MessageRejected('payload-hash-mismatch', 'blake2_256(payload) != payload_hash');
    }
    if (!this.nonces.isFresh(e.from, e.to, e.nonce)) {
      throw new MessageRejected('replay', `nonce ${e.nonce} is not above the last accepted nonce`);
    }
    this.nonces.commit(e.from, e.to, e.nonce);
    return { from: encodeAddress(e.from, this.ss58), kind: e.kind, envelope: e, payload, signature: m.signature };
  }
}
