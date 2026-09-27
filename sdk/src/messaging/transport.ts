/**
 * Transport bindings for signed envelopes (docs/reference/messaging.md §5).
 *
 * A transport only moves frames. It never decides whether a message is valid:
 * every frame, however it arrived, goes through `MessageInbox.receive`.
 *
 * (a) on-chain  — `pallet-messages::send`, frame inline (≤ 2 KiB) or hash-only;
 * (b) HTTPS     — POST of the frame to the recipient's registered service URI;
 * (c) statement store — not bound here until the spike's verdict is in.
 */
import type { KeyringPair } from '@polkadot/keyring/types';
import { u8aEq, u8aToHex } from '@polkadot/util';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

import type { SubmitResult } from '../submit.js';
import { MAX_ONCHAIN_PAYLOAD, encodeFrame, type MessageKind, type SignedMessage } from './envelope.js';

/** Anything that can carry a signed message to its recipient. */
export interface Transport {
  send(message: SignedMessage): Promise<unknown>;
}

/** The arguments of `messages.send`, as polkadot-js accepts them. */
export interface SendMessageArgs {
  to: string;
  kind: MessageKind;
  agreement: [string, number] | null;
  payloadHash: string;
  payload: string;
}

/** The client surface the on-chain transport needs (implemented by `ScalarCommonsClient`). */
export interface MessageSubmitter {
  sendMessage(signer: KeyringPair, args: SendMessageArgs): Promise<SubmitResult>;
}

/**
 * Binding (a): put the frame on chain with `messages.send`.
 *
 * `inline: false` sends a hash-only frame (envelope + signature, no payload):
 * the chain carries the commitment and the recipient receives the payload by
 * another path and passes it as `detachedPayload`.
 *
 * Both guards run before signing: the chain rejects frames above 2 KiB, and a
 * frame signed on chain by an account other than the envelope sender would be
 * refused by every recipient (`origin-mismatch`). Either way the fee is burnt
 * for nothing.
 */
export class OnChainTransport implements Transport {
  constructor(
    private readonly client: MessageSubmitter,
    private readonly signer: KeyringPair,
    private readonly ss58Format = 42,
  ) {}

  async send(message: SignedMessage, opts: { inline?: boolean } = {}): Promise<SubmitResult> {
    const inline = opts.inline ?? true;
    if (!u8aEq(this.signer.publicKey, message.envelope.from)) {
      throw new Error('on-chain signer is not the envelope sender; recipients would reject it as origin-mismatch');
    }
    const frame = encodeFrame(inline ? message : { ...message, payload: new Uint8Array() });
    if (frame.length > MAX_ONCHAIN_PAYLOAD) {
      throw new Error(
        `frame is ${frame.length} bytes, pallet-messages accepts at most ${MAX_ONCHAIN_PAYLOAD}; send hash-only ({ inline: false })`,
      );
    }
    const e = message.envelope;
    return this.client.sendMessage(this.signer, {
      to: encodeAddress(e.to, this.ss58Format),
      kind: e.kind,
      agreement: e.agreement ? [encodeAddress(e.agreement.account, this.ss58Format), e.agreement.seq] : null,
      payloadHash: u8aToHex(e.payloadHash),
      payload: u8aToHex(frame),
    });
  }
}

/** Looks up where to deliver: normally the recipient's registered service URI. */
export type UriResolver = (to: string) => string | Promise<string>;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Binding (b): POST the full frame (`application/octet-stream`) to the
 * recipient's service URI. Plain `http` is refused except on loopback, so a
 * frame is never sent in clear across a network by accident. A non-2xx answer
 * throws; the caller decides whether to retry (nonces make re-sending the same
 * frame harmless: the recipient rejects the duplicate as `replay`).
 */
export class HttpsTransport implements Transport {
  private readonly fetchImpl: typeof fetch;
  private readonly ss58: number;

  constructor(
    private readonly resolve: UriResolver,
    opts: { fetch?: typeof fetch; ss58Format?: number } = {},
  ) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.ss58 = opts.ss58Format ?? 42;
  }

  async send(message: SignedMessage): Promise<void> {
    const uri = await this.resolve(encodeAddress(message.envelope.to, this.ss58));
    const url = new URL(uri);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
      throw new Error(`refusing to deliver over ${url.protocol} to ${url.hostname}: https is required`);
    }
    const res = await this.fetchImpl(uri, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: encodeFrame(message),
    });
    if (!res.ok) throw new Error(`delivery to ${uri} failed: HTTP ${res.status}`);
  }
}

/** One frame addressed to the subscriber, as found in a finalized block. */
export interface InboundFrame {
  frame: Uint8Array;
  /** Extrinsic signer (`MessageSent.from`); pass as `origin` to `MessageInbox.receive`. */
  origin: string;
  blockNumber: number;
  blockHash: string;
  extrinsicIndex: number;
}

export interface SubscribeOptions {
  /** First block to scan; defaults to the first finalized head seen. */
  fromBlock?: number;
  /** Called for per-block failures and handler exceptions; the subscription carries on. */
  onError?: (err: Error) => void;
  ss58Format?: number;
}

interface Codecish {
  toString(): string;
}
interface ChainApi {
  rpc: {
    chain: {
      subscribeFinalizedHeads(cb: (h: { number: { toNumber(): number }; hash: unknown }) => void): Promise<() => void>;
      getBlockHash(n: number): Promise<{ toHex(): string }>;
      getBlock(hash: unknown): Promise<{
        block: {
          extrinsics: {
            method: { section: string; method: string; args: { toU8a(bare?: boolean): Uint8Array }[] };
            signer: Codecish;
          }[];
        };
      }>;
    };
  };
  at(hash: unknown): Promise<{
    query: {
      system: {
        events(): Promise<
          {
            phase: { isApplyExtrinsic: boolean; asApplyExtrinsic: { toNumber(): number } };
            event: { section: string; method: string; data: Codecish[] };
          }[]
        >;
      };
    };
  }>;
}

/**
 * Binding (a), receive side: watch finalized blocks for `messages.MessageSent`
 * addressed to `self` and hand each frame to `handler`.
 *
 * Why finalized and not best: a frame from a block that is later reorged out
 * would be acted on and then vanish. Finality notifications can skip blocks,
 * so every block between the last one scanned and the new head is fetched —
 * none is missed. The event carries only `payload_len`; the payload itself is
 * read from the `messages.send` extrinsic the event's phase points at, and that
 * extrinsic must be signed by the event's `from`.
 *
 * Frames are delivered unverified: run them through `MessageInbox.receive`
 * with `origin` set.
 */
export async function subscribeMessages(
  apiLike: unknown,
  self: string,
  handler: (f: InboundFrame) => void | Promise<void>,
  opts: SubscribeOptions = {},
): Promise<() => void> {
  const api = apiLike as ChainApi;
  const me = decodeAddress(self);
  const ss58 = opts.ss58Format ?? 42;
  const report = (err: unknown) => opts.onError?.(err instanceof Error ? err : new Error(String(err)));
  let next = opts.fromBlock;
  let queue = Promise.resolve();

  const scan = async (n: number) => {
    const hash = await api.rpc.chain.getBlockHash(n);
    const [block, at] = await Promise.all([api.rpc.chain.getBlock(hash), api.at(hash)]);
    const events = await at.query.system.events();
    for (const { phase, event } of events) {
      if (event.section !== 'messages' || event.method !== 'MessageSent' || !phase.isApplyExtrinsic) continue;
      const [from, to] = event.data;
      if (from === undefined || to === undefined || !u8aEq(decodeAddress(to.toString()), me)) continue;
      const index = phase.asApplyExtrinsic.toNumber();
      const ext = block.block.extrinsics[index];
      const origin = encodeAddress(decodeAddress(from.toString()), ss58);
      if (
        ext === undefined ||
        ext.method.section !== 'messages' ||
        ext.method.method !== 'send' ||
        !u8aEq(decodeAddress(ext.signer.toString()), decodeAddress(origin))
      ) {
        report(new Error(`block ${n}: MessageSent at extrinsic ${index} has no matching messages.send`));
        continue;
      }
      const payloadArg = ext.method.args[4];
      if (payloadArg === undefined) {
        report(new Error(`block ${n}: messages.send at extrinsic ${index} has no payload argument`));
        continue;
      }
      try {
        await handler({ frame: payloadArg.toU8a(true), origin, blockNumber: n, blockHash: hash.toHex(), extrinsicIndex: index });
      } catch (err) {
        report(err);
      }
    }
  };

  return api.rpc.chain.subscribeFinalizedHeads((header) => {
    const head = header.number.toNumber();
    queue = queue.then(async () => {
      for (let n = next ?? head; n <= head; n++) {
        try {
          await scan(n);
        } catch (err) {
          // Do not skip a block we could not read: stop here and retry it on
          // the next finalized head, so no message is silently lost.
          report(err);
          return;
        }
        next = n + 1;
      }
    });
  });
}
