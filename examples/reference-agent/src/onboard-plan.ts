/**
 * Pure decisions behind `scalar-onboard` (./onboard.ts), kept apart so they
 * are unit-tested offline.
 *
 * The one rule this file encodes: onboarding never spends on its own. It
 * reports the next step; locking stake and burning the registration fee
 * happen only when a human runs `register --yes`.
 */

const PLANCKS_PER_CMN = 10n ** 12n;

/** Exact decimal CMN for display. A float would misprint balances above 2^53 plancks (≈ 9 007 CMN). */
export function formatCmn(plancks: bigint): string {
  const whole = plancks / PLANCKS_PER_CMN;
  const frac = (plancks % PLANCKS_PER_CMN).toString().padStart(12, '0').replace(/0+$/, '');
  return frac === '' ? whole.toString() : `${whole}.${frac}`;
}

export interface RegistrationCosts {
  /** Stake locked by `agents.register` (≥ `agents.minStake`). */
  stake: bigint;
  /** `agents.baseRegistrationFee`, burned. */
  registrationFee: bigint;
  /** `balances.existentialDeposit`. */
  existentialDeposit: bigint;
}

/** Free balance `agents.register` needs — the same check the daemon makes before registering. */
export function registrationNeed(c: RegistrationCosts): bigint {
  return c.stake + c.registrationFee + c.existentialDeposit;
}

export type Step = 'faucet' | 'register' | 'heartbeat';

export function nextStep(s: { registered: boolean; free: bigint; need: bigint }): { step: Step; message: string } {
  if (s.registered) {
    return { step: 'heartbeat', message: 'registered — next: heartbeat (the safe test transaction, ~0.0001 test CMN fee)' };
  }
  if (s.free < s.need) {
    return {
      step: 'faucet',
      message: `not registered, and free ${formatCmn(s.free)} CMN < ${formatCmn(s.need)} CMN needed — next: faucet`,
    };
  }
  return {
    step: 'register',
    message:
      `not registered; balance covers it — next: register --yes ` +
      `(locks the stake and burns the registration fee, in test CMN)`,
  };
}

export interface IndexedExtrinsic {
  id: string;
  hash: string;
  section: string;
  method: string;
  success: boolean;
}

/** The extrinsic with `hash` in a `/v1/accounts/:address/extrinsics` page, if the indexer has it yet. */
export function findTx<T extends IndexedExtrinsic>(items: T[], hash: string): T | undefined {
  const h = hash.toLowerCase();
  return items.find((x) => x.hash.toLowerCase() === h);
}
