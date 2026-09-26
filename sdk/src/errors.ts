/**
 * A dispatch error the runtime returned for an extrinsic that *was* included in a block.
 *
 * Economic why: inclusion already charged the fee. The outcome is decided by chain
 * state and the call's arguments, so resubmitting the same call earns the same
 * error and burns another fee (#160). These errors are therefore never retried.
 */
export class DispatchFailure extends Error {
  constructor(
    /** Pallet name, e.g. `escrow` (`system` for non-module errors such as `BadOrigin`). */
    readonly section: string,
    /** Error variant, e.g. `MinDeliveryBlocksNotElapsed`, `BadOrigin`, `InsufficientBalance`. */
    readonly errorName: string,
    docs: string,
  ) {
    super(`${section}.${errorName}${docs ? `: ${docs}` : ''}`);
    this.name = 'DispatchFailure';
  }
}

/** Dispatch errors that are a pure function of chain state and call arguments (#160). */
const DETERMINISTIC_NAMES = new Set(['MinDeliveryBlocksNotElapsed', 'BadOrigin']);

/**
 * True when retrying `err` cannot change the outcome: a {@link DispatchFailure}
 * named `MinDeliveryBlocksNotElapsed`, `BadOrigin` or `Insufficient*` (#160).
 *
 * The list is deliberately explicit rather than "every dispatch error": other
 * module errors (e.g. `NotRegistered`) can clear between attempts, and the
 * existing retry-logging contract treats them as retryable. Transport failures
 * and pool statuses (`Dropped`, `Invalid`, `Usurped`) never reached dispatch and
 * stay retryable.
 */
export function isDeterministicFailure(err: unknown): boolean {
  if (!(err instanceof DispatchFailure)) return false;
  return DETERMINISTIC_NAMES.has(err.errorName) || err.errorName.startsWith('Insufficient');
}
