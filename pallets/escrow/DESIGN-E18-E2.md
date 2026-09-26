# DESIGN — E18 + E2: provider consent and an exit for stuck agreements (#180)

Additive storage only. No existing struct is edited, no migration, no `spec_version` change
is required by this pallet change (the new calls are appended at call indices 6–9).

## Problems

- **E18.** `create_agreement` increments the provider's `ActiveEscrowCount` with no consent from
  the provider. Any registered buyer can pin an agent's count for the price of one locked
  agreement, and `request_unstake` / `complete_unstake` refuse while the count is non-zero.
- **E2.** An agreement that is never delivered has no exit except the dispute path or
  `claim_refund` after `deliver_by + BuyerResponseWindow`, and nobody but the buyer can trigger it.

## Design

| Element | Change |
|---|---|
| `PendingAcceptance` | `StorageDoubleMap<buyer, (provider, seq)> -> created_at`. Present = "created, not yet accepted". Agreements created before this change have no entry and read as accepted (grandfathered). |
| `create_agreement` | Inputs unchanged. Reserves buyer funds as before, writes `PendingAcceptance`, does **not** touch the provider's `ActiveEscrowCount`. Still occupies a slot in `MaxAgreementsPerPair`, so pending spam is capped and costs the attacker locked capital. |
| `accept_agreement(buyer, seq)` (provider) | Requires a pending entry, re-runs the E1 capability check, removes the entry, increments `ActiveEscrowCount`, emits `AgreementAccepted`. |
| `reject_agreement(buyer, seq)` (provider) | Requires a pending entry. Removes it, unreserves the buyer, closes the agreement, emits `AgreementRejected`. |
| `cancel_pending(provider, seq)` (buyer) | Same as reject, buyer-initiated, only while pending. Emits `PendingCancelled`. |
| `record_delivery` | New guard `NotAccepted` while an entry exists. Runs first, before any state change. |
| `expire_agreement(buyer, provider, seq)` (anyone) | Modelled on `oracle.expire_request`. `now > deliver_by + EXPIRY_GRACE`, status still `Created` (no delivery recorded). Refunds the buyer, closes the agreement, decrements `ActiveEscrowCount` only if the agreement had been accepted, drops any pending entry, emits `AgreementExpired`. Permissionless, so liveness does not depend on a privileged caller. |
| `EXPIRY_GRACE` | Pallet-level `const` = 10 blocks. Not a `Config` type: `runtime/src/lib.rs` cannot change in this PR. Promote to `Config` in a later runtime PR if governance wants it tunable. |
| `request_unstake` | Unchanged. Pending agreements no longer count, so E18 is closed by construction. |
| Errors / events | Added only: `NotAccepted`, `NotPending`, `AgreementNotExpired`, `AlreadyDelivered`; `AgreementAccepted`, `AgreementRejected`, `PendingCancelled`, `AgreementExpired`. |

Untouched: `dispute_delivery`, `claim_refund`, `extend_deadline`, `confirm_delivery`, the
dispute→oracle bridge.

## "Expired" and the two counts

The brief says `expire_agreement` decrements "both counts": the global `ActiveAgreementCount`
and the provider's `ActiveEscrowCount`. The provider count was only incremented on acceptance,
so an expiring **pending** agreement must not decrement it, or it would eat a slot that belongs to
another agreement. `expire_agreement` therefore decrements the provider count iff no pending entry
existed. The global `ActiveAgreementCount` is incremented at create (unchanged) and always
decremented on close.

## Gaming-vector analysis

- *Pending spam pins the provider (E18).* No longer possible: pending does not count. The attacker
  still fills `MaxAgreementsPerPair` slots for that pair with locked funds, which only hurts the
  attacker's own pair.
- *Buyer creates, provider never answers, funds locked.* The buyer can `cancel_pending` at any time,
  and anyone can `expire_agreement` after `deliver_by + EXPIRY_GRACE`.
- *Provider accepts then sits on it (the old E18 pin, by consent).* The provider pinned itself;
  the agreement expires after the deadline plus grace, releasing the count.
- *Buyer front-runs a delivery with `expire_agreement`.* Only possible after `deliver_by + 10`, and
  only if status is still `Created`. A provider who delivered in time has status `Delivered` and is
  protected. A provider delivering exactly at `deliver_by` is unaffected (`record_delivery` requires
  `now <= deliver_by`).
- *Wash volume.* Rejected/cancelled/expired agreements never call `add_era_escrow_volume`, so they
  earn no emissions weight.
- *Accept-then-reject churn.* Reject only works while pending; accept clears the entry.
- *Extend-deadline vs expiry.* `extend_deadline` is unchanged; expiry reads the current `deliver_by`.

## Known interaction: `claim_refund` on a pending agreement (needs a human decision)

`claim_refund` is out of scope for this PR and is not edited. It handles `Created` unconditionally
and calls `decrement_active_escrow(&provider)`. For a still-pending agreement the provider's count
was never incremented, so a buyer using `claim_refund` after `deliver_by + BuyerResponseWindow`
would decrement (saturating) a count that belongs to *other* accepted agreements of that provider,
and would leave a stale `PendingAcceptance` entry behind. Fix (one line each, in `claim_refund`):
skip the decrement when `PendingAcceptance` has an entry, and remove the entry. Flagged in the PR as
a NEEDS_HUMAN item.

## Rollout / compatibility

- Storage: one new map, no existing key or value type changes.
- Behaviour change: an agreement now needs `accept_agreement` before `record_delivery`. The SDK
  (`acceptEscrow`) and the reference agent must call accept → deliver; the indexer should learn the
  four new events. Both are out of this PR's scope.
- Existing tests that went create → record_delivery gain an accept step. No assertion was loosened.
