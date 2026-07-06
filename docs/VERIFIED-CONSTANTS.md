# VERIFIED-CONSTANTS — SC-E1 P0-1a

> **Gate:** SC-E1 protocol §3 P0-1 / issue P0-1a. Satisfies finding **R-SC-0002**'s
> precondition: *"the real formula must be transcribed (tab 03) before this number
> means anything about the chain."*
>
> **Scope of this document:** transcribe, verbatim, the emissions weight formula and
> every economic constant it depends on **from the current runtime source**, with
> `file:line` references, and document the treatment of stake below the
> `MinQualifyingVol` gate. **No code was changed.** This is a *read* of what IS.
> Discrepancies against the SC-E1 spec (§4) and against the Phase-0 model assumption
> **MA-3** are recorded as **findings**, not fixes.
>
> **Authority:** per spec §4 and HL-8, the runtime source — not session history and not
> the workbook — is the authority for P0-1. The values below were read directly from
> `pallets/emissions/src/lib.rs`, `pallets/agents/src/lib.rs`, and `runtime/src/lib.rs`
> at the commit this document was authored against.

---

## 0. Provenance and a stated limitation

| Field | Value |
|---|---|
| Source of truth | `pallets/emissions/src/lib.rs`, `pallets/agents/src/lib.rs`, `runtime/src/lib.rs`, `pallets/auto-params/src/lib.rs` |
| Method | Direct source read; every constant carries a `file:line` ref and its live runtime value |
| Companion inputs | `experiments/sc-e1/SC-E1-SEEV-protocol-spec.md` §4; `experiments/sc-e1/SC-E1-PHASE0-RESULTS.md`; `experiments/sc-e1/SC-E1-phase0-sim.py` (MA-3) |

**Limitation — workbook tab 03 not parsed cell-by-cell.** `SC-E1-SEEV-workbook.xlsx`
is a compressed (DEFLATE) binary; `python3`, `node`, and `unzip` are permission-gated
in the CI sandbox this document was produced in, so the workbook's tab-03 cells could
not be read programmatically. The constant *set* below is taken from **protocol-spec §4**
(which the spec states is the session-history constant list that tab 03 is built to hold:
*"The workbook (tab 03) is the single source of truth once verified"*) and **every value
is verified against runtime source**. If a literal cell-by-cell reconciliation of the
`.xlsx` is required, re-run this task with `python3`/`unzip` added to the allowlist; the
authoritative values will not change — only the cross-check surface.

---

## 1. The emissions weight formula (transcribed)

The per-agent weight is computed in `Pallet::compute_weight_cached`
(`pallets/emissions/src/lib.rs:432-536`), called once per agent inside `settle_era`
(`pallets/emissions/src/lib.rs:255-261`). It is **not** the MA-3 form. There is **no
separate work-pool / stake-pool split** — a single weight combines stake, activity, rank,
heartbeat, oracle, onboarding, and velocity, and the whole per-era emission is distributed
in proportion to it.

### 1.1 Fixed-point scales (`pallets/emissions/src/lib.rs:38-40`)

| Symbol | Value | Meaning |
|---|---|---|
| `ACC_SCALE` | `1 << 64` (2^64) | MasterChef accumulator fixed-point scale (`lib.rs:38`) |
| `BPS_SCALE` | `10_000` | basis-point scale, = 100% (`lib.rs:39`) |
| `SCORE_SCALE` | `10_000` | score fixed-point scale (`lib.rs:40`) |

### 1.2 Step-by-step (all refs `pallets/emissions/src/lib.rs`)

```
INPUTS per agent (cached once per era in settle_era, L227-261):
  stake_u128            = AgentStake[who]                              (L244)
  alpha                 = AutoParams::alpha()        genesis 4_000     (L227)
  beta                  = AutoParams::beta()         genesis 5_000     (L228)
  floor_bps             = AutoParams::floor_bps()    genesis 1_000     (L229)
  oracle_bonus_bps      = OracleBonusBps             = 2_000           (L230)
  unit_u128             = UnitVolume                 = 10 CMN          (L231)
  max_props             = max(MaxProposalsPerEra,1)  = 20             (L232)
  velocity_bonus_bps    = VelocityBonusBps           = 3_000           (L233)
  onboarding_boost_bps  = if completions<10 {10_000 - completions*1_000} else {0}
                          per agent, from CompletedAgreements[who]     (L249-254)

STEP 1  sqrt_stake  = integer_sqrt(stake_u128)                         (L440)
        # √stake, NOT raw stake — anti-whale: 100× stake → 10× weight

STEP 2  rank = AgentCollective::rank_of(who).unwrap_or(0)              (L442)
        rank_bps = match rank { 0|1 => 10_000,   # 1.00×
                                2   => 12_000,    # 1.20×
                                _   => 15_000 }   # 1.50× (rank ≥ 3)   (L443-447)

STEP 3  hb = heartbeat_multiplier(who)   # 10..100                     (L449)
        has_heartbeat = hb >= 90                                       (L450)

STEP 4  vol_u128      = EraEscrowVolume[who]                           (L452-454)
        raw_vol       = log2_scaled(vol_u128, unit_u128)  # 0..10_000  (L455)
        unique_buyers = EraUniqueBuyers[who]                           (L456)
        diversity_bps = diversity_score_bps(unique_buyers) # 0..10_000 (L457)
        work_score    = if raw_vol==0 || diversity_bps==0 { 0 }
                        else { raw_vol * diversity_bps / SCORE_SCALE } (L458-459)

STEP 5  FLOOR GATE (MinQualifyingVol lives HERE — see §3):
        did_work_this_era = vol_u128 > 0                               (L466)
        is_active         = did_work_this_era && has_heartbeat         (L467)
        min_qual          = MinQualifyingVol  = 50 CMN                 (L473-475)
        qualifies_for_floor = is_active && (min_qual==0 || vol_u128 >= min_qual)   (L476)
        effective_floor   = if qualifies_for_floor { floor_bps } else { 0 }        (L477)

STEP 6  gov_votes  = EraGovParticipation[who]                          (L479)
        gov_score  = min(gov_votes, max_props) * SCORE_SCALE / max_props           (L480)
        gov_contribution = if work_score > 0 { alpha * gov_score / SCORE_SCALE }
                           else { 0 }   # gov cannot substitute for work            (L488-492)

STEP 7  activity = (effective_floor
                    + gov_contribution
                    + beta * work_score / SCORE_SCALE).min(BPS_SCALE)  (L494-497)
        # clamped to ≤ 10_000 bps (100%)

STEP 8  base_weight = sqrt_stake
                      * rank_bps / BPS_SCALE
                      * activity  / BPS_SCALE
                      * hb        / 100                                (L499-502)

STEP 9  ORACLE BONUS (only if oracle_bonus_bps > 0):
        oracle_score = OracleScoreProvider::best_score(who)           (L505)
        bonus        = base_weight * oracle_score / BPS_SCALE
                                   * oracle_bonus_bps / BPS_SCALE      (L506-508)
        weight_after_oracle = base_weight + bonus                     (L509)

STEP 10 ONBOARDING BOOST (first 10 completions, +100% decaying):
        after_onboarding = weight_after_oracle
                           * (10_000 + onboarding_boost_bps) / 10_000 (L513-515)

STEP 11 VELOCITY BONUS (skip if velocity_bonus_bps==0 or stake==0):
        velocity_ratio = min(BPS_SCALE, vol_u128 * BPS_SCALE / stake_u128)   (L524-528)
        bonus          = after_onboarding * velocity_ratio / BPS_SCALE
                                          * velocity_bonus_bps / BPS_SCALE    (L529-533)
        weight         = after_onboarding + bonus                     (L534)
```

`integer_sqrt`, `log2_scaled`, `diversity_score_bps`, and `heartbeat_multiplier` are
reproduced in Appendix A.

### 1.3 Emission pool schedule (`pallets/emissions/src/lib.rs:215-223`)

The per-era pool is **not** a free parameter (contrast MA-1). Unless a governance override
is set for the era (`EmissionOverrides`, `lib.rs:215`), it is:

```
emission = clamp( TargetEmissionPerAgent * agent_count,      # 10_000 CMN × agents
                  low  = FloorEmissionPerEra,                # 100_000 CMN
                  high = InitialEmissionsPerEra )            # 1_000_000 CMN
```

`agent_count = AgentStake::count()` (`lib.rs:214`). So the pool is **10,000 CMN per
registered agent, floored at 100,000 CMN/era and hard-capped at 1,000,000 CMN/era.**

### 1.4 Distribution (MasterChef accumulator)

- On settle: `AccRewardPerStake += emission * ACC_SCALE / total_weight`
  (`lib.rs:284-285`), where `total_weight` is the sum of all per-agent weights plus the
  orchestrator carve-out (`lib.rs:280`).
- On claim: `pending = (acc - debt) * AgentWeightSnapshot[who] / ACC_SCALE`
  (`do_claim`, `lib.rs:414-415`).
- Minting is capped by the supply cap every claim:
  `mintable = (SupplyCap - total_issuance).min(pending)` (`lib.rs:418-424`). **No path
  mints beyond the cap** (First Principle #1).

---

## 2. Verified constants (spec §4 / workbook tab-03 set)

All values verified against source. "Live value" is the effective genesis value.

### 2.1 Emissions pallet constants — `runtime/src/lib.rs`

| Constant | Live value | Source (`file:line`) | Feeds |
|---|---|---|---|
| Token unit | 1 CMN = 10^12 plancks | `runtime/src/lib.rs:72` | all |
| `SupplyCap` | 100,000,000,000 CMN | `:73` (`SUPPLY_CAP`), `:1007`, `:1033` | mint cap |
| Genesis mint | 18,000,000,000 CMN | `:74` | genesis |
| `InitialEmissionsPerEra` (pool **ceiling**) | 1,000,000 CMN | `:1008`, `:1034` | §1.3 high |
| `TargetEmissionPerAgent` | 10,000 CMN | `:1009`, `:1035` | §1.3 slope |
| `FloorEmissionPerEra` (pool **floor**) | 100,000 CMN | `:1010`, `:1036` | §1.3 low |
| `EraDuration` = `ERA_BLOCKS` | 3,600 blocks (6 h @ 6 s) | `:92`, `:1011`, `:1037` | settle timing |
| `OracleBonusBps` | 2,000 (+20% max) | `:1012`, `:1039` | §1.2 STEP 9 |
| `MaxProposalsPerEra` | 20 | `:1013`, `:1040` | §1.2 STEP 6 |
| `UnitVolume` | 10 CMN | `:1014`, `:1041` | `log2_scaled` unit |
| `MinQualifyingVol` | 50 CMN | `:1020`, `:1043` | §1.2 STEP 5 / §3 |
| `VelocityBonusBps` | 3,000 (+30% max) | `:1026`, `:1042` | §1.2 STEP 11 |
| `MaxBatchClaimSize` | 100 | `:1038` | `batch_claim` |
| `MaxEmissionOverrideEras` | 10 | `:1048` | override horizon |
| `OrchestratorEmissionMultiplier` | 5,000 | `:1051` | orch carve-out |

### 2.2 Auto-params genesis values (dynamic inputs to the formula) — `runtime/src/lib.rs`

These are **storage-backed and auto-params-adjustable each era**; the values below are the
genesis initializers. They are read fresh inside `settle_era` (§1.2 inputs).

| Param | Genesis value | Source (`file:line`) | Formula role |
|---|---|---|---|
| `InitialAlpha` → `alpha()` | 4,000 | `:1065`, `:1081` | gov weight (STEP 6) |
| `InitialBeta` → `beta()` | 5,000 | `:1066`, `:1082` | work weight (STEP 7) |
| `InitialFloorBps` → `floor_bps()` | 1,000 | `:1067`, `:1083` | floor activity (STEP 5/7) |
| `InitialMinScoreEligible` | 5 | `:1068`, `:1084` | oracle eligibility |
| `InitialCompletionFeeBps` | 25 (**0.25%**, bps of value) | `:1064`, `:1080` | escrow completion fee |

Bounds (auto-params, `pallets/auto-params/src/lib.rs:190-192`): `CompletionFeeBps` max
2,500 bps (25%), `max_step` 25 bps/era.

### 2.3 Agents pallet constants (rank / heartbeat / velocity inputs) — `runtime/src/lib.rs`

| Constant | Live value | Source (`file:line`) | Formula role |
|---|---|---|---|
| `MinStake` | 1,000 CMN | `:896`, `:921` | registration floor |
| `FullFloorStake` (rank 1→2 gate) | 10,000 CMN | `:897`, `:922` | `rank_bps` 12,000 |
| `MaxStakePerAgent` | 1,000,000 CMN | `:898`, `:923` | anti-concentration |
| `Rank3MinCompletions` | 50 | `:903`, `:928` | rank 2→3 gate |
| `MinRank3OracleScore` | 1,000 | `:904`, `:929` | rank 2→3 gate |
| `Rank3SpanGate` | 30 days | `:905`, `:930` | rank 2→3 gate |
| `MaxVolToStakeRatio` | 10 | `:906`, `:931` | (referenced by velocity design) |
| `HeartbeatGracePeriod` | 18 h (3 eras) | `:907`, `:932` | `heartbeat_multiplier` |
| `HeartbeatDecayPeriod` | 90 days | `:908`, `:933` | `heartbeat_multiplier` |
| `BaseRegistrationFee` | 50 CMN | `:900`, `:925` | sybil cost |

### 2.4 Fixed constants in the emissions pallet — `pallets/emissions/src/lib.rs`

| Constant | Value | Source |
|---|---|---|
| `ACC_SCALE` | 2^64 | `:38` |
| `BPS_SCALE` | 10,000 | `:39` |
| `SCORE_SCALE` | 10,000 | `:40` |
| `rank_bps` tiers | {0,1→10,000; 2→12,000; ≥3→15,000} | `:443-447` |
| onboarding decay | 10,000 − 1,000·completions, first 10 | `:250-254` |
| `diversity_score_bps` | {0→0,1→1,000,2→3,000,3→6,000,4→8,000,≥5→10,000} | `:547-551` |

---

## 3. Sub-`MinQualifyingVol` stake-emission treatment

**This is the exact question SC-E1 action item #3 flagged:** *"whether sub-MinQualifyingVol
accounts receive any stake-pool emissions."* Traced from source, the answer is:

**There is no stake-only emission pool. Emission share is proportional to a single weight
that is zero unless the agent does escrow work this era.** Concretely, per §1.2:

1. **Zero-work agent (`vol == 0`) — e.g. a pure passive staker (archetype A-2):**
   `did_work_this_era = false` → `is_active = false` → `qualifies_for_floor = false`
   → `effective_floor = 0`. `raw_vol = log2_scaled(0,·) = 0` → `work_score = 0` →
   `gov_contribution = 0`. Therefore `activity = 0`, and `base_weight = sqrt_stake × … × 0 × … = 0`.
   **Weight = 0 → zero emissions, regardless of stake size or heartbeat.**
   (`pallets/emissions/src/lib.rs:458-467, 476-477, 488-497, 499-502`.)

2. **Sub-qualifying but non-zero work (`0 < vol < MinQualifyingVol = 50 CMN`):**
   The `MinQualifyingVol` gate zeroes **only the floor component** (`effective_floor = 0`,
   `lib.rs:476-477`). It does **not** zero `work_score`. So such an agent still earns from
   the `beta * work_score` term **provided `raw_vol > 0`**. Because
   `log2_scaled(vol, UnitVolume=10 CMN)` returns 0 for `vol < UnitVolume`
   (`lib.rs:539-545`, see Appendix A), the practical bands are:
   - `vol < 10 CMN` (below `UnitVolume`): `work_score = 0` → **weight = 0 → zero emissions.**
   - `10 CMN ≤ vol < 50 CMN`: `effective_floor = 0` but `work_score > 0` is possible →
     **non-zero weight**, earned from work (and gov/velocity multipliers), **but with no
     floor baseline.** Also requires `has_heartbeat` only for the floor path; the
     work-score path does not require the heartbeat gate, but `base_weight` is still
     multiplied by `hb/100` (`lib.rs:502`), so a fully-decayed heartbeat (`hb=10`) cuts it to 10%.

3. **Qualifying agent (`vol ≥ 50 CMN`, active, heartbeat ≥ 90):** receives
   `effective_floor = floor_bps` (genesis 1,000 bps) **plus** the work/gov/velocity terms.

**Summary:** stake alone earns nothing. `MinQualifyingVol` gates the **floor baseline**,
not participation; below it an agent can still earn work-score-based emissions once its
volume clears `UnitVolume` (10 CMN). Below `UnitVolume`, emissions are zero.

---

## 4. Findings — discrepancies vs SC-E1 spec §4 and vs MA-3

Per the issue: *"Report what IS… Discrepancies vs the SC-E1 spec are findings, not fixes."*
These are **observations**, not proposed changes.

**F-1 (headline) — MA-3 has the wrong functional form; there is no work-pool/stake-pool
split.** MA-3 (`SC-E1-phase0-sim.py:6-8`) models
`weight = volume · rank · (1+0.1·oracle) · (1+0.05·gov) · (1+velocity)` distributed from a
work pool, with a **separate 40% stake pool (MA-2/MA-4)** paying all stakers. The runtime
has **one** weight, `≈ √stake · rank_bps · activity · hb · (oracle) · (onboarding) ·
(velocity)` (§1.2), with **no stake pool**. Consequences:
- The base scales with **√stake**, not raw volume (`lib.rs:440,499`). MA-3 omits stake from
  the work weight entirely.
- Volume enters only through **`work_score = log2_scaled(vol) · diversity`**
  (`lib.rs:455-459`), i.e. **logarithmically** and gated by **buyer diversity**, not linearly.

**F-2 — R-SC-0002's 1.44× worker/staker ratio is not a chain quantity.** Because a passive
staker earns **exactly zero** (§3.1), the equal-endowment worker/staker ratio on the real
formula is **undefined / unbounded** (division by ~0), not 1.44. MA-2's premise that a
worker's escrowed capital "earns nothing in the stake pool" is moot: **no one earns from the
stake pool.** P1 (≥2×) is trivially satisfied or undefined against the real formula; the
model number should not be read as a chain claim (consistent with the PHASE0-RESULTS
"Model ≠ chain" hard limit #1).

**F-3 — The completion fee is already percentage-based, not flat.** Spec §4 and MA-7 assume
a **flat 100 CMN `AgreementCompletionFee`**. The runtime uses **`CompletionFeeBps`**, a
basis-point fee of agreement value, **genesis 0.25% (25 bps)**, auto-params-adjustable up to
25% (`runtime/src/lib.rs:1064,1080`; `pallets/auto-params/src/lib.rs:127,183,190-192`). This
is exactly one of the "design levers" R-SC-0004 recommends (*"make the completion fee a
percentage of escrow volume"*) — **it already exists.** R-SC-0004's flat-fee break-even math
therefore does not describe the chain.

**F-4 — The era pool is hard-capped at 1,000,000 CMN/era.** MA-1 treats `E_era` as a free
parameter swept to 1e9. The runtime caps the pool at **`InitialEmissionsPerEra` =
1,000,000 CMN/era** (§1.3; `lib.rs:220-221,1008`). This sits **below** the Phase-0 break-even
pools it computed (wash ≈ 1.12M CMN/era, sybil ≈ 2.78M CMN/era, R-SC-0003/R-SC-0004). Under
the real cap, those model break-evens are not reachable via the base pool — though
`set_era_emission_override` (root-only, ≤ `SupplyCap`, `lib.rs:344-360`) can exceed it.

**F-5 — Oracle accuracy bonus is inert at genesis.** The formula's oracle term (STEP 9) is
real, but the runtime wires `type OracleScoreProvider = ()` (`runtime/src/lib.rs:1046`),
whose `best_score` returns 0 (`pallets/emissions/src/lib.rs:48-50`). So the **+20%
`OracleBonusBps` contributes exactly 0** on-chain today. MA-3's `(1+0.1·oracle)` term and
R-SC-0005's collusion result have no on-chain counterpart until an oracle score provider is
wired in.

**F-6 — Rank multiplier is graded, not binary.** MA-5 uses `rank = 1.5 if completions≥50
else 1.0`. The runtime uses graded `rank_bps` {1.0, 1.0, 1.2, 1.5} keyed on
ranked-collective rank (`lib.rs:443-447`), which is gated by completions **and** stake
threshold **and** (for rank 3) span + oracle score (`pallets/agents/src/lib.rs:1164-1186`).

**F-7 — Formula terms with no MA-3 analogue.** The runtime formula additionally includes a
**heartbeat multiplier** `hb/100` (10–100%, `lib.rs:449,502`) and a **per-agent onboarding
boost** (+100% decaying over the first 10 completions, `lib.rs:250-254,513-515`). Neither
exists in MA-3; both materially change relative earnings, especially for new agents.

**F-8 — Stale doc-comment on `MinQualifyingVol` (documentation only).** The pallet config
doc-comment says *"At launch: set to 5 × UnitVolume (5,000 CMN)"*
(`pallets/emissions/src/lib.rs:98`), which assumes `UnitVolume = 1,000 CMN`. The runtime
sets `UnitVolume = 10 CMN` (`runtime/src/lib.rs:1014`), so `MinQualifyingVol = 50 CMN`
(`:1020`) — consistent with the *"5 × UnitVolume"* rule but **not** the *"5,000 CMN"*
parenthetical. The effective value (50 CMN) matches spec §4; only the comment's example is
stale.

---

## Appendix A — helper functions (verbatim intent)

`integer_sqrt` — Newton's method, `√stake` base for anti-whale weighting
(`pallets/agents/src/lib.rs:187-193`).

`log2_scaled(vol, unit)` (`pallets/emissions/src/lib.rs:539-545`):
```
if vol == 0 || unit == 0 { return 0 }
ratio = vol * 1_000_000 / unit
if ratio == 0 { return 0 }
bits  = 128 - ratio.leading_zeros()          # ⌊log2(ratio)⌋ + 1
return min(SCORE_SCALE, (bits - 19) * (SCORE_SCALE / 10))   # saturating_sub(19)
```
With `unit = UnitVolume = 10 CMN`: `ratio = vol · 1e6 / 10 CMN`. `bits ≤ 19` (i.e.
`ratio < 2^19`, roughly `vol < UnitVolume`) yields **0** via the saturating `bits - 19`,
which is why sub-`UnitVolume` volume earns no work score (see §3). Each additional bit
adds 1,000 bps (SCORE_SCALE/10), capped at 10,000 bps.

`diversity_score_bps(unique_buyers)` (`pallets/emissions/src/lib.rs:547-551`):
`{0→0, 1→1,000, 2→3,000, 3→6,000, 4→8,000, ≥5→10,000}`.

`heartbeat_multiplier(who)` (`pallets/agents/src/lib.rs:1103-1119`): returns 100 within the
18 h grace period; then decays linearly toward a floor of 10 over the 90-day decay window:
`pct = max(10, 100 − 90·over/decay)`.
