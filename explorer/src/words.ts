/**
 * The chain in plain words (SITE-REDESIGN.md §6).
 *
 * One table from `pallet.Event` to a sentence a visitor can read, shared by the
 * activity feed, the block page's event list and the extrinsic page; one from
 * `pallet.call` to what the call does; and the classification of events into
 * the activity kinds (the indexer's families, mirrored here because the
 * per-agent event route serves rows without a kind). Every row keeps the raw
 * name beside the words, in a `title`, so nothing is hidden — only translated.
 *
 * Pure functions. An event the table does not know is still shown, as its
 * method name split into words, never dropped and never guessed at.
 */

import { escapeHtml, formatCmn, formatBalance, humanize } from './format.js';
import { address, truncateMiddle } from './chrome-templates.js';
import { accountPath } from './routes.js';

/** The activity families, as the indexer names them, with the chip word for each. */
export const KINDS = ['agreement', 'dispute', 'message', 'registration', 'slash', 'heartbeat', 'oracle_vote'] as const;
export type Kind = (typeof KINDS)[number];

/** The chips on the activity page (§5.2 step 4), in order. `kind` null is "All". */
export const CHIPS: readonly { readonly label: string; readonly kind: Kind | null }[] = [
  { label: 'All', kind: null },
  { label: 'Agreements', kind: 'agreement' },
  { label: 'Disputes', kind: 'dispute' },
  { label: 'Messages', kind: 'message' },
  { label: 'Registrations', kind: 'registration' },
  { label: 'Slashes', kind: 'slash' },
];

interface EventWords {
  /** The event in plain words. */
  readonly label: string;
  /** The status badge the row carries, when the event is one. */
  readonly badge?: 'Dispute' | 'Slashed' | 'Failed';
  readonly kind?: Kind;
  /** Fields left out of the details (noise a visitor cannot use). */
  readonly omit?: readonly string[];
}

/** `pallet.Event` → words. Sections as polkadot-js names them (lower-case first letter). */
const EVENTS: Readonly<Record<string, EventWords>> = {
  'agents.AgentRegistered': { label: 'Agent registered', kind: 'registration' },
  'agents.AgentDeregistered': { label: 'Agent deregistered' },
  'agents.HeartbeatSent': { label: 'Heartbeat sent', kind: 'heartbeat' },
  'agents.MetadataUpdated': { label: 'Agent metadata updated' },
  'agents.CapabilitiesUpdated': { label: 'Agent capabilities updated' },
  'agents.UnstakeRequested': { label: 'Unstake requested' },
  'agents.Unstaked': { label: 'Stake withdrawn' },
  'agents.SlashExecuted': { label: 'Agent slashed', badge: 'Slashed', kind: 'slash' },
  'agents.SlashAppealed': { label: 'Slash appealed', badge: 'Slashed', kind: 'slash' },
  'agents.SlashAppealWithdrawn': { label: 'Slash appeal withdrawn', badge: 'Slashed', kind: 'slash' },
  'escrow.AgreementCreated': { label: 'Agreement opened', kind: 'agreement' },
  'escrow.AgreementAccepted': { label: 'Agreement accepted', kind: 'agreement' },
  'escrow.AgreementRejected': { label: 'Agreement rejected', kind: 'agreement' },
  'escrow.PendingCancelled': { label: 'Agreement cancelled', kind: 'agreement' },
  'escrow.AgreementExpired': { label: 'Agreement expired', kind: 'agreement' },
  'escrow.DeliveryRecorded': { label: 'Delivery recorded', kind: 'agreement' },
  'escrow.DeliveryConfirmed': { label: 'Delivery confirmed, provider paid', kind: 'agreement' },
  'escrow.RefundClaimed': { label: 'Refund claimed', kind: 'agreement' },
  'escrow.DeadlineExtended': { label: 'Deadline extended', kind: 'agreement' },
  'escrow.DisputeOpened': { label: 'Dispute opened', badge: 'Dispute', kind: 'dispute' },
  'escrow.DisputeResolved': { label: 'Dispute resolved', badge: 'Dispute', kind: 'dispute' },
  'oracle.OracleRequestCreated': { label: 'Oracle question asked' },
  'oracle.OracleResponseSubmitted': { label: 'Oracle answer submitted', kind: 'oracle_vote' },
  'oracle.BatchResponseSubmitted': { label: 'Oracle answers submitted', kind: 'oracle_vote' },
  'oracle.OracleRequestFinalized': { label: 'Oracle question answered' },
  'oracle.OracleRequestExpired': { label: 'Oracle question expired' },
  'messages.MessageSent': { label: 'Message sent', kind: 'message' },
  'emissions.EraSettled': { label: 'Era settled' },
  'emissions.RewardsClaimed': { label: 'Rewards claimed' },
  'emissions.RewardClaimed': { label: 'Reward claimed' },
  'balances.Transfer': { label: 'Transfer' },
  'balances.Withdraw': { label: 'Balance withdrawn' },
  'balances.Deposit': { label: 'Balance deposited' },
  'balances.Reserved': { label: 'Balance reserved' },
  'balances.Unreserved': { label: 'Balance unreserved' },
  'balances.Endowed': { label: 'Account endowed' },
  'balances.Slashed': { label: 'Balance slashed', badge: 'Slashed' },
  'balances.Locked': { label: 'Balance locked' },
  'balances.Unlocked': { label: 'Balance unlocked' },
  'balances.Issued': { label: 'Tokens issued' },
  'balances.Burned': { label: 'Tokens burned' },
  'transactionPayment.TransactionFeePaid': { label: 'Transaction fee paid' },
  'system.ExtrinsicSuccess': { label: 'Extrinsic succeeded', omit: ['dispatch_info', 'dispatchInfo'] },
  'system.ExtrinsicFailed': { label: 'Extrinsic failed', badge: 'Failed', omit: ['dispatch_info', 'dispatchInfo'] },
  'system.NewAccount': { label: 'New account' },
  'system.KilledAccount': { label: 'Account removed' },
  'system.CodeUpdated': { label: 'Runtime upgraded' },
  'session.NewSession': { label: 'New session' },
  'staking.EraPaid': { label: 'Validator era paid' },
  'staking.Rewarded': { label: 'Validator rewarded' },
  'staking.Bonded': { label: 'Stake bonded' },
  'staking.Unbonded': { label: 'Stake unbonded' },
  'staking.Withdrawn': { label: 'Stake withdrawn' },
  'staking.ValidatorPrefsSet': { label: 'Validator preferences set' },
  'staking.StakersElected': { label: 'Validators elected' },
  'grandpa.NewAuthorities': { label: 'New finality authorities' },
  'sudo.Sudid': { label: 'Sudo call made' },
  'sudo.KeyChanged': { label: 'Sudo key changed' },
  'utility.BatchCompleted': { label: 'Batch completed' },
  'utility.ItemCompleted': { label: 'Batch item completed' },
  'utility.BatchInterrupted': { label: 'Batch interrupted', badge: 'Failed' },
  'constitution.ParameterChanged': { label: 'Constitution parameter changed' },
  'autoParams.ParameterAdjusted': { label: 'Parameter adjusted' },
  'orchestrator.SubAgentLinked': { label: 'Sub-agent linked' },
  'orchestrator.SubAgentUnlinked': { label: 'Sub-agent unlinked' },
};

/** The words for an event: the table's, or the method name split into words. */
export function eventWords(section: string, method: string): EventWords {
  return EVENTS[`${section}.${method}`] ?? { label: humanize(method) };
}

/** The activity kind of an event, or null when it is not agent activity (the indexer's families, exactly). */
export function kindOf(section: string, method: string): Kind | null {
  if (section === 'messages' || section === 'messaging' || section === 'agentMessaging') return 'message';
  return EVENTS[`${section}.${method}`]?.kind ?? null;
}

/** `pallet.call` → what it does, for the extrinsic page and the extrinsic lists. */
const CALLS: Readonly<Record<string, string>> = {
  'agents.register': 'Register as an agent',
  'agents.registerAgent': 'Register as an agent',
  'agents.heartbeat': 'Send a heartbeat',
  'agents.sendHeartbeat': 'Send a heartbeat',
  'agents.requestUnstake': 'Request to unstake',
  'agents.unstake': 'Withdraw stake',
  'agents.setMetadata': 'Set agent metadata',
  'agents.setCapabilities': 'Set agent capabilities',
  'agents.appealSlash': 'Appeal a slash',
  'agents.withdrawAppeal': 'Withdraw a slash appeal',
  'escrow.createAgreement': 'Open an agreement',
  'escrow.acceptAgreement': 'Accept an agreement',
  'escrow.rejectAgreement': 'Reject an agreement',
  'escrow.cancelPending': 'Cancel a pending agreement',
  'escrow.recordDelivery': 'Record a delivery',
  'escrow.confirmDelivery': 'Confirm a delivery',
  'escrow.disputeDelivery': 'Dispute a delivery',
  'escrow.claimRefund': 'Claim a refund',
  'escrow.extendDeadline': 'Extend a deadline',
  'oracle.createRequest': 'Ask an oracle question',
  'oracle.submitResponse': 'Answer an oracle question',
  'oracle.submitBatchResponse': 'Answer oracle questions in a batch',
  'messages.sendMessage': 'Send a message',
  'messages.send': 'Send a message',
  'emissions.settleEra': 'Settle the era',
  'emissions.claimRewards': 'Claim rewards',
  'emissions.claimReward': 'Claim a reward',
  'balances.transfer': 'Transfer tokens',
  'balances.transferKeepAlive': 'Transfer tokens (keeping the sender alive)',
  'balances.transferAllowDeath': 'Transfer tokens (the sender may be emptied)',
  'balances.transferAll': 'Transfer the whole balance',
  'timestamp.set': 'Set the block time (inherent)',
  'system.remark': 'Leave a remark',
  'system.remarkWithEvent': 'Leave a remark',
  'system.setCode': 'Upgrade the runtime',
  'utility.batch': 'Run a batch of calls',
  'utility.batchAll': 'Run a batch of calls (all or nothing)',
  'sudo.sudo': 'Run a call as sudo',
  'staking.bond': 'Bond stake',
  'staking.validate': 'Declare as a validator',
  'session.setKeys': 'Set session keys',
  'parachainSystem.setValidationData': 'Set validation data (inherent)',
};

/** What a call does, in words; the method name split into words when the table does not know it. */
export function callWords(section: string, method: string): string {
  return CALLS[`${section}.${method}`] ?? humanize(method);
}

export interface Field {
  readonly name: string;
  readonly value: string;
  readonly kind?: 'account' | 'balance' | 'plain';
}

const SS58 = /^[1-9A-HJ-NP-Za-km-z]{40,}$/;
const DIGITS = /^\d[\d,]*$/;
const HEX = /^0x[0-9a-f]{32,}$/i;
/** Field names that hold plancks when they hold digits. */
const MONEY = /^(amount|actual_?fee|fee|stake|tip|value|bounty|reward|total_?emission|emission|deposit|free|reserved|balance|released|burned|refund|payout)$/i;

/** The names of the fields that are accounts: typed as such, or an SS58 string. */
export const accountFields = (fields: readonly Field[]): string[] =>
  fields.filter((f) => f.kind === 'account' || (f.kind !== 'balance' && SS58.test(f.value))).map((f) => f.value);

/**
 * The details of an event in words: the fields that matter, each formatted by
 * what it is (a balance in CMN with the full value in `title`, a hash
 * truncated, a number with separators). `showAccounts` false leaves the
 * accounts out, for a table that already names them in an Agents column.
 * Empty when nothing is left to say.
 */
export function describeEvent(section: string, method: string, fields: readonly Field[], token: { decimals: number; symbol: string }, { showAccounts = true }: { showAccounts?: boolean } = {}): string {
  const omit = new Set(eventWords(section, method).omit ?? []);
  const parts: string[] = [];
  for (const f of fields) {
    if (omit.has(f.name)) continue;
    const isAccount = f.kind === 'account' || (f.kind !== 'balance' && SS58.test(f.value));
    if (isAccount) {
      if (showAccounts) parts.push(address(f.value, { href: accountPath(f.value) }));
      continue;
    }
    const label = humanize(f.name).toLowerCase();
    if ((f.kind === 'balance' || MONEY.test(f.name)) && DIGITS.test(f.value)) {
      const plancks = BigInt(f.value.replace(/,/g, ''));
      if (f.name === 'tip' && plancks === 0n) continue;
      parts.push(`${label} <span title="${escapeHtml(formatBalance(plancks, token.decimals, token.symbol))}">${escapeHtml(formatCmn(plancks, token.decimals, token.symbol))}</span>`);
      continue;
    }
    if (HEX.test(f.value)) {
      parts.push(`${label} <span class="sc-mono" title="${escapeHtml(f.value)}">${escapeHtml(truncateMiddle(f.value, 8, 6))}</span>`);
      continue;
    }
    if (f.name === 'seq' && DIGITS.test(f.value)) {
      parts.push(`agreement #${escapeHtml(f.value)}`);
      continue;
    }
    const value = f.value.length > 80 ? `${f.value.slice(0, 77)}…` : f.value;
    parts.push(`${label} ${escapeHtml(value)}`);
  }
  return parts.join(' · ');
}
