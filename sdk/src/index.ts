/**
 * @scalar-commons/sdk — TypeScript agent SDK for the Scalar Commons chain.
 *
 * Protocol §8.3: archetypes cannot exist without hands. This package is the
 * agent-facing surface of the chain — the "hands" that let an autonomous agent
 * register, stake, do escrow work, answer oracle requests, vote, and claim
 * emissions.
 *
 * Design rules:
 *  - polkadot-js (`@polkadot/api`) is the only transport.
 *  - No silent retries. Every retry is logged with its attempt number and the
 *    error that caused it (see {@link ./retry}).
 *  - Balances are plancks (1 CMN = 10^12 plancks) and are handled as `bigint`.
 */
import { ApiPromise, WsProvider } from '@polkadot/api';
import type { SubmittableExtrinsic, AddressOrPair } from '@polkadot/api/types';
import type { Codec } from '@polkadot/types/types';

import { submitAndWatch, type SubmitResult } from './submit.js';
import { consoleLogger, type Logger } from './logger.js';
import type { RetryOptions } from './retry.js';

export { consoleLogger, errorMessage, type Logger } from './logger.js';
export { withRetry, type RetryOptions } from './retry.js';
export { submitAndWatch, type SubmitResult } from './submit.js';

/** 1 CMN = 10^12 plancks. */
export const PLANCKS_PER_CMN = 1_000_000_000_000n;

/** Accumulator fixed-point scale used by pallet-emissions (`ACC_SCALE = 1 << 64`). */
export const ACC_SCALE = 1n << 64n;

/** A 32-byte hash accepted as a hex string (`0x…`) or a raw `Uint8Array`. */
export type Hash32 = string | Uint8Array;

/** Aggregate view of an era's timing and last settlement. */
export interface EraInfo {
  /** Current era number (`agents.eraNumber`). */
  era: number;
  /** Era length in blocks (`EraDuration` runtime constant). */
  eraDuration: bigint;
  /** Block at which the current era started (`emissions.eraStartBlock`). */
  eraStartBlock: bigint;
  /** Last era that was settled, or `null` if none has settled yet. */
  lastSettledEra: number | null;
  /** Amount minted at the last settlement, in plancks. */
  lastEraEmission: bigint;
  /** Whether the era is due for settlement at the current head block. */
  settleable: boolean;
}

/** Net economic position of an account. */
export interface NetPosition {
  /** Free (spendable) balance, in plancks. */
  free: bigint;
  /** Locked agent stake, in plancks (0 if not a registered agent). */
  stake: bigint;
  /** Escrow volume transacted this era, in plancks. */
  eraEscrowVolume: bigint;
  /** Unclaimed emissions the account could `claim()` right now, in plancks. */
  pendingEmissions: bigint;
  /** `free + stake + pendingEmissions`. A convenience roll-up. */
  total: bigint;
}

/** Options for constructing a {@link ScalarCommonsClient}. */
export interface ClientOptions extends RetryOptions {
  logger?: Logger;
}

/** Convert an optional/plain numeric codec into a `bigint` (missing → 0). */
function toBig(value: Codec | null | undefined): bigint {
  if (value == null) return 0n;
  const anyVal = value as unknown as { isSome?: boolean; unwrap?: () => Codec };
  if (typeof anyVal.isSome === 'boolean') {
    return anyVal.isSome && anyVal.unwrap ? BigInt(anyVal.unwrap().toString()) : 0n;
  }
  const s = value.toString();
  return s.length === 0 ? 0n : BigInt(s);
}

/**
 * High-level, typed wrapper over the Scalar Commons runtime.
 *
 * Every write method signs with the supplied {@link AddressOrPair}, waits for
 * in-block inclusion, and returns the block/tx hashes plus the attempt count.
 */
export class ScalarCommonsClient {
  readonly api: ApiPromise;
  private readonly options: ClientOptions;

  constructor(api: ApiPromise, options: ClientOptions = {}) {
    this.api = api;
    this.options = { logger: consoleLogger, ...options };
  }

  /** Connect to a node over WebSocket and build a ready client. */
  static async connect(endpoint: string, options: ClientOptions = {}): Promise<ScalarCommonsClient> {
    const provider = new WsProvider(endpoint);
    const api = await ApiPromise.create({ provider });
    await api.isReady;
    return new ScalarCommonsClient(api, options);
  }

  /** Disconnect the underlying provider. */
  async disconnect(): Promise<void> {
    await this.api.disconnect();
  }

  private submit(
    tx: SubmittableExtrinsic<'promise'>,
    signer: AddressOrPair,
    label: string,
  ): Promise<SubmitResult> {
    return submitAndWatch(this.api, tx, signer, label, this.options);
  }

  // ─── Write methods ─────────────────────────────────────────────────────────

  /** Register as an agent, locking `stake` plancks. → `agents.register`. */
  register(signer: AddressOrPair, stake: bigint): Promise<SubmitResult> {
    return this.submit(this.api.tx.agents.register(stake), signer, 'register');
  }

  /** Add `amount` plancks to the caller's existing stake. → `agents.addStake`. */
  stake(signer: AddressOrPair, amount: bigint): Promise<SubmitResult> {
    return this.submit(this.api.tx.agents.addStake(amount), signer, 'stake');
  }

  /** Prove liveness for the emissions heartbeat multiplier. → `agents.heartbeat`. */
  heartbeat(signer: AddressOrPair): Promise<SubmitResult> {
    return this.submit(this.api.tx.agents.heartbeat(), signer, 'heartbeat');
  }

  /**
   * Open an escrow agreement as buyer against `provider`. → `escrow.createAgreement`.
   * `capabilityId` is optional; pass `null`/omit for a generic agreement.
   */
  createEscrow(
    signer: AddressOrPair,
    provider: string,
    amount: bigint,
    deliverableHash: Hash32,
    deliverBy: bigint | number,
    capabilityId: number | null = null,
  ): Promise<SubmitResult> {
    return this.submit(
      this.api.tx.escrow.createAgreement(provider, amount, deliverableHash, deliverBy, capabilityId),
      signer,
      'createEscrow',
    );
  }

  /** Record delivery as the provider on a buyer's agreement. → `escrow.recordDelivery`. */
  acceptEscrow(
    signer: AddressOrPair,
    buyer: string,
    seq: number,
    deliveryHash: Hash32,
  ): Promise<SubmitResult> {
    return this.submit(
      this.api.tx.escrow.recordDelivery(buyer, seq, deliveryHash),
      signer,
      'acceptEscrow',
    );
  }

  /** Confirm a delivered agreement as the buyer, releasing funds. → `escrow.confirmDelivery`. */
  completeEscrow(signer: AddressOrPair, provider: string, seq: number): Promise<SubmitResult> {
    return this.submit(
      this.api.tx.escrow.confirmDelivery(provider, seq),
      signer,
      'completeEscrow',
    );
  }

  /** Submit an oracle answer for a request. → `oracle.submitResponse`. */
  submitOracle(
    signer: AddressOrPair,
    requestId: Hash32,
    answerHash: Hash32,
    capability: number,
  ): Promise<SubmitResult> {
    return this.submit(
      this.api.tx.oracle.submitResponse(requestId, answerHash, capability),
      signer,
      'submitOracle',
    );
  }

  /**
   * Cast a conviction vote on an OpenGov poll. → `convictionVoting.vote`.
   * `vote` is the polkadot-js `AccountVote` shape, e.g.
   * `{ Standard: { vote: { aye: true, conviction: 'Locked1x' }, balance } }`.
   */
  vote(signer: AddressOrPair, pollIndex: number, vote: unknown): Promise<SubmitResult> {
    return this.submit(
      this.api.tx.convictionVoting.vote(pollIndex, vote),
      signer,
      'vote',
    );
  }

  /** Permissionlessly settle the current era once it is due. → `emissions.settleEra`. */
  settleEra(signer: AddressOrPair): Promise<SubmitResult> {
    return this.submit(this.api.tx.emissions.settleEra(), signer, 'settleEra');
  }

  /** Claim accrued emissions for the caller. → `emissions.claim`. */
  claim(signer: AddressOrPair): Promise<SubmitResult> {
    return this.submit(this.api.tx.emissions.claim(), signer, 'claim');
  }

  // ─── Read methods ────────────────────────────────────────────────────────

  /** Aggregate era timing/settlement info. */
  async eraInfo(): Promise<EraInfo> {
    const [eraCodec, startCodec, lastSettledCodec, lastEmissionCodec, headerNow] = await Promise.all([
      this.api.query.agents.eraNumber(),
      this.api.query.emissions.eraStartBlock(),
      this.api.query.emissions.lastSettledEra(),
      this.api.query.emissions.lastEraEmission(),
      this.api.query.system.number(),
    ]);

    const eraDuration = BigInt(this.api.consts.emissions.eraDuration.toString());
    const eraStartBlock = toBig(startCodec);
    const now = toBig(headerNow);

    const lastSettledAny = lastSettledCodec as unknown as { isSome?: boolean; unwrap?: () => Codec };
    const lastSettledEra =
      typeof lastSettledAny.isSome === 'boolean' && lastSettledAny.isSome && lastSettledAny.unwrap
        ? Number(lastSettledAny.unwrap().toString())
        : null;

    return {
      era: Number(eraCodec.toString()),
      eraDuration,
      eraStartBlock,
      lastSettledEra,
      lastEraEmission: toBig(lastEmissionCodec),
      settleable: now >= eraStartBlock + eraDuration,
    };
  }

  /** The agent's emission weight snapshot (`emissions.agentWeightSnapshot`). */
  async weightOf(address: string): Promise<bigint> {
    const weight = await this.api.query.emissions.agentWeightSnapshot(address);
    return toBig(weight);
  }

  /** Full economic position: free balance, stake, era escrow volume, pending emissions. */
  async netPosition(address: string): Promise<NetPosition> {
    const [accountCodec, stakeCodec, escrowVolCodec, accCodec, debtCodec, weightCodec] =
      await Promise.all([
        this.api.query.system.account(address),
        this.api.query.agents.agentStake(address),
        this.api.query.agents.eraEscrowVolume(address),
        this.api.query.emissions.accRewardPerStake(),
        this.api.query.emissions.agentRewardDebt(address),
        this.api.query.emissions.agentWeightSnapshot(address),
      ]);

    const free = toBig((accountCodec as unknown as { data: { free: Codec } }).data.free);
    const stake = toBig(stakeCodec);
    const eraEscrowVolume = toBig(escrowVolCodec);

    // Mirror pallet-emissions::do_claim: pending = (acc - debt) * weight / ACC_SCALE.
    const acc = toBig(accCodec);
    const debt = toBig(debtCodec);
    const weight = toBig(weightCodec);
    let pendingEmissions = 0n;
    if (acc > debt && weight > 0n) {
      pendingEmissions = ((acc - debt) * weight) / ACC_SCALE;
    }

    return {
      free,
      stake,
      eraEscrowVolume,
      pendingEmissions,
      total: free + stake + pendingEmissions,
    };
  }
}

export default ScalarCommonsClient;
