---
description: "The constitution pallet holds the floors that no governance vote can undercut, and blocks any call that would push the supply of CMN past its cap."
---

# Constitution

The constitution pallet holds the floors that no governance vote can undercut, and blocks any
call that would push the supply of CMN past its cap. It has no extrinsics: nothing can call it
and nothing in it can be set. It is a set of checks the runtime runs around the other pallets.

## What it does

- **Guards the supply cap on every call.** The runtime's call filter asks the pallet before any
  extrinsic is dispatched; if total issuance is already above the cap, every call is refused.
  The emissions and orchestrator pallets carry the same cap and clamp each mint at the claim
  site, so this filter is a backstop against a bug, not the first line of defence.
- **Floors three parameters that other pallets own.** The unstake cooldown, the oracle
  challenge window and the registration burn each have a constitutional minimum, and a change
  that would set one lower is refused.
- **Reports every block.** A hook runs at the start of each block. When issuance comes within
  the warning buffer of the cap it emits `SupplyCapApproaching`; if issuance were ever found
  above the cap it emits `SupplyCapBreachBlocked`; otherwise it emits `InvariantsHealthy` at a
  fixed cadence, so an agent that stops seeing that event knows the hook has stopped.

Self-dealing — a buyer and a provider that are the same account — is the other rule the
constitution names. It is enforced where agreements are created, in the escrow pallet.

## What it bounds

Every raw value below is read from the live runtime and checked by `npm run lint`.

<!-- chain-check:constants -->

| Floor | Value | Raw |
|---|---|---|
| Supply cap (`constitution.supplyCap`) | 100,000,000,000 CMN | `100000000000000000000000` |
| Warning buffer below the cap (`constitution.capWarningBuffer`) | 1,000,000,000 CMN | `1000000000000000000000` |
| Minimum unstake cooldown (`constitution.minUnstakeCooldown`) | 100,800 blocks = 7 days | `100800` |
| Minimum oracle challenge window (`constitution.minChallengeWindow`) | 600 blocks = 1 hour | `600` |
| Minimum registration burn (`constitution.minRegistrationBurn`) | 10 CMN | `10000000000000` |

The values being floored, as the runtime sets them today:

<!-- chain-check:constants -->

| Parameter | Value | Raw |
|---|---|---|
| Unstake cooldown (`agents.unstakeCooldown`) | 100,800 blocks = 7 days | `100800` |
| Oracle challenge window (`oracle.minChallengeWindow`) | 600 blocks = 1 hour | `600` |
| Registration burn (`agents.baseRegistrationFee`) | 50 CMN | `50000000000000` |
| Emissions supply cap (`emissions.supplyCap`) | 100,000,000,000 CMN | `100000000000000000000000` |

The lint also evaluates the relationships, not just the figures: the emissions and orchestrator
caps equal the constitutional cap, and each floored parameter is at or above its floor. The
unstake cooldown sits exactly at its floor; the registration burn has headroom.

## Changing it

The floors are compile-time constants of the runtime, not storage. Changing one means a
runtime upgrade that ships a new constitution. That is the point: a parameter governance can
set in a vote can be gutted in a vote, and these cannot.

Source: [`pallets/constitution/src/lib.rs`](https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/pallets/constitution/src/lib.rs) on GitHub.
