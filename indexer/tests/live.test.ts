import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { ApiPromise } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import type { KeyringPair } from '@polkadot/keyring/types';
import type { SubmittableExtrinsic } from '@polkadot/api/types';

import { connectChain } from '../src/chain.ts';
import { IndexerStore } from '../src/store.ts';
import { ChainIndexer } from '../src/indexer.ts';
import { createApiServer, ROUTES } from '../src/api.ts';
import { loadConfig } from '../src/config.ts';

/**
 * End-to-end against the live devnet node.
 *
 * This suite is the contract the issue states: every one of the 24 v1 endpoints
 * must answer with data read from a real chain — never a fixture. So it
 * (1) submits real extrinsics, (2) lets the indexer ingest the real finalized
 * blocks those landed in, and (3) cross-checks each response against a direct
 * RPC read of the same state. If the node is unreachable the suite fails loudly:
 * a missing chain is a finding, not a reason to fall back to mocks.
 */

const RPC_URL = process.env.INDEXER_RPC_URL ?? 'ws://127.0.0.1:9944';

let chain: Awaited<ReturnType<typeof connectChain>>;
let api: ApiPromise;
let store: IndexerStore;
let indexer: ChainIndexer;
let server: Server;
let baseUrl: string;

/** Route paths this suite actually exercised, to prove none is left untested. */
const exercised = new Set<string>();

/** Fills a route template (`/v1/blocks/:id`) and records that it was hit. */
async function getRoute(
  template: string,
  params: Record<string, string | number> = {},
  query = '',
): Promise<{ status: number; body: any }> {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`:${key}`, encodeURIComponent(String(value)));
  }
  expect(path, `unfilled parameter in ${template}`).not.toContain(':');
  exercised.add(template);
  const response = await fetch(`${baseUrl}${path}${query}`);
  return { status: response.status, body: await response.json() };
}

/** Submits an extrinsic and resolves with the block number it landed in. */
function submit(tx: SubmittableExtrinsic<'promise'>, signer: KeyringPair): Promise<number> {
  return new Promise((resolve, reject) => {
    tx.signAndSend(signer, ({ status, dispatchError, txIndex }) => {
      if (dispatchError) {
        reject(new Error(`extrinsic failed: ${dispatchError.toString()} (txIndex ${txIndex})`));
        return;
      }
      if (status.isInBlock) {
        api.rpc.chain
          .getHeader(status.asInBlock)
          .then((header) => resolve(header.number.toNumber()))
          .catch(reject);
      }
    }).catch(reject);
  });
}

/** Seeded on-chain facts the endpoint assertions are checked against. */
const seeded = {
  heartbeatBlock: 0,
  transferBlock: 0,
  escrowBlock: 0,
  buyer: '',
  provider: '',
  seq: 0,
  amountPlancks: '',
};

let alice: KeyringPair;
let dave: KeyringPair;

beforeAll(async () => {
  chain = await connectChain(RPC_URL);
  api = chain.api;
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format: chain.ss58Format });
  alice = keyring.addFromUri('//Alice');
  dave = keyring.addFromUri('//Dave');

  // Index from well before the seeded activity so the suite has real history to
  // page through, not just the blocks it created itself.
  store = IndexerStore.open(':memory:');
  indexer = new ChainIndexer(api, store, { backfillDepth: 20 });
  await indexer.start();

  // ── Seed real chain activity ────────────────────────────────────────────
  // Alice is a genesis agent, so `heartbeat` is a call she can actually make.
  seeded.heartbeatBlock = await submit(api.tx.agents.heartbeat(), alice);

  // A transfer gives the account endpoints a second real account to report.
  seeded.transferBlock = await submit(
    api.tx.balances.transferKeepAlive(dave.address, 1_000_000_000_000n),
    alice,
  );

  // An escrow agreement between two genesis agents. The pair is chosen at
  // runtime because `MaxAgreementsPerPair` bounds how many a single pair can
  // hold — running out is a real failure, not something to skip past.
  const maxPerPair = (api.consts.escrow.maxAgreementsPerPair as unknown as { toNumber(): number }).toNumber();
  const agentEntries = await api.query.agents.agentStake.entries();
  const agentAddresses = agentEntries.map(([key]) => key.args[0]!.toString());
  const aliceIsAgent = agentAddresses.includes(alice.address);
  expect(aliceIsAgent, `//Alice (${alice.address}) must be a registered agent on the devnet`).toBe(true);

  let provider = '';
  for (const candidate of agentAddresses) {
    if (candidate === alice.address) continue;
    const existing = await api.query.escrow.agreements(alice.address, candidate);
    if ((existing as unknown as { length: number }).length < maxPerPair) {
      provider = candidate;
      break;
    }
  }
  expect(
    provider,
    `every provider pair for //Alice is at MaxAgreementsPerPair (${maxPerPair}); the devnet needs cleaning up`,
  ).not.toBe('');

  const minAmount = (api.consts.escrow.minAgreementAmount as unknown as { toString(): string }).toString();
  const nextSeq = await api.query.escrow.nextSeq(alice.address, provider);
  const head = await api.rpc.chain.getHeader();
  const deliverBy = head.number.toNumber() + 100_000;
  const deliverableHash = `0x${'11'.repeat(32)}`;

  seeded.escrowBlock = await submit(
    api.tx.escrow.createAgreement(provider, minAmount, deliverableHash, deliverBy, null),
    alice,
  );
  seeded.buyer = alice.address;
  seeded.provider = provider;
  seeded.seq = Number((nextSeq as unknown as { toString(): string }).toString());
  seeded.amountPlancks = minAmount;

  // Ingestion is over finalized blocks, so wait for the indexer to actually
  // reach the highest seeded block rather than sleeping and hoping.
  await indexer.waitForBlock(
    Math.max(seeded.heartbeatBlock, seeded.transferBlock, seeded.escrowBlock),
    200_000,
  );

  const config = loadConfig({ ...process.env, INDEXER_PORT: '0' });
  server = createApiServer({ store, api, chain, indexer, config });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (indexer) await indexer.stop();
  if (store) store.close();
  if (chain) await chain.disconnect();
});

describe('v1 surface', () => {
  it('exposes exactly the 24 documented endpoints', () => {
    expect(ROUTES).toHaveLength(24);
    // Paths are the public contract — duplicates would mean one is unreachable.
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(24);
    for (const route of ROUTES) {
      expect(route.path.startsWith('/v1/'), `${route.path} must be version-prefixed`).toBe(true);
    }
  });

  it('404s an unknown path rather than falling through to a handler', async () => {
    const response = await fetch(`${baseUrl}/v1/not-a-real-endpoint`);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBeTruthy();
  });
});

describe('status', () => {
  it('reports the live runtime and the indexer position', async () => {
    const { status, body } = await getRoute('/v1/status');
    expect(status).toBe(200);
    expect(body.chain.specName).toBe(api.runtimeVersion.specName.toString());
    expect(body.chain.specVersion).toBe(api.runtimeVersion.specVersion.toNumber());
    expect(body.chain.ss58Format).toBe(chain.ss58Format);
    expect(body.chain.tokenSymbol).toBe('CMN');
    expect(body.chain.tokenDecimals).toBe(12);
    // The indexer cannot be ahead of the chain, and must have reached the seed.
    expect(body.indexer.syncedHeight).toBeGreaterThanOrEqual(seeded.escrowBlock);
    expect(body.indexer.syncedHeight).toBeLessThanOrEqual(body.chain.bestBlock);
    expect(body.indexer.indexedBlocks).toBeGreaterThan(0);
  });
});

describe('blocks', () => {
  it('lists real finalized blocks, newest first', async () => {
    const { status, body } = await getRoute('/v1/blocks', {}, '?limit=5');
    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(5);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);

    const numbers = body.items.map((b: any) => b.number);
    expect([...numbers]).toEqual([...numbers].sort((a: number, b: number) => b - a));

    // Cross-check the newest listed block against the node itself.
    const head = body.items[0];
    const hashOnChain = await api.rpc.chain.getBlockHash(head.number);
    expect(head.hash).toBe(hashOnChain.toHex());
  });

  it('serves a single block by number and by hash, matching the node', async () => {
    const onChainHash = (await api.rpc.chain.getBlockHash(seeded.heartbeatBlock)).toHex();
    const signedBlock = await api.rpc.chain.getBlock(onChainHash);

    const byNumber = await getRoute('/v1/blocks/:id', { id: seeded.heartbeatBlock });
    expect(byNumber.status).toBe(200);
    expect(byNumber.body.hash).toBe(onChainHash);
    expect(byNumber.body.parentHash).toBe(signedBlock.block.header.parentHash.toHex());
    expect(byNumber.body.extrinsicCount).toBe(signedBlock.block.extrinsics.length);
    expect(byNumber.body.timestampMs).toBeGreaterThan(0);

    const byHash = await getRoute('/v1/blocks/:id', { id: onChainHash });
    expect(byHash.body).toEqual(byNumber.body);
  });

  it('lists the extrinsics of a block, including the timestamp inherent', async () => {
    const { status, body } = await getRoute('/v1/blocks/:id/extrinsics', { id: seeded.heartbeatBlock });
    expect(status).toBe(200);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(body.items[0].section).toBe('timestamp');
    expect(body.items[0].method).toBe('set');
    expect(body.items[0].isSigned).toBe(false);

    const heartbeat = body.items.find((x: any) => x.section === 'agents' && x.method === 'heartbeat');
    expect(heartbeat, 'the seeded heartbeat must be indexed in its block').toBeTruthy();
    expect(heartbeat.signer).toBe(alice.address);
    expect(heartbeat.success).toBe(true);
  });

  it('lists the events of a block with their phase and extrinsic link', async () => {
    const { status, body } = await getRoute('/v1/blocks/:id/events', { id: seeded.heartbeatBlock });
    expect(status).toBe(200);

    const onChain = await (await api.at(await api.rpc.chain.getBlockHash(seeded.heartbeatBlock))).query.system.events();
    expect(body.total).toBe(onChain.length);

    const heartbeatEvent = body.items.find((e: any) => e.section === 'agents' && e.method === 'HeartbeatSent');
    expect(heartbeatEvent, 'HeartbeatSent must be indexed').toBeTruthy();
    expect(heartbeatEvent.phase).toBe('ApplyExtrinsic');
    expect(heartbeatEvent.extrinsicId).toMatch(new RegExp(`^${seeded.heartbeatBlock}-\\d+$`));
    expect(heartbeatEvent.data.who).toBe(alice.address);

    // The dispatch info on the matching success event is the shape most easily
    // mangled in decoding: two plain enums and a struct of 64-bit weights.
    const success = body.items.find(
      (e: any) =>
        e.section === 'system' &&
        e.method === 'ExtrinsicSuccess' &&
        e.extrinsicId === heartbeatEvent.extrinsicId,
    );
    expect(success).toBeTruthy();
    // A signed user call is Normal and pays a fee — never null, which is what a
    // decoder that mistakes an enum for an absent Option reports.
    expect(success.data.dispatch_info.class).toBe('Normal');
    expect(success.data.dispatch_info.paysFee).toBe('Yes');
    // 64-bit weights arrive as decimal strings, not floats.
    expect(success.data.dispatch_info.weight.refTime).toMatch(/^\d+$/);
  });

  it('404s a block the indexer does not have', async () => {
    const far = (await api.rpc.chain.getHeader()).number.toNumber() + 1_000_000;
    const response = await fetch(`${baseUrl}/v1/blocks/${far}`);
    expect(response.status).toBe(404);
  });
});

describe('extrinsics', () => {
  let heartbeatId = '';

  it('lists extrinsics and filters them by signer', async () => {
    const { status, body } = await getRoute('/v1/extrinsics', {}, `?signer=${alice.address}&limit=50`);
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(3); // heartbeat + transfer + escrow
    for (const item of body.items) expect(item.signer).toBe(alice.address);

    const heartbeat = body.items.find((x: any) => x.method === 'heartbeat');
    expect(heartbeat).toBeTruthy();
    heartbeatId = heartbeat.id;
    expect(heartbeatId.startsWith(`${seeded.heartbeatBlock}-`)).toBe(true);
  });

  it('serves one extrinsic with its decoded call and outcome', async () => {
    const { status, body } = await getRoute('/v1/extrinsics/:id', { id: heartbeatId });
    expect(status).toBe(200);
    expect(body.section).toBe('agents');
    expect(body.method).toBe('heartbeat');
    expect(body.isSigned).toBe(true);
    expect(body.signer).toBe(alice.address);
    expect(body.success).toBe(true);
    expect(body.blockNumber).toBe(seeded.heartbeatBlock);
    expect(body.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('serves the events emitted by one extrinsic', async () => {
    const { status, body } = await getRoute('/v1/extrinsics/:id/events', { id: heartbeatId });
    expect(status).toBe(200);
    const methods = body.items.map((e: any) => `${e.section}.${e.method}`);
    expect(methods).toContain('agents.HeartbeatSent');
    expect(methods).toContain('system.ExtrinsicSuccess');
    for (const event of body.items) expect(event.extrinsicId).toBe(heartbeatId);
  });

  it('404s an extrinsic id that was never indexed', async () => {
    const response = await fetch(`${baseUrl}/v1/extrinsics/0-999`);
    expect(response.status).toBe(404);
  });
});

describe('events', () => {
  it('lists events and filters by pallet and method', async () => {
    const { status, body } = await getRoute(
      '/v1/events',
      {},
      '?section=escrow&method=AgreementCreated&limit=50',
    );
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(1);

    const created = body.items.find((e: any) => e.blockNumber === seeded.escrowBlock);
    expect(created, 'the seeded AgreementCreated event must be indexed').toBeTruthy();
    expect(created.data.buyer).toBe(seeded.buyer);
    expect(created.data.provider).toBe(seeded.provider);
    expect(String(created.data.amount)).toBe(seeded.amountPlancks);
  });

  it('serves a single event by id', async () => {
    const list = await getRoute('/v1/events', {}, `?blockNumber=${seeded.escrowBlock}&section=escrow`);
    const first = list.body.items[0];
    const { status, body } = await getRoute('/v1/events/:id', { id: first.id });
    expect(status).toBe(200);
    expect(body).toEqual(first);
    expect(body.accounts).toContain(seeded.buyer);
  });
});

describe('accounts', () => {
  it('lists accounts the indexer has seen on chain', async () => {
    const { status, body } = await getRoute('/v1/accounts', {}, '?limit=50');
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(2);
    const addresses = body.items.map((a: any) => a.address);
    expect(addresses).toContain(alice.address);
    expect(addresses).toContain(dave.address); // seen via the seeded transfer
  });

  it('reports an account with its live on-chain balance', async () => {
    const { status, body } = await getRoute('/v1/accounts/:address', { address: alice.address });
    expect(status).toBe(200);

    const onChain = await api.query.system.account(alice.address);
    expect(body.address).toBe(alice.address);
    expect(body.balance.freePlancks).toBe(onChain.data.free.toString());
    expect(body.balance.reservedPlancks).toBe(onChain.data.reserved.toString());
    expect(body.nonce).toBe(onChain.nonce.toNumber());
    expect(body.isAgent).toBe(true);
    expect(body.activity.extrinsicCount).toBeGreaterThanOrEqual(3);
  });

  it('rejects a malformed address instead of guessing', async () => {
    const response = await fetch(`${baseUrl}/v1/accounts/not-an-address`);
    expect(response.status).toBe(400);
  });

  it('lists the extrinsics an account signed', async () => {
    const { status, body } = await getRoute('/v1/accounts/:address/extrinsics', { address: alice.address });
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(3);
    const calls = body.items.map((x: any) => `${x.section}.${x.method}`);
    expect(calls).toContain('agents.heartbeat');
    expect(calls).toContain('escrow.createAgreement');
    for (const item of body.items) expect(item.signer).toBe(alice.address);
  });
});

describe('agents', () => {
  it('lists every registered agent with its live stake', async () => {
    const { status, body } = await getRoute('/v1/agents');
    expect(status).toBe(200);

    const onChain = await api.query.agents.agentStake.entries();
    expect(body.total).toBe(onChain.length);
    expect(body.total).toBeGreaterThan(0);

    const stakeByAddress = new Map(
      onChain.map(([key, value]) => [key.args[0]!.toString(), value.toString()]),
    );
    for (const agent of body.items) {
      expect(stakeByAddress.get(agent.address)).toBe(agent.stakePlancks);
      expect(BigInt(agent.stakePlancks) > 0n).toBe(true);
    }
  });

  it('reports one agent, including the heartbeat just sent', async () => {
    const { status, body } = await getRoute('/v1/agents/:address', { address: alice.address });
    expect(status).toBe(200);
    expect(body.address).toBe(alice.address);
    expect(body.stakePlancks).toBe((await api.query.agents.agentStake(alice.address)).toString());
    // The seeded heartbeat wrote this, so it must be at least that block.
    expect(body.lastHeartbeatBlock).toBeGreaterThanOrEqual(seeded.heartbeatBlock);
    expect(body.activeEscrowCount).toBe(
      Number((await api.query.agents.activeEscrowCount(alice.address)).toString()),
    );
    expect(body.eraVolumePlancks).toBe((await api.query.agents.eraEscrowVolume(alice.address)).toString());
  });

  it('404s an account that is not an agent', async () => {
    const response = await fetch(`${baseUrl}/v1/agents/${dave.address}`);
    expect(response.status).toBe(404);
  });

  it('serves the agent-scoped event history', async () => {
    const { status, body } = await getRoute('/v1/agents/:address/events', { address: alice.address });
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(2);
    const methods = body.items.map((e: any) => `${e.section}.${e.method}`);
    expect(methods).toContain('agents.HeartbeatSent');
    expect(methods).toContain('escrow.AgreementCreated');
    for (const event of body.items) expect(event.accounts).toContain(alice.address);
  });

  it('serves the agreements an agent is party to', async () => {
    const { status, body } = await getRoute('/v1/agents/:address/escrows', { address: alice.address });
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(1);

    const seededAgreement = body.items.find(
      (a: any) => a.buyer === seeded.buyer && a.provider === seeded.provider && a.seq === seeded.seq,
    );
    expect(seededAgreement, 'the seeded agreement must be visible from the buyer side').toBeTruthy();
    expect(seededAgreement.role).toBe('buyer');
    expect(seededAgreement.amountPlancks).toBe(seeded.amountPlancks);
  });
});

describe('escrows', () => {
  it('lists live agreements straight from chain storage', async () => {
    const { status, body } = await getRoute('/v1/escrows', {}, '?limit=100');
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(1);

    const found = body.items.find(
      (a: any) => a.buyer === seeded.buyer && a.provider === seeded.provider && a.seq === seeded.seq,
    );
    expect(found).toBeTruthy();
    expect(found.status).toBe('Created');
    expect(found.amountPlancks).toBe(seeded.amountPlancks);
    expect(found.createdAtBlock).toBe(seeded.escrowBlock);
    expect(found.deliverableHash).toBe(`0x${'11'.repeat(32)}`);
  });

  it('filters agreements by buyer', async () => {
    const { body } = await getRoute('/v1/escrows', {}, `?buyer=${seeded.buyer}&limit=100`);
    expect(body.total).toBeGreaterThanOrEqual(1);
    for (const item of body.items) expect(item.buyer).toBe(seeded.buyer);
  });

  it('reports aggregate escrow state matching the chain counter', async () => {
    const { status, body } = await getRoute('/v1/escrows/stats');
    expect(status).toBe(200);
    expect(body.activeAgreementCount).toBe(
      Number((await api.query.escrow.activeAgreementCount()).toString()),
    );
    expect(body.activeAgreementCount).toBeGreaterThanOrEqual(1);
    expect(BigInt(body.totalLockedPlancks) >= BigInt(seeded.amountPlancks)).toBe(true);
    expect(body.byStatus.Created).toBeGreaterThanOrEqual(1);
  });

  it('serves one agreement by its (buyer, provider, seq) key', async () => {
    const { status, body } = await getRoute('/v1/escrows/:buyer/:provider/:seq', {
      buyer: seeded.buyer,
      provider: seeded.provider,
      seq: seeded.seq,
    });
    expect(status).toBe(200);
    expect(body.buyer).toBe(seeded.buyer);
    expect(body.provider).toBe(seeded.provider);
    expect(body.seq).toBe(seeded.seq);
    expect(body.amountPlancks).toBe(seeded.amountPlancks);
    expect(body.status).toBe('Created');
    expect(body.deliverByBlock).toBeGreaterThan(body.createdAtBlock);
  });

  it('404s an agreement sequence that does not exist', async () => {
    const response = await fetch(`${baseUrl}/v1/escrows/${seeded.buyer}/${seeded.provider}/99999`);
    expect(response.status).toBe(404);
  });
});

describe('eras', () => {
  it('reports the current era from live chain state', async () => {
    const { status, body } = await getRoute('/v1/eras/current');
    expect(status).toBe(200);

    const eraOnChain = Number((await api.query.agents.eraNumber()).toString());
    const startBlock = Number((await api.query.emissions.eraStartBlock()).toString());
    const duration = Number((api.consts.emissions.eraDuration as unknown as { toString(): string }).toString());

    expect(body.era).toBe(eraOnChain);
    expect(body.startBlock).toBe(startBlock);
    expect(body.durationBlocks).toBe(duration);
    expect(body.currentBlock).toBeGreaterThanOrEqual(seeded.escrowBlock);
    expect(body.blocksElapsed).toBe(body.currentBlock - startBlock);
    // `settle_era` is permissionless and gated only on era duration, so this
    // flag is exactly that guard's condition — not an authority check.
    expect(body.dueForSettlement).toBe(body.blocksElapsed >= duration);
  });

  it('lists eras with the in-progress one included', async () => {
    const { status, body } = await getRoute('/v1/eras');
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThanOrEqual(1);

    const eraOnChain = Number((await api.query.agents.eraNumber()).toString());
    const current = body.items.find((e: any) => e.era === eraOnChain);
    expect(current, 'the current era must always be listed').toBeTruthy();
    expect(current.settled).toBe(false);
    // Settled eras carry the emission that was actually minted for them.
    for (const era of body.items) {
      if (era.settled) expect(BigInt(era.totalEmissionPlancks) >= 0n).toBe(true);
    }
  });
});

describe('emissions', () => {
  it('reports emission parameters and settlement state from the runtime', async () => {
    const { status, body } = await getRoute('/v1/emissions');
    expect(status).toBe(200);

    const consts = api.consts.emissions as unknown as Record<string, { toString(): string }>;
    expect(body.parameters.eraDurationBlocks).toBe(Number(consts.eraDuration!.toString()));
    expect(body.parameters.initialEmissionPerEraPlancks).toBe(consts.initialEmissionsPerEra!.toString());
    expect(body.parameters.floorEmissionPerEraPlancks).toBe(consts.floorEmissionPerEra!.toString());
    expect(body.parameters.velocityBonusBps).toBe(Number(consts.velocityBonusBps!.toString()));
    expect(body.parameters.minQualifyingVolumePlancks).toBe(consts.minQualifyingVol!.toString());

    expect(body.lastEraEmissionPlancks).toBe((await api.query.emissions.lastEraEmission()).toString());
    const lastSettled = await api.query.emissions.lastSettledEra();
    expect(body.lastSettledEra).toBe(lastSettled.isSome ? Number(lastSettled.unwrap().toString()) : null);
  });

  it('reports issuance against the hard supply cap', async () => {
    const { status, body } = await getRoute('/v1/emissions/supply');
    expect(status).toBe(200);

    const cap = (api.consts.emissions.supplyCap as unknown as { toString(): string }).toString();
    const issuance = (await api.query.balances.totalIssuance()).toString();

    expect(body.capPlancks).toBe(cap);
    expect(body.totalIssuancePlancks).toBe(issuance);
    // The cap is absolute: remaining headroom is cap - issuance, exactly, in
    // bigint. Reporting it any other way would misstate the chain's one
    // inviolable economic bound.
    expect(body.remainingPlancks).toBe((BigInt(cap) - BigInt(issuance)).toString());
    expect(BigInt(body.remainingPlancks) > 0n).toBe(true);
    expect(body.tokenSymbol).toBe('CMN');
    expect(body.tokenDecimals).toBe(12);
  });
});

describe('endpoint coverage', () => {
  it('exercised every one of the 24 endpoints against the live node', () => {
    const declared = ROUTES.map((r) => r.path).sort();
    expect([...exercised].sort()).toEqual(declared);
  });
});
