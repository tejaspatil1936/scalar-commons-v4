# DESIGN — E18 (provider consent) + E2 (exit for stuck agreements)

Issue #180. Supersedes the design in draft PR #204, which stalled on the
`claim_refund` interaction (§4). Additive storage only: no layout change to an
existing item, therefore no migration and no `spec_version` bump.

## 1. The two findings

**E18.** `create_agreement` today reserves the buyer's funds *and* increments the
provider's `ActiveEscrowCount`, with no input from the provider. Since
`agents.request_unstake` refuses while `ActiveEscrowCount > 0`, any buyer can pin
any agent's stake indefinitely by opening agreements the agent never agreed to.
The cost to the attacker is a refundable reserve; the cost to the victim is its
entire stake. An agreement must not bind a provider who never consented.

**E2.** An agreement whose provider goes silent has no exit that does not depend
on the buyer. `claim_refund` is buyer-only, so a buyer who loses its key — or
simply stops running — leaves funds reserved and the provider's count pinned
forever. Per first principle 3 the exit must be permissionless.

## 2. Storage

```rust
PendingAcceptance: StorageDoubleMap<
    Blake2_128Concat, AccountId,          // buyer
    Blake2_128Concat, (AccountId, u32),   // (provider, seq)
    BlockNumberFor<T>,                    // created_at
    OptionQuery,
>
```

An entry means *created, not yet accepted*. Absence means accepted. That polarity
is deliberate and is what removes the need for a migration: every agreement that
exists before this change has no entry, so it reads as accepted and is
grandfathered. A `bool` field on `Agreement` would have been the obvious
encoding and is exactly what we cannot do — it changes an existing layout.

`EXPIRY_GRACE = 10` blocks is a pallet-level `const` in `pallets/escrow/src/lib.rs`,
not a `Config` type, because `runtime/src/lib.rs` is out of scope for this change.

## 3. Lifecycle

```
create_agreement            → reserved, PendingAcceptance entry, provider count NOT incremented
  ├─ accept_agreement       (provider) → entry removed, provider count incremented
  │    └─ record_delivery → confirm_delivery / dispute_delivery / claim_refund   (unchanged)
  ├─ reject_agreement       (provider) → entry removed, buyer refunded, agreement closed
  ├─ cancel_pending         (buyer)    → entry removed, buyer refunded, agreement closed
  └─ expire_agreement       (anyone, after deliver_by + EXPIRY_GRACE) → buyer refunded, closed
```

`create_agreement` keeps its signature and still counts toward
`MaxAgreementsPerPair` — a pending agreement occupies a bilateral slot, so the
pair cap still bounds how much storage a buyer can force. It no longer calls
`increment_active_escrow`. `record_delivery` gains
`ensure!(!PendingAcceptance::contains_key(..), Error::NotAccepted)`.

`request_unstake` is untouched. Pending agreements never enter
`ActiveEscrowCount`, so E18 closes by construction rather than by a new guard.

`accept_agreement` re-runs the E1 capability check — acceptance is the moment the
provider commits to the skill, so the capability must be held then, not merely at
creation. It also refuses after `deliver_by`: accepting an agreement that is
already expirable would pin the provider's count for work that can no longer be
delivered.

## 4. The `claim_refund` interaction

This is what blocked #204. Removing the increment from `create_agreement` left
`claim_refund` decrementing a count that, for a pending agreement, was never
incremented — so a sybil buyer could walk a victim provider's `ActiveEscrowCount`
down to 0 and unstake it out from under its real obligations. The E18 hole
reopened in the opposite direction.

### 4.1 The refund cases, enumerated

| # | Consent | Status | Provider count incremented? | Door | Earliest |
|---|---|---|---|---|---|
| A | never accepted | `Created` | no | `cancel_pending` (buyer) / `reject_agreement` (provider) | immediately |
| B | never accepted | `Created` | no | `expire_agreement` (anyone) | `deliver_by + EXPIRY_GRACE` |
| C | accepted | `Created` | yes | `claim_refund` (buyer) | `deliver_by + BuyerResponseWindow` |
| D | accepted | `Created` | yes | `expire_agreement` (anyone) | `deliver_by + EXPIRY_GRACE` |
| E | accepted | `Delivered` | yes | `claim_refund` (buyer) | `deliver_by + BuyerResponseWindow` |
| F | accepted | `Disputed` | yes | `claim_refund` (buyer) | `dispute_opened_at + DisputeTimeoutWindow` |

Cases A/B refund without touching `ActiveEscrowCount`. Cases C–F must decrement
it. Conflating the two is the #204 defect.

### 4.2 Which guard fires first, and why

`claim_refund` classifies **consent before eligibility**. The consent check is
the first `ensure!` in the call, ahead of the deadline/timeout arithmetic:

1. `AgreementNotFound` — the agreement exists at all.
2. **`NotAccepted` — the agreement is not pending** (cases A/B are refused here).
3. `DisputeTimeoutNotElapsed` — the per-status timing window has elapsed.
4. *only then* `unreserve`, `decrement_active_escrow`, close.

Two reasons for that order, both load-bearing:

- **Correctness.** Past step 2, `claim_refund` is reachable only for an accepted
  agreement, so its unconditional `decrement_active_escrow` is sound by
  construction. The alternative — teach `claim_refund` to skip the decrement when
  pending — leaves the same call serving two economically different cases and
  makes the bookkeeping depend on a branch a future edit can drop.
- **Honest errors.** A buyer holding a pending agreement before its window has
  elapsed would otherwise be told `DisputeTimeoutNotElapsed`, i.e. "wait longer" —
  actively misleading, since waiting never makes `claim_refund` work for a
  pending agreement. `NotAccepted` points at `cancel_pending`, which is available
  to that buyer *now* and refunds the same amount. Refusing pending agreements
  from `claim_refund` therefore costs the buyer nothing.

So pending agreements exit through exactly three doors — `cancel_pending`,
`reject_agreement`, `expire_agreement` — and accepted ones through
`claim_refund`, `expire_agreement`, or normal settlement.

The classification lives in one function, `consent_state`, returning a two-armed
`ConsentState`. Both `claim_refund` and `expire_agreement` call it and `match` on
the result, so the count decision is stated once, in one place, rather than
emerging from the order the `ensure!`s happen to sit in.

### 4.3 No double refund

Every refund door — `claim_refund`, `reject_agreement`, `cancel_pending`,
`expire_agreement` — ends by removing the agreement from `Agreements` with
`swap_remove`, and every door begins with
`position(|a| a.seq == seq).ok_or(AgreementNotFound)`. The agreement's presence in
`Agreements` *is* the once-only token. A second call through the same door, or
through any other door, finds nothing and fails with `AgreementNotFound` before
reaching any `unreserve`. All of it runs inside `try_mutate`, so the failing call
writes nothing.

`expire_agreement` (case D, `deliver_by + 10`) becomes available before
`claim_refund` (case C, `deliver_by + 50`) under the runtime's current constants.
That is intended: both refund the buyer the same full amount, and whichever fires
first closes the agreement against the other. `e18e2_refund_cannot_be_claimed_twice_across_paths`
asserts this on reserved balances, not on return values.

## 5. Guards fire before funds move

In every new call all `ensure!`s precede the first `unreserve` /
`increment_active_escrow` / `PendingAcceptance` write. `expire_agreement`'s
`PendingAcceptance::take` sits after both its status and deadline guards.

## 6. Compatibility

- New calls appended at indices 6–9; nothing renumbered.
- New events appended after `DeadlineExtended`; new errors after `SpanTooLong`.
- No existing struct edited: `git diff master -- pallets/escrow/src/lib.rs | grep 'pub struct'` is empty.
- No new `Config` type, so no mock gains a field.
- `record_delivery` now requires acceptance, so existing create→deliver tests and
  the `complete_escrow` helper in `tests/common.rs` gain an `accept_agreement`
  step. No assertion is loosened.
- Storage version unchanged; `PendingAcceptance` is a fresh prefix.

## 7. Out of scope

`dispute_delivery`, the dispute→oracle bridge, and `runtime/src/lib.rs` are
untouched. The SDK's missing `acceptAgreement` and indexer decoding for the four
new events are follow-ups, not part of this change.
