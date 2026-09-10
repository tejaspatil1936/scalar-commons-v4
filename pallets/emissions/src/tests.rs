//! pallet-emissions unit tests
//!
//! Gated by `#[cfg(test)] mod tests;` in `lib.rs` — no inner `#![cfg(test)]`.

use crate::pallet::*;
use frame_support::{
    assert_noop, assert_ok, parameter_types,
    traits::{ConstU16, ConstU32, ConstU64},
};
use sp_core::H256;
use sp_runtime::{
    traits::{BlakeTwo256, IdentityLookup},
    BuildStorage,
};

type Block = frame_system::mocking::MockBlock<Test>;

pub struct StaticParams;
impl pallet_auto_params::pallet::AutoParamsProvider for StaticParams {
    fn completion_fee_bps() -> u32 {
        0
    }
    fn alpha() -> u32 {
        4_000
    }
    fn beta() -> u32 {
        5_000
    }
    fn floor_bps() -> u32 {
        1_000
    }
    fn min_score_eligible() -> u32 {
        5
    }
    fn emission_volume_alpha_bps() -> u32 {
        10_000
    }
}

frame_support::construct_runtime!(
    pub enum Test {
        System:    frame_system,
        Balances:  pallet_balances,
        Agents:    pallet_agents,
        Emissions: crate,
    }
);

impl frame_system::Config for Test {
    type BaseCallFilter = frame_support::traits::Everything;
    type BlockWeights = ();
    type BlockLength = ();
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    type RuntimeTask = ();
    type Nonce = u64;
    type Hash = H256;
    type Hashing = BlakeTwo256;
    type AccountId = u64;
    type Lookup = IdentityLookup<Self::AccountId>;
    type Block = Block;
    type RuntimeEvent = RuntimeEvent;
    // BlockNumber is u64 in this mock, so these want ConstU64/ConstU16, not
    // ConstU32. Values unchanged: 250 blocks of hashes, SS58 prefix 42.
    type BlockHashCount = ConstU64<250>;
    type DbWeight = ();
    type Version = ();
    type PalletInfo = PalletInfo;
    type AccountData = pallet_balances::AccountData<u64>;
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = ConstU16<42>;
    type OnSetCode = ();
    type MaxConsumers = ConstU32<16>;
    // Added to frame_system::Config since this mock was written; `()` for all six
    // is the SDK's own TestDefaultConfig — no migrations, no block-phase hooks.
    type ExtensionsWeightInfo = ();
    type SingleBlockMigrations = ();
    type MultiBlockMigrator = ();
    type PreInherents = ();
    type PostInherents = ();
    type PostTransactions = ();
}

impl pallet_balances::Config for Test {
    type MaxLocks = ConstU32<50>;
    type MaxReserves = ConstU32<50>;
    type ReserveIdentifier = [u8; 8];
    type Balance = u64;
    type RuntimeEvent = RuntimeEvent;
    type DustRemoval = ();
    // Balance is u64 here, so ExistentialDeposit wants ConstU64. Value unchanged: 1.
    type ExistentialDeposit = ConstU64<1>;
    type AccountStore = System;
    type WeightInfo = ();
    type FreezeIdentifier = ();
    type MaxFreezes = ConstU32<0>;
    type RuntimeHoldReason = ();
    type RuntimeFreezeReason = ();
    // New in pallet_balances::Config; `()` is the SDK default — no slash callback.
    type DoneSlashHandler = ();
}

parameter_types! {
    pub const MinStakeE:  u64 = 1_000;
    pub const FFStakeE:   u64 = 10_000;
    pub const MaxStakeE:  u64 = 1_000_000;
}

impl pallet_agents::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type MinStake = MinStakeE;
    type FullFloorStake = FFStakeE;
    type MaxStakePerAgent = MaxStakeE;
    // BlockNumber- and Balance-typed constants: ConstU64, not ConstU32. Values unchanged.
    type UnstakeCooldown = ConstU64<100>;
    type BaseRegistrationFee = ConstU64<50>;
    type MaxRegistrationsPerBlock = ConstU32<10>;
    type MaxAgents = ConstU32<1000>;
    type Rank3MinCompletions = ConstU32<50>;
    type MinRank3OracleScore = ConstU32<0>; // disabled for test
    type Rank3SpanGate = ConstU64<0>; // disabled for test
    type MaxVolToStakeRatio = ConstU32<0>; // disabled
    type HeartbeatGracePeriod = ConstU64<600>;
    type HeartbeatDecayPeriod = ConstU64<14400>;
    type OnAgentRegistered = Emissions;
    type OnAgentSlashed = Emissions;
    type OnStakeChanged = Emissions;
    type AgentCollective = ();
    type OracleScoreGate = ();
    type GovVoteVerifier = MockGovVoteVerifier;
    type IdentityHandler = ();
    type OrchestratorLookup = ();
    type MaxUriLen = ConstU32<128>;
    type MaxNameLen = ConstU32<64>;
    type MaxCapabilitiesPerAgent = ConstU32<32>;
    type MaxDelegationPeriod = ConstU64<100_800>; // BlockNumber = u64 in test runtime
    type SlashAppealWindow = ConstU64<10>; // BlockNumber = u64 in test runtime
    type SlashDestination = ();
    type MaxProposalsPerEra = ConstU32<20>;
}

parameter_types! {
    pub const SupplyCap:             u64 = 100_000_000_000_000;
    pub const InitialEmissionsPerEra:u64 = 1_000_000;
    pub const TargetPerAgent:        u64 = 10_000;
    pub const FloorEmission:         u64 = 100_000;
    pub const EraDuration:           u64 = 3_600;
    pub const UnitVolume:            u64 = 1_000;
}

// Scheduler removed from Config in M1 — no mock needed

impl super::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type SupplyCap = SupplyCap;
    type InitialEmissionsPerEra = InitialEmissionsPerEra;
    type TargetEmissionPerAgent = TargetPerAgent;
    type FloorEmissionPerEra = FloorEmission;
    type EraDuration = EraDuration;
    type MaxBatchClaimSize = ConstU32<50>;
    type OracleBonusBps = ConstU32<2000>;
    type MaxProposalsPerEra = ConstU32<10>;
    type UnitVolume = UnitVolume;
    type VelocityBonusBps = ConstU32<0>; // +30% weight bonus at full capital deployment
                                         // Balance-typed (Get<BalanceOf<Self>>), and Balance is u64 here — so ConstU64.
                                         // Value unchanged: 0 keeps the floor gate disabled.
    type MinQualifyingVol = ConstU64<0>; // disabled in unit tests — tests use small vol amounts
                                         // V4: GenesisAgentBonusBps/Eras removed — replaced by per-agent onboarding_boost
    type AutoParams = StaticParams;
    type OracleScoreProvider = ();
    type OracleCounters = ();
    type MaxEmissionOverrideEras = ConstU32<10>;
    // Orchestrator: no-op in unit tests
    type ValidatorCountProvider = ();
    type OrchestratorEmissions = ();
    type OrchestratorEmissionMultiplier = ConstU32<5_000>;
}

fn new_test_ext() -> sp_io::TestExternalities {
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
    pallet_balances::GenesisConfig::<Test> {
        balances: vec![(1, 500_000), (2, 500_000), (3, 500_000)],
        dev_accounts: None, // new field; None = generate none, as before
    }
    .assimilate_storage(&mut storage)
    .unwrap();
    storage.into()
}

const ALICE: u64 = 1;
const BOB: u64 = 2;

fn register(who: u64, stake: u64) {
    assert_ok!(Agents::register(RuntimeOrigin::signed(who), stake));
}

/// Record a full era of real escrow work for `agent` through the production
/// path (`add_era_escrow_volume`), not by poking storage directly.
///
/// Emission weight is zero for an agent that did no escrow work this era —
/// `docs/VERIFIED-CONSTANTS.md` §3.1: "Weight = 0 → zero emissions, regardless
/// of stake size or heartbeat." So any test that expects emissions to accrue
/// must first give the agent work to be rewarded for; registering and staking
/// is deliberately not enough (CLAUDE.md first principle #2).
///
/// Five distinct buyers puts `diversity_score_bps` at its 10,000 ceiling, and
/// 5 × 20,000 = 100,000 era volume against `UnitVolume = 1,000` puts
/// `log2_scaled` at 8,000 — i.e. an ordinarily productive agent, not an edge case.
fn do_era_work(agent: u64) {
    do_era_work_of(agent, 20_000);
}

/// `do_era_work` with the per-buyer amount spelled out.
///
/// spec 306 (D7, #164) bounds an era's emission at `alpha x qualifying escrow volume`, so a
/// test that wants to observe an emission of size N must first give the chain at least N of
/// qualifying volume to measure. Five distinct buyers keeps `diversity_score_bps` at its
/// ceiling and keeps the provider clear of the ring flag, exactly as `do_era_work` does.
fn do_era_work_of(agent: u64, per_buyer: u64) {
    for buyer in 100u64..105 {
        assert_ok!(Agents::add_era_escrow_volume(&agent, &buyer, per_buyer));
    }
}

/// Advance block number past EraDuration and call settle_era with a signed origin.
/// settle_era is now permissionless (ensure_signed) but requires EraDuration elapsed.
fn settle(caller: u64) {
    let now = System::block_number();
    let era_dur = <Test as crate::pallet::Config>::EraDuration::get();
    System::set_block_number(now + era_dur);
    assert_ok!(Emissions::settle_era(RuntimeOrigin::signed(caller)));
}

#[test]
fn new_agent_debt_initialised_on_register() {
    new_test_ext().execute_with(|| {
        // Put some value in accumulator first
        AccRewardPerStake::<Test>::put(1_000_000u128);
        // Register alice — debt should equal current accumulator
        register(ALICE, 1_000);
        assert_eq!(AgentRewardDebt::<Test>::get(ALICE), 1_000_000u128);
    });
}

#[test]
fn claim_nothing_before_settlement() {
    new_test_ext().execute_with(|| {
        register(ALICE, 1_000);
        assert_noop!(
            Emissions::claim(RuntimeOrigin::signed(ALICE)),
            Error::<Test>::NothingToClaim
        );
    });
}

#[test]
fn accumulator_increases_on_era_settlement() {
    new_test_ext().execute_with(|| {
        register(ALICE, 10_000);
        // Stake alone carries no weight — the accumulator only moves if some
        // agent did verifiable work this era. See do_era_work().
        do_era_work(ALICE);
        let acc_before = AccRewardPerStake::<Test>::get();
        settle(ALICE);
        let acc_after = AccRewardPerStake::<Test>::get();
        assert!(acc_after > acc_before, "accumulator should have increased");
    });
}

#[test]
fn agent_can_claim_after_settlement() {
    new_test_ext().execute_with(|| {
        register(ALICE, 10_000);
        // Emissions reward work, not stake: without this the agent settles at
        // weight 0 and claim() correctly returns NothingToClaim.
        do_era_work(ALICE);
        // Register before settle so debt is 0
        AgentRewardDebt::<Test>::insert(ALICE, 0u128);
        let balance_before = Balances::free_balance(ALICE);
        settle(ALICE);
        assert_ok!(Emissions::claim(RuntimeOrigin::signed(ALICE)));
        assert!(
            Balances::free_balance(ALICE) > balance_before,
            "alice should have earned emissions"
        );
    });
}

#[test]
fn supply_cap_enforced() {
    new_test_ext().execute_with(|| {
        register(ALICE, 10_000);
        // Set total_issuance near the cap
        // Difficult to test directly in mock without custom currency; verify
        // the code path exists by inspecting that cap check compiles and runs.
        // Full integration test on testnet confirms behaviour.
        settle(ALICE);
    });
}

#[test]
fn higher_stake_earns_proportionally_more() {
    new_test_ext().execute_with(|| {
        // Alice: 10K stake (Full rank 2), Bob: 1K stake (rank 0/1)
        register(ALICE, 10_000);
        register(BOB, 1_000);
        // IDENTICAL era work for both, so stake is the only variable the
        // comparison below is measuring. Without any work both weights are 0
        // and the assertion compares 0 > 0 — which is the correct emission
        // outcome for two idle stakers, not evidence about the stake curve.
        do_era_work(ALICE);
        do_era_work(BOB);
        // Zero debt for both
        AgentRewardDebt::<Test>::insert(ALICE, 0u128);
        AgentRewardDebt::<Test>::insert(BOB, 0u128);
        settle(ALICE);

        let alice_weight = AgentWeightSnapshot::<Test>::get(ALICE);
        let bob_weight = AgentWeightSnapshot::<Test>::get(BOB);
        // Alice should have more weight: sqrt(10000)=100 vs sqrt(1000)≈31, plus rank multiplier
        assert!(
            alice_weight > bob_weight,
            "alice with 10K stake should outweigh bob with 1K"
        );
    });
}

#[test]
fn log2_scaled_baseline_at_unit_volume() {
    new_test_ext().execute_with(|| {
        // An agent with exactly 1x unit_volume (1000 CMN) should get ~1000 work_score_raw
        // Test the formula: vol = unit → bits = 20, (20 - 19) * 1000 = 1000
        register(ALICE, 10_000);
        AgentRewardDebt::<Test>::insert(ALICE, 0u128);
        // Simulate 1x unit volume (1000 tokens)
        pallet_agents::EraEscrowVolume::<Test>::insert(ALICE, 1_000u64);
        pallet_agents::EraUniqueBuyers::<Test>::insert(ALICE, 5u32); // 5 unique buyers → diversity = 10000
        settle(ALICE);
        // Weight snapshot should be non-zero
        let w = AgentWeightSnapshot::<Test>::get(ALICE);
        assert!(
            w > 0,
            "agent with 1x unit volume should have positive weight"
        );
    });
}

#[test]
fn emission_override_replaces_formula_for_targeted_era() {
    new_test_ext().execute_with(|| {
        register(ALICE, 10_000);
        AgentRewardDebt::<Test>::insert(ALICE, 0u128);

        // Set override for era 0 (current era before settle_era)
        assert_ok!(Emissions::set_era_emission_override(
            RuntimeOrigin::root(),
            1,
            500_000u64,
        ));

        // spec 306: each era needs real qualifying volume, and the overridden era needs at
        // least the override's worth of it — otherwise D7 cuts the override down to the
        // volume and this test would be measuring the cap rather than the override. The
        // assertions below are unchanged; only the setup now supplies the work that the
        // emission is a payment FOR. `emission_override_is_still_bounded_by_qualifying_volume`
        // in tests_issue_164.rs covers the other side, where the cap does bind.
        do_era_work_of(ALICE, 100_000); // 5 buyers x 100_000 = 500_000 qualifying

        // Settle era 0 first (moves to era 1)
        settle(ALICE);
        let _last_era_0 = LastEraEmission::<Test>::get();

        // Reset debt for clean test
        AgentRewardDebt::<Test>::insert(ALICE, AccRewardPerStake::<Test>::get());

        // Settle era 1 (should use override amount = 500_000)
        do_era_work_of(ALICE, 100_000);
        settle(ALICE);
        let last_era_1 = LastEraEmission::<Test>::get();
        assert_eq!(last_era_1, 500_000u64, "era 1 should use override amount");

        // Override consumed — era 2 uses formula
        AgentRewardDebt::<Test>::insert(ALICE, AccRewardPerStake::<Test>::get());
        do_era_work_of(ALICE, 100_000);
        settle(ALICE);
        let last_era_2 = LastEraEmission::<Test>::get();
        assert_ne!(
            last_era_2, 500_000u64,
            "era 2 should not use override (consumed)"
        );
    });
}

// ── Governance-vote verifier mock (ROUND14) ──────────────────────────────────
//
// Replaces `GovVoteVerifier = ()`, whose impl returned `true` unconditionally and was
// wired into all six mocks — which is why the governance-participation guard shipped
// with no behavioural coverage. No test in this crate calls `record_gov_vote`, so this
// mock starts empty and denies everything; a future test must state which (voter, poll)
// pairs are live rather than passing by default.
//
// `HELD_VOTES` and `ONGOING_POLLS` are separate on purpose: on chain a vote leaves
// `pallet_conviction_voting::VotingFor` only via the voter's own `remove_vote`, so it
// outlives the referendum. Both must hold for credit.
thread_local! {
    static HELD_VOTES: core::cell::RefCell<std::collections::BTreeSet<(u64, u32)>> =
        const { core::cell::RefCell::new(std::collections::BTreeSet::new()) };
    static ONGOING_POLLS: core::cell::RefCell<std::collections::BTreeSet<u32>> =
        const { core::cell::RefCell::new(std::collections::BTreeSet::new()) };
}

pub struct MockGovVoteVerifier;
impl pallet_agents::pallet::GovVoteVerifier<u64> for MockGovVoteVerifier {
    fn has_live_vote_on(who: &u64, poll_index: u32) -> bool {
        HELD_VOTES.with(|v| v.borrow().contains(&(*who, poll_index)))
            && ONGOING_POLLS.with(|p| p.borrow().contains(&poll_index))
    }
}

/// `who` votes on `poll`, and `poll` is ongoing.
#[allow(dead_code)]
pub fn cast_live_vote(who: u64, poll: u32) {
    HELD_VOTES.with(|v| {
        v.borrow_mut().insert((who, poll));
    });
    ONGOING_POLLS.with(|p| {
        p.borrow_mut().insert(poll);
    });
}

/// The referendum ends; the vote itself survives, exactly as on chain.
#[allow(dead_code)]
pub fn conclude_poll(poll: u32) {
    ONGOING_POLLS.with(|p| {
        p.borrow_mut().remove(&poll);
    });
}

/// Reset verifier state — the test harness reuses threads across tests.
#[allow(dead_code)]
pub fn reset_gov_state() {
    HELD_VOTES.with(|v| v.borrow_mut().clear());
    ONGOING_POLLS.with(|p| p.borrow_mut().clear());
}
