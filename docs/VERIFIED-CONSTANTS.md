# VERIFIED CONSTANTS

Constants in this document were read directly from source and are cited with
`file:line` references against the current tree. Each section states what was
verified, the raw source value, and the derived figure.

> **Scope note.** This file is documentation only. It changes no economic
> parameters or pallet logic. Where a figure is derived (e.g. eras/year), the
> arithmetic is shown so it can be re-checked against the cited source values.

---

## Era emission schedule and per-era pool size

**Task reference:** P0-1b — verify era length, per-era emission by year, and
halving schedule, then compare the actual per-era pool against the
R-SC-0003 (sybil, ~2.78M CMN/era) and R-SC-0004 (wash, ~1.12M CMN/era)
break-evens.

### 1. Token unit

| Constant | Value | Source |
|---|---|---|
| `CMN` (1 CMN in plancks) | `1_000_000_000_000` (10¹²) | `runtime/src/lib.rs:72` |
| `SUPPLY_CAP` | `100_000_000_000 * CMN` = 100B CMN | `runtime/src/lib.rs:73` |
| `GENESIS_MINT` | `18_000_000_000 * CMN` = 18B CMN | `runtime/src/lib.rs:74` |

Emittable headroom above genesis = 100B − 18B = **82B CMN**.

### 2. Era length (blocks)

| Constant | Definition | Value | Source |
|---|---|---|---|
| `SECS_PER_BLOCK` | — | `6` | `runtime/src/lib.rs:86` |
| `MINUTES` | `60 / SECS_PER_BLOCK` | `10` blocks | `runtime/src/lib.rs:89` |
| `HOURS` | `MINUTES * 60` | `600` blocks | `runtime/src/lib.rs:90` |
| `DAYS` | `HOURS * 24` | `14_400` blocks | `runtime/src/lib.rs:91` |
| `ERA_BLOCKS` | `HOURS * 6` | **`3_600` blocks** | `runtime/src/lib.rs:92` |
| `EmissionsEraDuration` | `= ERA_BLOCKS` | `3_600` blocks | `runtime/src/lib.rs:1011` |

Wired into the pallet as `type EraDuration = EmissionsEraDuration`
(`runtime/src/lib.rs:1037`) and enforced by the `EraNotDue` timing gate in
`settle_era` (`pallets/emissions/src/lib.rs:199-203`).

**Derived era duration and cadence:**

- Era length in time = `3_600 blocks × 6 s = 21_600 s = 6 hours`.
- **Eras per day** = `DAYS / ERA_BLOCKS = 14_400 / 3_600 = 4`.
- **Eras per year** = `4 × 365 = 1_460`.

### 3. Per-era emission (the pool)

The per-era emission pool is computed in `settle_era`
(`pallets/emissions/src/lib.rs:215-223`):

```rust
let emission = if let Some(override_amount) = EmissionOverrides::take(era) {
    override_amount                                   // root-gated, see §6
} else {
    let target  = TargetEmissionPerAgent;            // 10_000 CMN
    let floor   = FloorEmissionPerEra;               // 100_000 CMN
    let ceiling = InitialEmissionsPerEra;            // 1_000_000 CMN
    (target * agent_count).max(floor).min(ceiling)   // clamp
};
```

| Parameter | Value | Role | Source |
|---|---|---|---|
| `EmissionsInitialPerEra` | `1_000_000 * CMN` | **ceiling** (max pool) | `runtime/src/lib.rs:1008` |
| `EmissionsTargetPerAgent` | `10_000 * CMN` | per-agent slope | `runtime/src/lib.rs:1009` |
| `EmissionsFloorPerEra` | `100_000 * CMN` | **floor** (min pool) | `runtime/src/lib.rs:1010` |

So the pool is a clamped linear function of the **live agent count**:

```
emission(n) = clamp(10_000 · n, 100_000, 1_000_000)  CMN, where n = AgentStake count
```

| Agent count `n` | Per-era pool | Regime |
|---|---|---|
| `n ≤ 10` | 100,000 CMN | floor |
| `10 < n < 100` | `10,000 · n` CMN | linear |
| `n ≥ 100` | **1,000,000 CMN** | **ceiling (hard max)** |

The settled value is recorded in `LastEraEmission`
(`pallets/emissions/src/lib.rs:130, 297`). The orchestrator share is carved
**out of** this same pool, not added on top
(`pallets/emissions/src/lib.rs:289-295`), so it never increases the pool size.

### 4. Halving schedule

**There is no halving schedule, and no time- or era-based emission decay, in the
codebase.** A repo-wide search for `halv` / `decay`-of-emission logic returns no
matches in any pallet or in the runtime. The per-era pool depends **only** on the
live agent count (§3), clamped between a fixed floor and a fixed ceiling. It does
not shrink over time, and it does not grow beyond the ceiling.

Consequences:

- Emission does **not** decrease as the chain ages. Bitcoin-style halving is not
  implemented.
- Supply is bounded instead by the **hard cap at claim time**: `do_claim` mints
  at most `SupplyCap − total_issuance`
  (`pallets/emissions/src/lib.rs:418-425`), emitting `CapReached` and minting
  zero once the 100B cap is hit. This is the sole terminal brake on issuance.
- The auto-params pallet tunes **weighting** (`alpha`, `beta`, `floor_bps`) used
  to split the pool among agents — it does **not** resize the pool. The pool
  formula in §3 is independent of auto-params.

### 5. Per-era emission "by year"

Because emission has no time component (§4), the per-era pool is **flat across
years** for a given agent count. The table below is therefore driven by agent
count, not by calendar year; every year looks identical at the same agent count.

| Scenario | Per-era pool | × 1,460 eras/yr = annual emission | Years to reach 100B cap from 18B (82B headroom) |
|---|---|---|---|
| Floor (`n ≤ 10`) | 100,000 CMN | 146,000,000 CMN/yr (146M) | ~561 years |
| Ceiling (`n ≥ 100`) | 1,000,000 CMN | 1,460,000,000 CMN/yr (1.46B) | ~56 years |

(The "years to cap" figures assume 100% of emitted rewards are claimed and
ignore the agent-count ramp; they bound the fastest realistic issuance and are
illustrative only.)

### 6. Emission override (only path above the ceiling)

`set_era_emission_override` (`pallets/emissions/src/lib.rs:341-360`) lets a
**root** origin (`ensure_root`, line 347) pre-set a future era's emission up to
`SupplyCap` (bounded by `OverrideAmountExceedsCap`, line 356) and at most
`MaxEmissionOverrideEras = 10` eras ahead (`runtime/src/lib.rs:1048`). This is
the **only** code path that can push a single era's pool above the 1,000,000 CMN
ceiling. It is root/governance-gated and not part of the steady-state schedule.

---

## Comparison against gaming break-evens

Break-evens are the per-era pool sizes at which an attack becomes profitable; a
guard is "expired" when the actual pool **meets or exceeds** its break-even.

| Attack | Break-even pool | Steady-state max pool (ceiling) | Margin | Guard status at ceiling |
|---|---|---|---|---|
| R-SC-0003 sybil | ~2,780,000 CMN/era (2.78M) | 1,000,000 CMN/era (1.0M) | pool is **36%** of break-even; break-even is **2.78×** the max pool | **NOT expired** — safe |
| R-SC-0004 wash | ~1,120,000 CMN/era (1.12M) | 1,000,000 CMN/era (1.0M) | pool is **~89%** of break-even; headroom **~0.12M CMN/era (~11%)** | **NOT expired** — safe, but thin |

**Findings:**

1. **The steady-state per-era pool can never exceed 1,000,000 CMN** under the
   normal schedule (hard ceiling, §3), which is below both break-evens. Both
   R-SC-0003 and R-SC-0004 guards are therefore **currently within their safe
   envelope** — neither is expired.

2. **The pool is usually well below the ceiling.** It only reaches 1.0M when the
   live agent count is ≥ 100; for smaller populations the pool is proportionally
   smaller (`10,000 · n` CMN), placing both attacks even further from
   break-even.

3. **The wash-trading margin is thin (~11%, ~0.12M CMN/era).** At the ceiling the
   actual pool (1.0M) sits just under the 1.12M wash break-even. Any future
   change that raises the emission ceiling, per-agent target, or applies an
   emission override (§6) at or above 1.12M CMN/era would **expire the R-SC-0004
   guard**. The sybil break-even (2.78M) retains a larger 2.78× cushion.

4. **Root emission overrides are the only escape hatch above the ceiling** (§6).
   An override ≥ 1.12M CMN/era crosses the wash break-even; ≥ 2.78M CMN/era
   crosses the sybil break-even. These require a root/governance action and are
   not reachable through permissionless `settle_era`.

---

### Source references (summary)

| Fact | File:line |
|---|---|
| `CMN`, `SUPPLY_CAP`, `GENESIS_MINT` | `runtime/src/lib.rs:72-74` |
| `SECS_PER_BLOCK`, `MINUTES`, `HOURS`, `DAYS`, `ERA_BLOCKS` | `runtime/src/lib.rs:86-92` |
| Emission ceiling / target / floor | `runtime/src/lib.rs:1008-1010` |
| `EraDuration` wiring | `runtime/src/lib.rs:1011, 1037` |
| `MaxEmissionOverrideEras` | `runtime/src/lib.rs:1048` |
| Per-era emission clamp formula | `pallets/emissions/src/lib.rs:215-223` |
| `EraNotDue` timing gate | `pallets/emissions/src/lib.rs:199-203` |
| `LastEraEmission` storage / write | `pallets/emissions/src/lib.rs:130, 297` |
| Orchestrator share taken from pool | `pallets/emissions/src/lib.rs:289-295` |
| Hard supply cap at claim | `pallets/emissions/src/lib.rs:418-425` |
| `set_era_emission_override` (root, ≤ cap, ≤10 eras) | `pallets/emissions/src/lib.rs:341-360` |
