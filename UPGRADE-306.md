# UPGRADE-306.md — the economic gate

**Date:** 2026-09-10
**Issues:** [#164] (a two-account tester captured 82 % of an era's emission), [#161] (`register` never initialises `LastHeartbeat`)
**Decisions applied:** D7 (emission ≤ α × qualifying escrow volume), D8 (register starts the heartbeat clock), D9 (use any zero-emission lever that exists today)

> **Status in one line:** emission was stopped on the live chain at **block #542152** with the
> lever that already existed, spec 306 replaces that stopgap with a rule, and the gate is
> re-declared passed only by re-measuring it on chain — not by the code merging.

---

## §1 — Discovery, and the pause

### 1.1 The exact current formula (spec 305)

`pallets/emissions/src/lib.rs`, `settle_era`. Two independent halves, and only one of them
was ever about work.

**The size of the pot:**

```text
pool = EmissionOverrides.take(era)                       # if root set one
     | clamp(TargetEmissionPerAgent × AgentStake::count(),
             low  = FloorEmissionPerEra,                 # 100 000 CMN
             high = InitialEmissionsPerEra)              # 1 000 000 CMN
```

**The split of the pot**, per agent, `compute_weight_cached`:

```text
weight = integer_sqrt(stake)
       × rank_bps / 10 000                               # 10 000 / 12 000 / 15 000 by rank
       × activity / 10 000
       × heartbeat_multiplier / 100                      # 100 down to 10
       × (1 + oracle_score × OracleBonusBps / 10 000²)   # inert: OracleScoreProvider = ()
       × (1 + onboarding_boost_bps / 10 000)             # +100 % → 0 over first 10 completions
       × (1 + min(1, era_vol/stake) × VelocityBonusBps / 10 000)   # up to +30 %

activity = min(10 000,
               effective_floor                           # FloorBps if the agent qualifies, else 0
             + alpha × gov_score / 10 000                # zero unless work_score > 0
             + beta  × work_score / 10 000)

work_score = log2_scaled(era_vol, UnitVolume) × diversity_score_bps(unique_buyers) / 10 000
```

Payment is a MasterChef accumulator: `AccRewardPerStake += pool × 2^64 / total_weight`, and
`claim` pays `(acc − debt) × weight_snapshot / 2^64`, capped at `SupplyCap − TotalIssuance`.

### 1.2 Where agent count enters

`let agent_count = agents_pallet::AgentStake::<T>::count() as u128;` —
`pallets/emissions/src/lib.rs`. It enters **once**, and it is the only input to the size of
the pot. It is a count of *registrations*, not of active agents, not of qualifying agents,
and not of anything anybody did. Registration costs 1 050 CMN once; the count it increments
is permanent until unstake.

Nothing else in the formula reads it. So an era mints the same amount whether the chain
settled a million CMN of escrow or nothing at all, and #164's arithmetic follows directly:
11 registered agents → `10 000 × 11 = 110 000 CMN`, against ~120 CMN of gross escrow chain-wide
that era. **~917 CMN minted per CMN of work.** The split then concentrated 81.88 % of it on
one agent, because `MinQualifyingVol` and the `hb >= 90` gate had disqualified nearly
everyone else — the gates concentrate rather than dilute.

### 1.3 What the ring-farming flag did to payouts

**Nothing. Confirmed by reading every consumer of the signal.**

`pallets/agents/src/lib.rs`, `drain_era_maps` computes:

```rust
let is_established = completions > 1;
if is_established && EraUniqueBuyers::<T>::get(&agent) <= 1 {
    ring_snap = ring_snap.saturating_add(1);
}
```

`ring_snap` goes to `EraRingSnapshot`, which is read in exactly one place —
`pallet-auto-params::rule_ring_farming` — where a ring ratio over 30 % raises
`CompletionFeeBps` by `max_step` (**25 bps**, capped at 2 500).

So the entire consequence of being detected as a ring was that the *escrow completion fee*
rose by a quarter of a basis point per era, chain-wide, for everyone. It did not reduce the
ring's weight, its volume credit, its claim, or the size of the pot. #164's ring **was**
detectable — the issue notes `eraUniqueBuyers` was 1 — and it was paid in full.

Two further gaps in the flag itself:

- It is computed **after** the weight loop, in `drain_era_maps`, so it could not have
  affected the settlement it was computed during even if something consumed it.
- The `is_established` clause means a ring's **first** era is never flagged at all.

### 1.4 Does a zero-emission lever exist today? — **Yes, one, and it is bounded**

| Candidate | Root-callable today? | Can it zero emission? |
|---|---|---|
| `emissions.setEraEmissionOverride(era, 0)` | yes, `ensure_root` | **Yes** — `settle_era` does `EmissionOverrides::take(era)`, and `Some(0)` is an override of zero, not an absence. |
| `autoParams.setParam(Alpha/Beta/FloorBps, …)` | yes | **No.** These are weight terms, not pot size, and their bounds floor at `Alpha` 1 000 / `Beta` 1 000 / `FloorBps` 100 — none reaches zero, and none touches the pot. |
| `txPause.pause(("Emissions","settleEra"))` or `("Emissions","claim")` | yes — `PauseOrigin = EnsureRoot`, `WhitelistedCalls = ()` | Yes, but **refused**. See below. |
| A dedicated pause | — | Does not exist. Not invented here. |

**`txPause` was available and was deliberately not used.** CLAUDE.md first principle #3:
*no economically essential function (era settlement, reward claims) may depend on a
privileged caller.* Pausing `settleEra` or `claim` makes both depend on one. Zeroing the pot
achieves the same end while settlement stays permissionless and claims stay open — there is
simply nothing to concentrate.

**The one limit of the lever, stated rather than worked around.** The guard is
`target_era > current_era && target_era <= current_era + MaxEmissionOverrideEras`, and
`settle_era` reads `EraNumber` — which *is* `current_era`. **So the era that settles next
cannot be overridden.** Writing `EmissionOverrides` directly through `system.setStorage`
would have covered it; that bypasses a check rather than satisfying one, and the round's
rule is not to weaken a check to pass.

### 1.5 D9 executed — **pause block #542152**

`scripts/emissions-zero-override.mjs`, new in this round, built on the fee-preflight pattern
`apply-upgrade.mjs` earned the hard way in UPGRADE-305 (`sudo.sudo` dispatches `paysFee: No`,
but `ChargeTransactionPayment` runs in `validate_transaction` **before** dispatch, so an
unfunded root key cannot get the extrinsic into the pool at all).

```text
chain               : Scalar Commons Local Testnet
spec_version        : 305
head block          : #542151
agents.EraNumber    : 4
EraStartBlock       : #538914  EraDuration 3600  next settlement due at #542514
MaxEmissionOverride : 10 eras

NOT REACHABLE       : era 4 — settle_era reads EraNumber, and the runtime guard is
                      target_era > current_era. Era 4 mints its pot at #542514.
overriding eras     : 5..14 to 0.0000 CMN

signer              : 5DFASjqmCBrMfRsHDzQyXGodfWL4Bj1uK6X2U3jBEEoPh8ZN
on-chain Sudo::Key  : 5DFASjqmCBrMfRsHDzQyXGodfWL4Bj1uK6X2U3jBEEoPh8ZN
signer is root      : YES

call                : sudo.sudo(utility.batchAll(10 x emissions.setEraEmissionOverride))
inner call hash     : 0x8e6f3312c70ddabb3a4d6011b7f8b96cc7280f2b9fb8c94650fbb28dd6fb607c
outer call hash     : 0xf772e326728c5b04a974d49d041689cd0bd010810d8a2e344a81bf6adca1f941

signer free balance : 10000.0000 CMN
estimated fee       : 0.0001 CMN
required (fee + ED) : 0.0101 CMN
can pay             : YES
```

Submitted; `utility.BatchCompleted`, `sudo.Sudid` with no `Err`, then read back from storage
rather than trusted:

```text
finalized in        : 0x85df915465151ca3811a4c5624383c8441f9892f37d57c11e4c543a763c3a2a1
PAUSE BLOCK         : #542152

EmissionOverrides[5..14] = 0    (all ten read back as 0)

OK — eras 5..14 will mint 0.0000 CMN.
Era 4 is NOT covered and mints at #542514.
Overrides are consumed on read: re-run before era 14 settles.
```

**What this does not cover, said plainly:** era 4 settles at **#542514** and mints its
agent-count pot — 110 000 CMN at 11 registered agents — because the existing lever's guard
cannot reach the era that is settling. Ten eras of cover is 60 hours, which is the window
spec 306 has to land in. The override is consumed on read, so it is a stopgap with an expiry,
not a fix. **The fix is §2.**

[#161]: https://github.com/tejaspatil1936/scalar-commons-v4/issues/161
[#164]: https://github.com/tejaspatil1936/scalar-commons-v4/issues/164
