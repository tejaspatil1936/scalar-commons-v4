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
}

/** The index page: which chain this is, and where its head currently sits. */
export interface HomeView {
  readonly chain: ChainInfo;
  readonly head: { readonly number: number; readonly hash: string };
}
