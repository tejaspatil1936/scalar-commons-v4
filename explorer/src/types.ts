/**
 * View models the explorer renders.
 *
 * These types are deliberately plain data: everything SCALE-typed is decoded in
 * `chain.ts` against the runtime metadata the node serves, and only the decoded
 * result reaches the renderer. That split is what keeps the HTML layer free of
 * guessed type shapes — the renderer cannot invent a field the chain did not
 * report, because it never sees a `Codec`.
 */

/** Static facts about the connected runtime, read from metadata at connect time. */
export interface ChainInfo {
  readonly chain: string;
  readonly specName: string;
  readonly specVersion: number;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly ss58Format: number;
  readonly genesisHash: string;
  /** The node's version string from `system_version`, read at connect time; absent in a reduced view. */
  readonly nodeVersion?: string;
}

/**
 * What the runtime did with a dispatch.
 *
 * `unknown` is a real state, not a placeholder: the events of a block can be
 * pruned on an archive-less node, and an explorer that printed "success" in that
 * case would be asserting something it did not read.
 */
export type Outcome =
  | { readonly kind: 'success' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'unknown' };

/** One row in a block's extrinsic list. */
export interface ExtrinsicSummary {
  readonly index: number;
  readonly section: string;
  readonly method: string;
  readonly hash: string;
  readonly isSigned: boolean;
  readonly signer: string | null;
  readonly outcome: Outcome;
  /** The events the extrinsic emitted, when the view read them (the block page groups them). */
  readonly events?: readonly EventView[];
}

/** A block, with enough header detail to walk backwards through history. */
export interface BlockView {
  readonly number: number;
  readonly hash: string;
  readonly parentHash: string;
  readonly stateRoot: string;
  readonly extrinsicsRoot: string;
  /** Milliseconds, as the timestamp pallet stores it; null when the block has no inherent. */
  readonly timestampMs: bigint | null;
  readonly specVersion: number;
  readonly extrinsics: readonly ExtrinsicSummary[];
  /** The receipt readings beyond the header; absent when only the header was read. */
  readonly detail?: BlockDetail;
}

/** One decoded call argument, with the type name the metadata gave it. */
export interface ExtrinsicArg {
  readonly name: string;
  readonly type: string;
  readonly value: string;
}

/** One event emitted while the extrinsic was applied. */
export interface EventView {
  readonly index: number;
  readonly section: string;
  readonly method: string;
  readonly fields: readonly { readonly name: string; readonly value: string }[];
}

/** A single extrinsic, addressed by (block, index) — its only stable coordinate. */
export interface ExtrinsicView {
  readonly block: { readonly number: number; readonly hash: string };
  readonly index: number;
  readonly hash: string;
  readonly section: string;
  readonly method: string;
  readonly isSigned: boolean;
  readonly signer: string | null;
  readonly nonce: number | null;
  readonly tip: bigint | null;
  readonly lengthBytes: number;
  readonly args: readonly ExtrinsicArg[];
  readonly events: readonly EventView[];
  readonly outcome: Outcome;
  /** Every account the call arguments or emitted events named, signer first. */
  readonly accounts: readonly string[];
  /** Set for `escrow.disputeDelivery`: the terms the runtime fixes for what happens next. */
  readonly disputeTerms?: DisputeTerms;
  readonly renderedAt?: string;
}

/**
 * An account: the state the runtime holds for it, read at one specific block.
 *
 * The block the read happened at is part of the view model on purpose. Account
 * state is a moving target, so a page that printed a balance without saying
 * when it was true would be asserting more than it read.
 */
export interface AccountView {
  readonly address: string;
  readonly publicKey: string;
  readonly free: bigint;
  readonly reserved: bigint;
  readonly frozen: bigint;
  readonly nonce: number;
  /** The block the account state was read at. */
  readonly at: { readonly number: number; readonly hash: string };
  readonly roles?: AccountRoles;
  /** The account's history from the index; absent when the server did not ask. */
  readonly history?: Read<readonly HistoryEntry[]>;
}

/** The index page: which chain this is, and where its head currently sits. */
export interface HomeView {
  readonly chain: ChainInfo;
  readonly head: { readonly number: number; readonly hash: string };
  /** The live readings; absent only in a reduced view. */
  readonly readings?: HomeReadings;
  readonly indexer?: Read<IndexerStatus>;
}

/**
 * One field of an activity event, typed from the runtime metadata.
 *
 * The indexer serves event data as plain JSON and drops the metadata types on
 * the way. The explorer puts them back from its own connection's metadata, so a
 * balance is printed in tokens because the runtime says it is a balance — not
 * because its field happens to be called `amount`.
 */
export interface ActivityField {
  readonly name: string;
  readonly value: string;
  readonly kind: 'account' | 'balance' | 'plain';
}

/** One row of the agent-activity feed. */
export interface ActivityEntry {
  /** `<block>-<event index>`, as the indexer names it. */
  readonly id: string;
  readonly blockNumber: number;
  /** The extrinsic that emitted the event; null for block-hook events. */
  readonly extrinsicIndex: number | null;
  readonly timestampMs: bigint | null;
  /** The indexer's family for the event: `heartbeat`, `dispute`, `slash`, … */
  readonly kind: string;
  readonly section: string;
  readonly method: string;
  readonly agents: readonly string[];
  readonly fields: readonly ActivityField[];
}

/** A page of the agent-activity feed, newest first. */
export interface ActivityView {
  /** The agent the feed is filtered to, or null for every agent. */
  readonly agent: string | null;
  readonly offset: number;
  readonly limit: number;
  /** Every matching row the index holds, not just this page. */
  readonly total: number;
  /** The oldest block the indexer holds: the feed reaches no further back. */
  readonly historyFrom: number | null;
  readonly entries: readonly ActivityEntry[];
  /** The agent-scoped readings; set when `agent` is set and the server asked the index. */
  readonly agentReadings?: AgentReadings;
}

/**
 * Where a figure came from. `method` names the kind of read (`RPC`, `STORAGE`,
 * `META` for a runtime constant read from metadata, `GET` for the indexer),
 * `url` the item (`chain_getHeader`, `emissions.eraStartBlock`, …),
 * `fetchedAt` the render time, `block` the best block at render, `raw` null
 * (the explorer serves no raw-bytes endpoint), `computed` the derivation when
 * the figure is derived. Every Reading on a page carries one.
 */
export interface Source {
  readonly method: string;
  readonly url: string;
  readonly fetchedAt: string | null;
  readonly block: number | null;
  readonly raw: string | null;
  readonly computed?: string | null;
}

/**
 * One read off the node or the index, with its receipt. A read that failed
 * keeps its source and carries the reason: the page renders `unavailable` and
 * the reason, never a guess.
 */
export type Read<T> =
  | { readonly value: T; readonly source: Source; readonly reason: null }
  | { readonly value: null; readonly source: Source; readonly reason: string };

/** One of the last blocks the home page read, for the Spine and the ledgers. */
export interface RecentBlock {
  readonly number: number;
  readonly hash: string;
  readonly timestampMs: bigint | null;
  readonly author: string | null;
  readonly extrinsics: readonly ExtrinsicSummary[];
  /** Every event in the block, in the node's order, with the extrinsic it belongs to. */
  readonly events: readonly (EventView & { readonly extrinsicIndex: number | null })[];
}

/** An extrinsic waiting in the node's pool, from `author_pendingExtrinsics`. */
export interface PendingExtrinsic {
  readonly hash: string;
  readonly section: string;
  readonly method: string;
  readonly signer: string | null;
}

/** The live readings the home page shows, each with its receipt. */
export interface HomeReadings {
  readonly renderedAt: string;
  /** Milliseconds between the best block's timestamp and the render; null when the block has no timestamp. */
  readonly headAgeMs: number | null;
  readonly finalized: Read<{ readonly number: number; readonly hash: string }>;
  readonly era: Read<{ readonly number: number; readonly elapsed: number; readonly length: number }>;
  readonly session: Read<{ readonly index: number; readonly elapsed: number; readonly length: number }>;
  readonly validators: Read<number>;
  readonly issuance: Read<bigint>;
  readonly recent: Read<readonly RecentBlock[]>;
  readonly pending: Read<readonly PendingExtrinsic[]>;
}

/** What the indexer says about itself, read at render for the footer line. */
export interface IndexerStatus {
  readonly syncedHeight: number;
}

/** The extra facts the block page reads beyond the header, each with its receipt. */
export interface BlockDetail {
  readonly renderedAt: string;
  readonly best: number;
  readonly finalized: Read<boolean>;
  readonly author: Read<string | null>;
  readonly slot: Read<string | null>;
  readonly era: Read<number>;
  readonly session: Read<number>;
  readonly weight: Read<string>;
  /** Every event in the block in the node's order, with the extrinsic it belongs to. */
  readonly events: readonly (EventView & { readonly extrinsicIndex: number | null })[];
}

/** The dispute terms the runtime fixes, read from metadata for `escrow.disputeDelivery`. */
export interface DisputeTerms {
  readonly bountyBps: Read<number>;
  readonly burnBps: Read<number>;
  readonly settles: Read<string>;
}

/** What the chain says about an account beyond its balances: agent and staking roles. */
export interface AccountRoles {
  readonly renderedAt: string;
  readonly agentName: Read<string | null>;
  readonly agentStake: Read<bigint | null>;
  readonly bonded: Read<string | null>;
  readonly validator: Read<boolean>;
  /**
   * The agent's heartbeat against the head (`agents.lastHeartbeat`), with the
   * two runtime constants the decay rule reads (`heartbeatGracePeriod`,
   * `heartbeatDecayPeriod`); null for an account that is not an agent.
   * Optional: a view that did not read it renders no DECAYED tag.
   */
  readonly heartbeat?: Read<HeartbeatState | null>;
}

/** `pallets/agents/src/lib.rs` `heartbeat_multiplier`, as read at one head. */
export interface HeartbeatState {
  readonly lastHeartbeat: number;
  readonly best: number;
  readonly grace: number;
  readonly decay: number;
}

/**
 * The decay rule, line for line with `heartbeat_multiplier`
 * (pallets/agents/src/lib.rs:1987): 100 % while `best − lastHeartbeat` is
 * within the grace period, then falling linearly by 90 points over the decay
 * period to a 10 % floor (integer division, as the pallet does it).
 */
export function heartbeatMultiplier(h: HeartbeatState): number {
  const since = Math.max(0, h.best - h.lastHeartbeat);
  if (since <= h.grace) return 100;
  const decay = Math.max(1, h.decay);
  const over = Math.min(since - h.grace, h.decay);
  return Math.max(10, 100 - Math.floor((90 * over) / decay));
}

/** One row of an account's history, from the index's `/v1/accounts/:address/extrinsics`. */
export interface HistoryEntry {
  readonly blockNumber: number;
  readonly index: number;
  readonly section: string;
  readonly method: string;
  readonly timestampMs: bigint | null;
  readonly success: boolean | null;
}

/** The agent-scoped readings of the activity page, from the index. */
export interface AgentReadings {
  readonly renderedAt: string;
  readonly earnedAllTime: Read<bigint | null>;
  readonly earnedThisEra: Read<bigint | null>;
  readonly agreementsOpen: Read<number | null>;
  readonly inDispute: Read<number | null>;
  readonly counterparties: Read<readonly { readonly address: string; readonly count: number }[]>;
  readonly earningsByEra: Read<readonly { readonly era: number; readonly amount: bigint }[]>;
  readonly decayed: boolean;
  readonly cooldown: boolean;
  readonly name: string | null;
}

/**
 * Decayed: the head is past the last heartbeat by more than
 * `HeartbeatGracePeriod`, the bound the pallet names as the point "before
 * heartbeat decay begins" (pallets/agents/src/lib.rs:318). No other threshold.
 */
export const heartbeatDecayed = (h: HeartbeatState): boolean => h.best - h.lastHeartbeat > h.grace;
