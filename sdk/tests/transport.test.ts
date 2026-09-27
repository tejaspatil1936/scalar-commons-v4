import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { stringToU8a, u8aToHex } from '@polkadot/util';
import { cryptoWaitReady } from '@polkadot/util-crypto';

import {
  HttpsTransport,
  MAX_ONCHAIN_PAYLOAD,
  OnChainTransport,
  ScalarCommonsClient,
  createMessage,
  encodeFrame,
  subscribeMessages,
  type InboundFrame,
} from '../src/index.js';

/**
 * Offline tests for the transport bindings. The chain is a hand-rolled mock of
 * the few polkadot-js surfaces the bindings touch; nothing connects anywhere.
 */

const GENESIS = new Uint8Array(32).fill(0x42);
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

const message = (payload = stringToU8a('hello'), over: Record<string, unknown> = {}) =>
  createMessage(alice, {
    to: bob.address,
    kind: 'Offer',
    payload,
    nonce: 1n,
    expiresAtBlock: 100,
    genesisHash: GENESIS,
    ...over,
  });

// ─── A mock api with messages.send / agents.setMessagingKey ────────────────

function txApi() {
  const calls: { section: string; method: string; args: unknown[] }[] = [];
  const makeTx = (section: string, method: string) => (...args: unknown[]) => {
    calls.push({ section, method, args });
    return {
      signAndSend: (_s: unknown, cb: (r: unknown) => void) => {
        cb({
          status: { isInBlock: true, asInBlock: { toHex: () => '0xblock' }, type: 'InBlock' },
          dispatchError: undefined,
          txHash: { toHex: () => '0xtx' },
        });
        return Promise.resolve(() => {});
      },
    };
  };
  const api = {
    tx: {
      messages: { send: makeTx('messages', 'send') },
      agents: {
        setMessagingKey: makeTx('agents', 'setMessagingKey'),
        clearMessagingKey: makeTx('agents', 'clearMessagingKey'),
      },
    },
    query: {
      agents: {
        messagingKey: async (who: string) =>
          who === bob.address
            ? { isSome: true, unwrap: () => ({ toU8a: () => new Uint8Array(32).fill(7) }) }
            : { isSome: false },
      },
    },
    registry: { findMetaError: () => ({ section: 'x', name: 'y', docs: [] }) },
  };
  return { client: new ScalarCommonsClient(api as never, { retryDelayMs: 0 }), calls };
}

describe('ScalarCommonsClient messaging extrinsics', () => {
  it('maps set/clear messaging key and reads the registered key', async () => {
    const { client, calls } = txApi();
    const key = new Uint8Array(32).fill(9);
    await client.setMessagingKey(alice, key);
    await client.clearMessagingKey(alice);
    expect(calls.map((c) => `${c.section}.${c.method}`)).toEqual(['agents.setMessagingKey', 'agents.clearMessagingKey']);
    expect(calls[0]!.args).toEqual([u8aToHex(key)]);
    expect(u8aToHex((await client.messagingKeyOf(bob.address))!)).toBe(u8aToHex(new Uint8Array(32).fill(7)));
    expect(await client.messagingKeyOf(carol.address)).toBeNull();
  });

  it('refuses a messaging key that is not 32 bytes before submitting', async () => {
    const { client, calls } = txApi();
    await expect(client.setMessagingKey(alice, new Uint8Array(31))).rejects.toThrow(/32 bytes/);
    expect(calls).toEqual([]);
  });
});

describe('OnChainTransport', () => {
  it('submits messages.send(to, kind, agreement, payload_hash, frame)', async () => {
    const { client, calls } = txApi();
    const m = message(stringToU8a('hello'), { agreement: { account: alice.address, seq: 4 } });
    const res = await new OnChainTransport(client, alice).send(m);
    expect(res.txHash).toBe('0xtx');
    expect(calls).toHaveLength(1);
    const [to, kind, agreement, payloadHash, frame] = calls[0]!.args as [string, string, unknown, string, string];
    expect(to).toBe(bob.address);
    expect(kind).toBe('Offer');
    expect(agreement).toEqual([alice.address, 4]);
    expect(payloadHash).toBe(u8aToHex(m.envelope.payloadHash));
    expect(frame).toBe(u8aToHex(encodeFrame(m)));
  });

  it('sends only envelope + signature in hash-only mode', async () => {
    const { client, calls } = txApi();
    const m = message(new Uint8Array(5_000));
    await new OnChainTransport(client, alice).send(m, { inline: false });
    expect((calls[0]!.args[4] as string).length).toBe(2 + 2 * (111 + 64));
  });

  it('refuses an inline frame above 2 KiB before paying a fee', async () => {
    const { client, calls } = txApi();
    const room = MAX_ONCHAIN_PAYLOAD - 111 - 64;
    await expect(new OnChainTransport(client, alice).send(message(new Uint8Array(room)))).resolves.toBeTruthy();
    await expect(new OnChainTransport(client, alice).send(message(new Uint8Array(room + 1)))).rejects.toThrow(
      /2048/,
    );
    expect(calls).toHaveLength(1);
  });

  it('refuses to sign the extrinsic with an account other than the envelope sender', async () => {
    const { client, calls } = txApi();
    await expect(new OnChainTransport(client, carol).send(message())).rejects.toThrow(/sender/);
    expect(calls).toEqual([]);
  });
});

describe('HttpsTransport', () => {
  it('POSTs the frame as application/octet-stream to the resolved URI', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    const m = message();
    const t = new HttpsTransport(async (to) => `https://agent.example/${to}/inbox`, { fetch });
    await t.send(m);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://agent.example/${bob.address}/inbox`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/octet-stream');
    expect(u8aToHex(init.body as Uint8Array)).toBe(u8aToHex(encodeFrame(m)));
  });

  it('fails loudly on a non-2xx answer', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 409 }));
    await expect(new HttpsTransport(() => 'https://a.example/inbox', { fetch }).send(message())).rejects.toThrow(/409/);
  });

  it('refuses plain http except for loopback', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(new HttpsTransport(() => 'http://agent.example/inbox', { fetch }).send(message())).rejects.toThrow(
      /https/,
    );
    await expect(new HttpsTransport(() => 'http://127.0.0.1:8080/inbox', { fetch }).send(message())).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ─── subscribeMessages over a mock finalized chain ─────────────────────────

interface MockExtrinsic {
  section: string;
  method: string;
  signer: string;
  payload: Uint8Array;
}
interface MockBlock {
  extrinsics: MockExtrinsic[];
  /** [extrinsicIndex, section, method, data] */
  events: [number, string, string, unknown[]][];
}

function chainApi(blocks: Map<number, MockBlock>) {
  let onHead: ((h: unknown) => void) | undefined;
  const hash = (n: number) => ({ toHex: () => `0x${n.toString(16).padStart(64, '0')}`, n });
  const leaf = (v: unknown) => ({ toString: () => String(v) });
  const api = {
    rpc: {
      chain: {
        subscribeFinalizedHeads: async (cb: (h: unknown) => void) => {
          onHead = cb;
          return () => {
            onHead = undefined;
          };
        },
        getBlockHash: async (n: number) => hash(n),
        getBlock: async (h: { n: number }) => ({
          block: {
            extrinsics: (blocks.get(h.n)?.extrinsics ?? []).map((x) => ({
              method: {
                section: x.section,
                method: x.method,
                args: [0, 1, 2, 3, { toU8a: (bare?: boolean) => (bare ? x.payload : new Uint8Array([0, ...x.payload])) }],
              },
              signer: leaf(x.signer),
            })),
          },
        }),
      },
    },
    at: async (h: { n: number }) => ({
      query: {
        system: {
          events: async () =>
            (blocks.get(h.n)?.events ?? []).map(([idx, section, method, data]) => ({
              phase: { isApplyExtrinsic: true, asApplyExtrinsic: { toNumber: () => idx } },
              event: { section, method, data: data.map(leaf) },
            })),
        },
      },
    }),
  };
  const finalize = (n: number) => onHead?.({ number: { toNumber: () => n }, hash: hash(n) });
  return { api: api as never, finalize, subscribed: () => onHead !== undefined };
}

const sentEvent = (from: string, to: string, idx: number): [number, string, string, unknown[]] => [
  idx,
  'messages',
  'MessageSent',
  [from, to, 'Offer', null, '0x', 0, 0],
];

describe('subscribeMessages', () => {
  it('delivers frames addressed to self, in block order, filling finality gaps', async () => {
    const frameA = encodeFrame(message(stringToU8a('a')));
    const frameB = encodeFrame(message(stringToU8a('b'), { nonce: 2n }));
    const blocks = new Map<number, MockBlock>([
      [10, {
        extrinsics: [
          { section: 'timestamp', method: 'set', signer: '', payload: new Uint8Array() },
          { section: 'messages', method: 'send', signer: alice.address, payload: frameA },
          { section: 'messages', method: 'send', signer: alice.address, payload: new Uint8Array([1]) },
        ],
        events: [sentEvent(alice.address, bob.address, 1), sentEvent(alice.address, carol.address, 2)],
      }],
      [12, {
        extrinsics: [{ section: 'messages', method: 'send', signer: alice.address, payload: frameB }],
        events: [sentEvent(alice.address, bob.address, 0)],
      }],
    ]);
    const { api, finalize } = chainApi(blocks);
    const got: InboundFrame[] = [];
    const done = new Promise<void>((resolve) => {
      void subscribeMessages(api, bob.address, (f) => {
        got.push(f);
        if (got.length === 2) resolve();
      }, { fromBlock: 10 });
    });
    await new Promise((r) => setTimeout(r, 0));
    finalize(12); // 10 and 11 were skipped by the finality notification
    await done;
    expect(got.map((g) => g.blockNumber)).toEqual([10, 12]);
    expect(got.map((g) => g.extrinsicIndex)).toEqual([1, 0]);
    expect(u8aToHex(got[0]!.frame)).toBe(u8aToHex(frameA));
    expect(u8aToHex(got[1]!.frame)).toBe(u8aToHex(frameB));
    expect(got[0]!.origin).toBe(alice.address);
  });

  it('ignores an event whose extrinsic is not messages.send from the event sender', async () => {
    const blocks = new Map<number, MockBlock>([
      [5, {
        extrinsics: [{ section: 'messages', method: 'send', signer: carol.address, payload: new Uint8Array([1]) }],
        events: [sentEvent(alice.address, bob.address, 0)],
      }],
    ]);
    const { api, finalize } = chainApi(blocks);
    const handler = vi.fn();
    const onError = vi.fn();
    await subscribeMessages(api, bob.address, handler, { fromBlock: 5, onError });
    finalize(5);
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('keeps the subscription alive when the handler throws, and unsubscribes on request', async () => {
    const frame = encodeFrame(message());
    const blocks = new Map<number, MockBlock>([
      [1, {
        extrinsics: [{ section: 'messages', method: 'send', signer: alice.address, payload: frame }],
        events: [sentEvent(alice.address, bob.address, 0)],
      }],
    ]);
    const { api, finalize, subscribed } = chainApi(blocks);
    const onError = vi.fn();
    const unsub = await subscribeMessages(api, bob.address, () => {
      throw new Error('handler bug');
    }, { onError });
    finalize(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'handler bug' }));
    unsub();
    expect(subscribed()).toBe(false);
  });
});
