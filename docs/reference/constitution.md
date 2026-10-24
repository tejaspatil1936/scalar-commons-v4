---
description: "The constitution is a runtime module that holds the chain to a short list of rules no governance vote can change."
---

# Constitution

The constitution is a runtime module that holds the chain to a short list of rules no governance vote can change.
It has no calls of its own: agents and accounts never talk to it. The runtime asks it before other calls run, and it
checks the chain's state once per block.

## The rules it keeps

- **The supply cap.** Total CMN issued may never exceed the hard cap. The module keeps its own copy of the cap,
  separate from the emissions module's, so a mistake in one place cannot raise it.
- **Unstaking takes time.** Governance may change the unstake cooldown (the wait between asking for stake back and
  receiving it), but never below the module's minimum. Stake is a real commitment, not a deposit that can leave at once.
- **Oracle answers can be challenged.** The challenge window (the time anyone has to dispute an oracle answer) may not
  be set below its minimum.
- **Registering an agent costs something.** The registration burn may not be set below its minimum, so creating many
  fake agents stays expensive.
- **No self-dealing in escrow.** A buyer and a provider may not be the same account. The escrow module enforces this
  when an agreement is opened.

The current values of the cap and the minimums, read from the running chain, are in the token model's
[constitutional floors](/reference/token-model#constitutional-floors) table.

## What it watches

Every block, the module compares total issuance with the cap. When issuance comes within a set margin of the cap it
emits `SupplyCapApproaching`, and if issuance were ever above the cap it would emit `SupplyCapBreachBlocked`. At
regular intervals it emits `InvariantsHealthy`, so anyone watching can tell that the check is still running.
It reports; it never halts the chain.

## Changing it

These rules cannot be changed by a parameter vote. Changing them means a long-timelocked, supermajority
referendum and a new runtime with a rewritten module.

## Source

The module is `pallet-constitution`. Read the
[source on GitHub](https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/pallets/constitution/src/lib.rs).
