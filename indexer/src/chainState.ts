/**
 * Live reads of pallet state.
 *
 * History comes from the index; *current* state comes from here, straight off
 * the node at every request. Stakes, agreements, issuance and era timing are
 * exactly the values agents act on, so serving a cached copy would mean
 * answering "what is true now" with "what was true at some point". Every value
 * below is read through the node's own metadata.
 */

import type { ApiPromise } from '@polkadot/api';

import type { ChainConnection } from './chain.ts';

/** Reads a codec as a decimal planck string — never as a number. */
function plancks(value: unknown): string {
  return (value as { toString(): string }).toString();
}

/** Reads a small integer codec (block numbers, counters, era indices). */
function count(value: unknown): number {
  return Number((value as { toString(): string }).toString());
}

/**
 * A storage entry as resolved from the node's own metadata.
 *
 * Typed loosely on purpose: the pallets this indexer reads are chain-specific,
 * so there are no generated types for them here, and the alternative — writing
 * the shapes out by hand — is exactly the guesswork that goes stale the first
 * time the runtime changes.
 */
type StorageEntry = ((...args: unknown[]) => Promise<unknown>) & {
  entries: () => Promise<[{ args: { toString(): string }[] }, unknown][]>;
};

/** Resolves a storage item, refusing to run against a runtime that lacks it. */
function entry(api: ApiPromise, pallet: string, item: string): StorageEntry {
  const resolved = (api.query as unknown as Record<string, Record<string, StorageEntry | undefined>>)[
    pallet
  ]?.[item];
  if (resolved === undefined) {
    throw new Error(`runtime does not expose storage ${pallet}.${item}`);
  }
  return resolved;
}

/** Reads one storage value from the live chain. */
function read(api: ApiPromise, pallet: string, item: string, ...args: unknown[]): Promise<unknown> {
  return entry(api, pallet, item)(...args);
}

/** Reads every key/value pair of a storage map from the live chain. */
function readEntries(
  api: ApiPromise,
  pallet: string,
  item: string,
): Promise<[{ args: { toString(): string }[] }, unknown][]> {
  return entry(api, pallet, item).entries();
}

/** Reads a `#[pallet::constant]` off the runtime metadata. */
function constant(api: ApiPromise, pallet: string, name: string): { toString(): string } {
  const value = (api.consts as unknown as Record<string, Record<string, { toString(): string }>>)[pallet]?.[name];
  if (value === undefined) {
    throw new Error(`runtime does not expose constant ${pallet}.${name}`);
  }
  return value;
}

export interface ChainStatus {
  chain: {
    name: string;
    specName: string;
    specVersion: number;
    ss58Format: number;
    tokenSymbol: string;
    tokenDecimals: number;
    bestBlock: number;
    finalizedBlock: number;
  };
}

/** Chain identity plus where its head currently is. */
export async function fetchChainStatus(api: ApiPromise, chain: ChainConnection): Promise<ChainStatus['chain']> {
  const [chainName, bestHeader, finalizedHash] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.chain.getHeader(),
    api.rpc.chain.getFinalizedHead(),
  ]);
  const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash);

  return {
    name: chainName.toString(),
    specName: api.runtimeVersion.specName.toString(),
    specVersion: api.runtimeVersion.specVersion.toNumber(),
    ss58Format: chain.ss58Format,
    tokenSymbol: chain.tokenSymbol,
    tokenDecimals: chain.tokenDecimals,
    bestBlock: bestHeader.number.toNumber(),
    finalizedBlock: finalizedHeader.number.toNumber(),
  };
}

export interface AccountState {
  address: string;
  nonce: number;
  balance: {
    freePlancks: string;
    reservedPlancks: string;
    frozenPlancks: string;
  };
  isAgent: boolean;
}

/** Live balance and agent status for one account. */
export async function fetchAccountState(api: ApiPromise, address: string): Promise<AccountState> {
  const [account, stake] = await Promise.all([
    read(api, 'system', 'account', address),
    read(api, 'agents', 'agentStake', address),
  ]);
  const info = account as unknown as {
    nonce: { toNumber(): number };
    data: { free: unknown; reserved: unknown; frozen: unknown };
  };

  return {
    address,
    nonce: info.nonce.toNumber(),
    balance: {
      freePlancks: plancks(info.data.free),
      reservedPlancks: plancks(info.data.reserved),
      frozenPlancks: plancks(info.data.frozen),
    },
    isAgent: (stake as unknown as { isSome: boolean }).isSome,
  };
}

export interface AgentState {
  address: string;
  /** Stake backing this agent, in plancks. Weight in emissions starts here. */
  stakePlancks: string;
  registeredAtBlock: number;
  /** Block the agent last proved liveness at. */
  lastHeartbeatBlock: number;
  /** Set once an unstake has been requested; the agent exits at this block. */
  unstakeAtBlock: number | null;
  completedAgreements: number;
  activeEscrowCount: number;
  /** Escrow volume this era — the gate on qualifying for emissions at all. */
  eraVolumePlancks: string;
  /** Distinct counterparties this era; the anti-ring-trading signal. */
  eraUniqueBuyers: number;
  /** Governance votes credited this era, one per distinct referendum. */
  eraGovParticipation: number;
  capabilities: number[];
  metadata: { uri: string; name: string; updatedAtBlock: number } | null;
}

/** Decodes a `BoundedVec<u8>` metadata field (URI, display name) as UTF-8. */
function decodeBytes(value: unknown): string {
  const bytes = value as { toU8a?: (isBare?: boolean) => Uint8Array; toString(): string };
  return typeof bytes.toU8a === 'function'
    ? Buffer.from(bytes.toU8a(true)).toString('utf8')
    : bytes.toString();
}

/** Full agent record, or null when the account is not a registered agent. */
export async function fetchAgent(api: ApiPromise, address: string): Promise<AgentState | null> {
  const stake = await read(api, 'agents', 'agentStake', address);
  if (!(stake as unknown as { isSome: boolean }).isSome) {
    return null;
  }

  const [
    registeredAt,
    lastHeartbeat,
    unstakeAt,
    completed,
    activeEscrows,
    eraVolume,
    eraBuyers,
    eraGov,
    capabilities,
    metadata,
  ] = await Promise.all([
    read(api, 'agents', 'stakeRegisteredAt', address),
    read(api, 'agents', 'lastHeartbeat', address),
    read(api, 'agents', 'unstakeAt', address),
    read(api, 'agents', 'completedAgreements', address),
    read(api, 'agents', 'activeEscrowCount', address),
    read(api, 'agents', 'eraEscrowVolume', address),
    read(api, 'agents', 'eraUniqueBuyers', address),
    read(api, 'agents', 'eraGovParticipation', address),
    read(api, 'agents', 'agentCapabilities', address),
    read(api, 'agents', 'agentMetadata', address),
  ]);

  const unstake = unstakeAt as unknown as { isSome: boolean; unwrap(): unknown };
  const meta = metadata as unknown as { isSome: boolean; unwrap(): Record<string, unknown> };

  return {
    address,
    stakePlancks: plancks((stake as unknown as { unwrap(): unknown }).unwrap()),
    registeredAtBlock: count(registeredAt),
    lastHeartbeatBlock: count(lastHeartbeat),
    unstakeAtBlock: unstake.isSome ? count(unstake.unwrap()) : null,
    completedAgreements: count(completed),
    activeEscrowCount: count(activeEscrows),
    eraVolumePlancks: plancks(eraVolume),
    eraUniqueBuyers: count(eraBuyers),
    eraGovParticipation: count(eraGov),
    capabilities: (capabilities as unknown as { toArray(): unknown[] }).toArray().map(count),
    metadata: meta.isSome
      ? (() => {
          const record = meta.unwrap();
          return {
            uri: decodeBytes(record.uri),
            name: decodeBytes(record.name),
            updatedAtBlock: count(record.updatedAt),
          };
        })()
      : null,
  };
}

/** Every registered agent, ordered by stake descending. */
export async function fetchAgents(api: ApiPromise): Promise<AgentState[]> {
  const entries = await readEntries(api, 'agents', 'agentStake');
  const addresses = entries.map(([key]) => key.args[0]!.toString());
  const agents = await Promise.all(addresses.map((address) => fetchAgent(api, address)));
  return agents
    .filter((agent): agent is AgentState => agent !== null)
    .sort((a, b) => (BigInt(b.stakePlancks) > BigInt(a.stakePlancks) ? 1 : -1));
}

export interface EscrowAgreement {
  buyer: string;
  provider: string;
  seq: number;
  amountPlancks: string;
  deliverableHash: string;
  deliverByBlock: number;
  createdAtBlock: number;
  status: 'Created' | 'Delivered' | 'Disputed';
  deliveryProof: string | null;
  capabilityId: number | null;
  disputeOpenedAtBlock: number | null;
  disputeRequestId: string | null;
}

function toAgreement(buyer: string, provider: string, raw: Record<string, any>): EscrowAgreement {
  return {
    buyer,
    provider,
    seq: count(raw.seq),
    amountPlancks: plancks(raw.amount),
    deliverableHash: raw.deliverableHash.toHex(),
    deliverByBlock: count(raw.deliverBy),
    createdAtBlock: count(raw.createdAt),
    status: raw.status.type as EscrowAgreement['status'],
    deliveryProof: raw.deliveryProof.isSome ? raw.deliveryProof.unwrap().toHex() : null,
    capabilityId: raw.capabilityId.isSome ? count(raw.capabilityId.unwrap()) : null,
    disputeOpenedAtBlock: raw.disputeOpenedAt.isSome ? count(raw.disputeOpenedAt.unwrap()) : null,
    disputeRequestId: raw.disputeRequestId.isSome ? raw.disputeRequestId.unwrap().toHex() : null,
  };
}

export interface EscrowFilter {
  buyer?: string;
  provider?: string;
}

/**
 * All live agreements, newest first.
 *
 * Agreements live in a double map keyed by the *pair*, so the whole map is read
 * and filtered here. Settled agreements are removed from chain storage by the
 * pallet, so this is the set of open commitments — the funds actually reserved
 * right now.
 */
export async function fetchEscrows(api: ApiPromise, filter: EscrowFilter = {}): Promise<EscrowAgreement[]> {
  const entries = await readEntries(api, 'escrow', 'agreements');
  const agreements: EscrowAgreement[] = [];

  for (const [key, value] of entries) {
    const buyer = key.args[0]!.toString();
    const provider = key.args[1]!.toString();
    if (filter.buyer !== undefined && filter.buyer !== buyer) continue;
    if (filter.provider !== undefined && filter.provider !== provider) continue;
    for (const raw of value as unknown as Record<string, any>[]) {
      agreements.push(toAgreement(buyer, provider, raw));
    }
  }

  return agreements.sort((a, b) => b.createdAtBlock - a.createdAtBlock);
}

/** One agreement by its (buyer, provider, seq) key, or null. */
export async function fetchEscrow(
  api: ApiPromise,
  buyer: string,
  provider: string,
  seq: number,
): Promise<EscrowAgreement | null> {
  const value = await read(api, 'escrow', 'agreements', buyer, provider);
  for (const raw of value as unknown as Record<string, any>[]) {
    if (count(raw.seq) === seq) {
      return toAgreement(buyer, provider, raw);
    }
  }
  return null;
}

export interface EscrowStats {
  /** The pallet's own counter of live agreements. */
  activeAgreementCount: number;
  /** Agreements the indexer enumerated from storage, as a cross-check. */
  enumeratedAgreements: number;
  byStatus: Record<EscrowAgreement['status'], number>;
  /** Buyer funds currently reserved across all open agreements. */
  totalLockedPlancks: string;
  distinctPairs: number;
  limits: {
    maxAgreementsPerPair: number;
    minAgreementPlancks: string;
    maxAgreementSpanBlocks: number;
  };
}

export async function fetchEscrowStats(api: ApiPromise): Promise<EscrowStats> {
  const [counter, agreements] = await Promise.all([
    read(api, 'escrow', 'activeAgreementCount'),
    fetchEscrows(api),
  ]);

  const byStatus: Record<EscrowAgreement['status'], number> = { Created: 0, Delivered: 0, Disputed: 0 };
  // Reserved balances are u128 plancks; summing them anywhere but in bigint
  // would silently round the total once it passes 2^53.
  let locked = 0n;
  const pairs = new Set<string>();
  for (const agreement of agreements) {
    byStatus[agreement.status] += 1;
    locked += BigInt(agreement.amountPlancks);
    pairs.add(`${agreement.buyer}/${agreement.provider}`);
  }

  return {
    activeAgreementCount: count(counter),
    enumeratedAgreements: agreements.length,
    byStatus,
    totalLockedPlancks: locked.toString(),
    distinctPairs: pairs.size,
    limits: {
      maxAgreementsPerPair: count(constant(api, 'escrow', 'maxAgreementsPerPair')),
      minAgreementPlancks: constant(api, 'escrow', 'minAgreementAmount').toString(),
      maxAgreementSpanBlocks: count(constant(api, 'escrow', 'maxAgreementSpan')),
    },
  };
}

export interface EraState {
  era: number;
  startBlock: number;
  durationBlocks: number;
  currentBlock: number;
  blocksElapsed: number;
  blocksRemaining: number;
  /**
   * Whether `settle_era`'s timing guard would pass right now.
   *
   * Settlement is permissionless by design — this is the era-duration gate, not
   * a check on who may call it.
   */
  dueForSettlement: boolean;
  lastSettledEra: number | null;
  ringSnapshot: number;
  activeSnapshot: number;
}

export async function fetchCurrentEra(api: ApiPromise): Promise<EraState> {
  const [era, startBlock, header, lastSettled, ringSnapshot, activeSnapshot] = await Promise.all([
    read(api, 'agents', 'eraNumber'),
    read(api, 'emissions', 'eraStartBlock'),
    api.rpc.chain.getHeader(),
    read(api, 'emissions', 'lastSettledEra'),
    read(api, 'agents', 'eraRingSnapshot'),
    read(api, 'agents', 'eraActiveSnapshot'),
  ]);

  const start = count(startBlock);
  const current = header.number.toNumber();
  const duration = count(constant(api, 'emissions', 'eraDuration'));
  const elapsed = current - start;
  const settled = lastSettled as unknown as { isSome: boolean; unwrap(): unknown };

  return {
    era: count(era),
    startBlock: start,
    durationBlocks: duration,
    currentBlock: current,
    blocksElapsed: elapsed,
    blocksRemaining: Math.max(0, duration - elapsed),
    dueForSettlement: elapsed >= duration,
    lastSettledEra: settled.isSome ? count(settled.unwrap()) : null,
    ringSnapshot: count(ringSnapshot),
    activeSnapshot: count(activeSnapshot),
  };
}

export interface EmissionsState {
  lastSettledEra: number | null;
  lastEraEmissionPlancks: string;
  /** Accumulator the per-agent reward claim is computed against. */
  accRewardPerStake: string;
  parameters: {
    eraDurationBlocks: number;
    initialEmissionPerEraPlancks: string;
    floorEmissionPerEraPlancks: string;
    targetEmissionPerAgentPlancks: string;
    /** Cap on the velocity bonus, in basis points (3000 bps = +30%). */
    velocityBonusBps: number;
    /** Oracle-accuracy bonus, in basis points (2000 bps = +20%). */
    oracleBonusBps: number;
    /** Era escrow volume an agent must clear before it earns anything. */
    minQualifyingVolumePlancks: string;
    unitVolumePlancks: string;
  };
}

export async function fetchEmissions(api: ApiPromise): Promise<EmissionsState> {
  const [lastSettled, lastEmission, acc] = await Promise.all([
    read(api, 'emissions', 'lastSettledEra'),
    read(api, 'emissions', 'lastEraEmission'),
    read(api, 'emissions', 'accRewardPerStake'),
  ]);
  const settled = lastSettled as unknown as { isSome: boolean; unwrap(): unknown };

  return {
    lastSettledEra: settled.isSome ? count(settled.unwrap()) : null,
    lastEraEmissionPlancks: plancks(lastEmission),
    accRewardPerStake: plancks(acc),
    parameters: {
      eraDurationBlocks: count(constant(api, 'emissions', 'eraDuration')),
      initialEmissionPerEraPlancks: constant(api, 'emissions', 'initialEmissionsPerEra').toString(),
      floorEmissionPerEraPlancks: constant(api, 'emissions', 'floorEmissionPerEra').toString(),
      targetEmissionPerAgentPlancks: constant(api, 'emissions', 'targetEmissionPerAgent').toString(),
      velocityBonusBps: count(constant(api, 'emissions', 'velocityBonusBps')),
      oracleBonusBps: count(constant(api, 'emissions', 'oracleBonusBps')),
      minQualifyingVolumePlancks: constant(api, 'emissions', 'minQualifyingVol').toString(),
      unitVolumePlancks: constant(api, 'emissions', 'unitVolume').toString(),
    },
  };
}

export interface SupplyState {
  capPlancks: string;
  totalIssuancePlancks: string;
  remainingPlancks: string;
  /** Share of the cap already issued, to 4 decimal places. */
  percentIssued: number;
  tokenSymbol: string;
  tokenDecimals: number;
}

/**
 * Issuance against the hard cap.
 *
 * The cap is the chain's one inviolable economic bound, so headroom is computed
 * in `bigint` from the runtime's own constant and the live total issuance —
 * never from a stored or derived figure that could drift from either.
 */
export async function fetchSupply(api: ApiPromise, chain: ChainConnection): Promise<SupplyState> {
  const issuance = await read(api, 'balances', 'totalIssuance');
  const cap = BigInt(constant(api, 'emissions', 'supplyCap').toString());
  const issued = BigInt(plancks(issuance));
  const remaining = cap > issued ? cap - issued : 0n;

  return {
    capPlancks: cap.toString(),
    totalIssuancePlancks: issued.toString(),
    remainingPlancks: remaining.toString(),
    // Scaled in bigint before the divide so the ratio never passes through a
    // float at full planck magnitude.
    percentIssued: cap === 0n ? 0 : Number((issued * 1_000_000n) / cap) / 10_000,
    tokenSymbol: chain.tokenSymbol,
    tokenDecimals: chain.tokenDecimals,
  };
}
