//! pallet-agents unit tests
//! Run: cargo test -p pallet-agents -- --nocapture
//!
//! Gated by `#[cfg(test)] mod tests;` in `lib.rs` — no inner `#![cfg(test)]`.

use crate::*;
use core::cell::RefCell;
use frame_support::{
    assert_noop, assert_ok, parameter_types,
    traits::{ConstU32, ConstU64, Get},
};
use sp_core::H256;
use sp_runtime::{
    traits::{BlakeTwo256, IdentityLookup},
    BuildStorage,
};
use std::collections::BTreeSet;

// ── Mock runtime ─────────────────────────────────────────────────────────────
type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
    pub enum Test {
        System:  frame_system,
        Balances: pallet_balances,
        Agents:   pallet,  // this pallet
    }
);

parameter_types! {
    pub const BlockHashCount: u64 = 250;
    pub const SS58Prefix: u8 = 42;
}

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
    type BlockHashCount = BlockHashCount;
    type DbWeight = ();
    type Version = ();
    type PalletInfo = PalletInfo;
    type AccountData = pallet_balances::AccountData<u64>;
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = SS58Prefix;
    type OnSetCode = ();
    type MaxConsumers = ConstU32<16>;
    // Added to frame_system::Config since this mock was written. All six are `()`
    // in the SDK's own TestDefaultConfig (frame/system/src/lib.rs:335,354-358),
    // i.e. no migrations and no block-phase callbacks — which is what this mock
    // already did implicitly.
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
    type ExistentialDeposit = ConstU64<1>;
    type AccountStore = System;
    type WeightInfo = ();
    type FreezeIdentifier = ();
    type MaxFreezes = ConstU32<0>;
    type RuntimeHoldReason = ();
    type RuntimeFreezeReason = ();
    // Added to pallet_balances::Config since this mock was written; `()` is the
    // SDK's own default (frame/balances/src/lib.rs:247) — no slash bookkeeping
    // callback, matching this mock's prior behaviour.
    type DoneSlashHandler = ();
}

parameter_types! {
    pub const MinStake:                  u64 = 1_000;
    pub const FullFloorStake:            u64 = 10_000;
    pub const MaxStakePerAgent:          u64 = 1_000_000;
    pub const UnstakeCooldown:           u64 = 100;
    pub const BaseRegistrationFee:       u64 = 50;
    pub const MaxRegistrationsPerBlock:  u32 = 10;
    pub const MaxAgents:                 u32 = 100;
    pub const Rank3MinCompletions:       u32 = 50;
    pub const MinRank3OracleScore:       u32 = 1_000;
    pub const Rank3SpanGate:             u64 = 100;
    pub const MaxVolToStakeRatio:        u32 = 10;
    pub const HeartbeatGracePeriod:      u64 = 600;
    pub const HeartbeatDecayPeriod:      u64 = 14_400;
}

impl Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type MinStake = MinStake;
    type FullFloorStake = FullFloorStake;
    type MaxStakePerAgent = MaxStakePerAgent;
    type UnstakeCooldown = UnstakeCooldown;
    type BaseRegistrationFee = BaseRegistrationFee;
    type MaxRegistrationsPerBlock = MaxRegistrationsPerBlock;
    type MaxAgents = MaxAgents;
    type Rank3MinCompletions = Rank3MinCompletions;
    type MinRank3OracleScore = MinRank3OracleScore;
    type Rank3SpanGate = Rank3SpanGate;
    type MaxVolToStakeRatio = MaxVolToStakeRatio;
    type HeartbeatGracePeriod = HeartbeatGracePeriod;
    type HeartbeatDecayPeriod = HeartbeatDecayPeriod;
    type OnAgentRegistered = ();
    type OnAgentSlashed = (); // unit test: no emissions pallet
    type OnStakeChanged = (); // unit test: no emissions pallet
    type AgentCollective = ();
    type OracleScoreGate = ();
    type GovVoteVerifier = MockGovVoteVerifier;
    type IdentityHandler = ();
    type OrchestratorLookup = ();
    type MaxUriLen = ConstU32<256>;
    type MaxNameLen = ConstU32<64>;
    type MaxCapabilitiesPerAgent = ConstU32<20>;
    type MaxDelegationPeriod = ConstU64<90_000>; // BlockNumber = u64 in test runtime
    type SlashAppealWindow = ConstU64<10>; // BlockNumber = u64 in test runtime
                                           // V4: new Config types
    type MaxProposalsPerEra = ConstU32<20>;
    type SlashDestination = (); // test: slash burns fully (no treasury mock needed)
}

// ── Configurable governance-vote verifier mock ───────────────────────────────
//
// ROUND13 §2.5 found the shipped guard had zero behavioural coverage: all six mocks
// wired `GovVoteVerifier = ()`, whose impl returned `true` unconditionally, so no test
// could ever observe the verifier rejecting anything. This mock models the two facts the
// real `ConvictionVotingBridge` reads, kept as separate pieces of state precisely because
// upstream keeps them separate — and that separation IS the vector:
//
//   * `HELD_VOTES`   — (voter, poll) pairs in `pallet_conviction_voting::VotingFor`.
//                      Entries leave ONLY via the voter's own `remove_vote`.
//   * `ONGOING_POLLS`— polls for which `Polling::as_ongoing` returns `Some`.
//
// `conclude_poll` therefore drops the poll from `ONGOING_POLLS` while deliberately
// LEAVING the vote in `HELD_VOTES`, which is exactly what the real chain does when a
// referendum finishes. A verifier that only asks "does this account hold a vote?" cannot
// tell that state apart from a live one.

thread_local! {
    /// (voter, poll_index) pairs the account holds a `Casting` vote on.
    /// Mirrors `pallet_conviction_voting::VotingFor`.
    static HELD_VOTES: RefCell<BTreeSet<(u64, u32)>> = const { RefCell::new(BTreeSet::new()) };
    /// Poll indices still ongoing. Mirrors `Polling::as_ongoing(idx).is_some()`.
    static ONGOING_POLLS: RefCell<BTreeSet<u32>> = const { RefCell::new(BTreeSet::new()) };
}

pub struct MockGovVoteVerifier;
impl GovVoteVerifier<u64> for MockGovVoteVerifier {
    fn has_live_vote_on(who: &u64, poll_index: u32) -> bool {
        HELD_VOTES.with(|v| v.borrow().contains(&(*who, poll_index)))
            && ONGOING_POLLS.with(|p| p.borrow().contains(&poll_index))
    }
}

/// `who` votes on `poll`, and `poll` is ongoing. The normal, honest case.
fn cast_live_vote(who: u64, poll: u32) {
    HELD_VOTES.with(|v| {
        v.borrow_mut().insert((who, poll));
    });
    ONGOING_POLLS.with(|p| {
        p.borrow_mut().insert(poll);
    });
}

/// The referendum finishes. Upstream does NOT prune the vote — no hook exists that
/// could — so the `VotingFor` entry survives. Only liveness changes.
fn conclude_poll(poll: u32) {
    ONGOING_POLLS.with(|p| {
        p.borrow_mut().remove(&poll);
    });
}

/// The voter calls `remove_vote()` — the only path that clears a `VotingFor` entry.
fn remove_vote(who: u64, poll: u32) {
    HELD_VOTES.with(|v| {
        v.borrow_mut().remove(&(who, poll));
    });
}

fn reset_gov_state() {
    HELD_VOTES.with(|v| v.borrow_mut().clear());
    ONGOING_POLLS.with(|p| p.borrow_mut().clear());
}

// ── Test helpers ─────────────────────────────────────────────────────────────
fn new_test_ext() -> sp_io::TestExternalities {
    // Verifier state is thread-local, and the test harness reuses threads across tests.
    // Reset it here so each test starts from "nobody has voted on anything".
    reset_gov_state();
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
    pallet_balances::GenesisConfig::<Test> {
        balances: vec![
            (1, 100_000), // alice
            (2, 100_000), // bob
            (3, 100_000), // charlie
            (4, 10),      // poor_dave
        ],
        // New GenesisConfig field; `None` is the SDK's Default and generates no
        // extra accounts, so the endowed set above is unchanged.
        dev_accounts: None,
    }
    .assimilate_storage(&mut storage)
    .unwrap();
    storage.into()
}

const ALICE: u64 = 1;
const BOB: u64 = 2;

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn register_basic_tier_works() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));

        assert!(AgentStake::<Test>::contains_key(ALICE));
        assert_eq!(AgentStake::<Test>::get(ALICE), Some(1_000));
        // Fee burned: alice started with 100_000, minus 1000 locked, minus 50 fee
        assert_eq!(Balances::free_balance(ALICE), 100_000 - 50); // stake is locked not spent
    });
}

#[test]
fn register_full_tier_stake() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 10_000));
        assert_eq!(AgentStake::<Test>::get(ALICE), Some(10_000));
    });
}

#[test]
fn register_fails_below_min_stake() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            Agents::register(RuntimeOrigin::signed(ALICE), 999),
            Error::<Test>::StakeTooLow
        );
    });
}

#[test]
fn register_fails_if_already_registered() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_noop!(
            Agents::register(RuntimeOrigin::signed(ALICE), 1_000),
            Error::<Test>::AlreadyRegistered
        );
    });
}

#[test]
fn register_fails_if_insufficient_balance() {
    new_test_ext().execute_with(|| {
        // poor_dave has only 10 tokens — can't cover stake (1000) + fee (50) + existential (1)
        assert_noop!(
            Agents::register(RuntimeOrigin::signed(4), 1_000),
            Error::<Test>::StakeTooLow
        );
    });
}

#[test]
fn add_stake_increases_locked_amount() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::add_stake(RuntimeOrigin::signed(ALICE), 5_000));
        assert_eq!(AgentStake::<Test>::get(ALICE), Some(6_000));
    });
}

#[test]
fn request_unstake_and_complete_works() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));

        assert_ok!(Agents::request_unstake(RuntimeOrigin::signed(ALICE)));
        assert!(UnstakeAt::<Test>::contains_key(ALICE));

        // Try to complete before cooldown — should fail
        assert_noop!(
            Agents::complete_unstake(RuntimeOrigin::signed(ALICE)),
            Error::<Test>::UnstakeCooldownNotElapsed
        );

        // Advance past cooldown
        frame_system::Pallet::<Test>::set_block_number(101);

        assert_ok!(Agents::complete_unstake(RuntimeOrigin::signed(ALICE)));
        assert!(!AgentStake::<Test>::contains_key(ALICE));
    });
}

#[test]
fn era_volume_tracking_increments_correctly() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(BOB), 1_000));

        // Alice delivers to Bob (alice = provider, bob = buyer)
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 500));
        assert_eq!(EraEscrowVolume::<Test>::get(ALICE), 500);
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 1);
        assert_eq!(CompletedAgreements::<Test>::get(ALICE), 1);
    });
}

#[test]
fn drain_era_maps_clears_per_era_storage() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(BOB), 1_000));
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 500));
        assert_eq!(EraNumber::<Test>::get(), 0);

        Agents::drain_era_maps(0);

        // Per-era maps cleared
        assert_eq!(EraEscrowVolume::<Test>::get(ALICE), 0);
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 0);
        // Era number incremented
        assert_eq!(EraNumber::<Test>::get(), 1);
        // Active snapshot set (alice had volume)
        assert_eq!(EraActiveSnapshot::<Test>::get(), 1);
    });
}

#[test]
fn ring_signal_excludes_first_era_agents() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(BOB), 1_000));

        // Alice's first ever completion — should NOT be ring-flagged
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 500));
        // unique_buyers = 1, completions = 1 (first era agent)

        Agents::drain_era_maps(0);

        // Ring snapshot should be 0 — Alice is first-era, excluded
        assert_eq!(EraRingSnapshot::<Test>::get(), 0);
    });
}

#[test]
fn ring_signal_fires_on_established_single_buyer_agent() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(BOB), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(3), 1_000)); // carol

        // Era 0: alice's first completion with bob — excluded from ring signal
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 500));
        Agents::drain_era_maps(0);

        // Era 1: alice completes again, only with bob → established + unique_buyers=1 → ring suspect
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 500));
        // 2 lifetime completions now — alice IS established

        Agents::drain_era_maps(1);
        assert_eq!(EraRingSnapshot::<Test>::get(), 1); // Alice flagged
    });
}

#[test]
fn integer_sqrt_correct() {
    assert_eq!(integer_sqrt(0), 0);
    assert_eq!(integer_sqrt(1), 1);
    assert_eq!(integer_sqrt(4), 2);
    assert_eq!(integer_sqrt(9), 3);
    assert_eq!(integer_sqrt(100), 10);
    assert_eq!(integer_sqrt(10_000), 100);
    assert_eq!(integer_sqrt(u128::MAX), 18_446_744_073_709_551_615u128);
}

/// Regression: the Newton seed `(n + 1) / 2` overflowed at the top of the
/// domain — panicking in debug and, worse, wrapping to a *wrong root* in the
/// release WASM that actually computes emission weight. Pins the boundary.
#[test]
fn integer_sqrt_no_overflow_at_domain_boundary() {
    // 1 CMN = 10^12 plancks; the anti-whale curve on realistic magnitudes.
    assert_eq!(integer_sqrt(1_000_000_000_000), 1_000_000);

    // (2^64 - 1)^2 = u128::MAX - 2^65 + 2: the largest exact square in u128.
    let max_root = u64::MAX as u128;
    assert_eq!(integer_sqrt(max_root * max_root), max_root);
    assert_eq!(integer_sqrt(max_root * max_root - 1), max_root - 1);

    // Everything above that square, up to and including u128::MAX, floors to
    // the same root. These are the inputs the old seed could not represent.
    assert_eq!(integer_sqrt(max_root * max_root + 1), max_root);
    assert_eq!(integer_sqrt(u128::MAX - 1), max_root);
    assert_eq!(integer_sqrt(u128::MAX), max_root);

    // Defining property across the whole domain: s² ≤ n < (s+1)².
    for n in [
        0u128,
        1,
        2,
        3,
        u64::MAX as u128,
        1u128 << 100,
        u128::MAX / 3,
        u128::MAX - 1,
        u128::MAX,
    ] {
        let s = integer_sqrt(n);
        assert!(s.checked_mul(s).is_some_and(|sq| sq <= n), "s² > n at {n}");
        assert!(
            s.checked_add(1)
                .and_then(|t| t.checked_mul(t))
                .is_none_or(|sq| sq > n),
            "(s+1)² ≤ n at {n}"
        );
    }
}

#[test]
fn heartbeat_multiplier_full_when_fresh() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        frame_system::Pallet::<Test>::set_block_number(1);
        assert_ok!(Agents::heartbeat(RuntimeOrigin::signed(ALICE)));
        // Just sent heartbeat — should be 100
        assert_eq!(Agents::heartbeat_multiplier(&ALICE), 100);
    });
}

#[test]
fn update_metadata_stores_uri_and_name() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));

        let uri = b"https://alice-agent.example.com/rpc"
            .to_vec()
            .try_into()
            .unwrap();
        let name = b"Alice AI Agent".to_vec().try_into().unwrap();

        assert_ok!(Agents::update_metadata(
            RuntimeOrigin::signed(ALICE),
            uri,
            name
        ));

        let meta = AgentMetadata::<Test>::get(ALICE).expect("metadata should exist");
        assert_eq!(meta.uri.as_slice(), b"https://alice-agent.example.com/rpc");
        assert_eq!(meta.name.as_slice(), b"Alice AI Agent");
        assert_eq!(meta.updated_at, 0u64);
    });
}

#[test]
fn update_metadata_fails_for_non_agent() {
    new_test_ext().execute_with(|| {
        let uri = b"https://example.com".to_vec().try_into().unwrap();
        let name = b"Nobody".to_vec().try_into().unwrap();
        assert_noop!(
            Agents::update_metadata(RuntimeOrigin::signed(ALICE), uri, name),
            Error::<Test>::NotRegistered
        );
    });
}

#[test]
fn set_capability_stores_and_removes() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));

        // Set capability 42 active
        assert_ok!(Agents::set_capability(
            RuntimeOrigin::signed(ALICE),
            42,
            true
        ));
        let caps = AgentCapabilities::<Test>::get(ALICE);
        assert!(caps.contains(&42u32));

        // Set capability 100 active
        assert_ok!(Agents::set_capability(
            RuntimeOrigin::signed(ALICE),
            100,
            true
        ));
        let caps = AgentCapabilities::<Test>::get(ALICE);
        assert!(caps.contains(&42u32));
        assert!(caps.contains(&100u32));

        // Deactivate capability 42
        assert_ok!(Agents::set_capability(
            RuntimeOrigin::signed(ALICE),
            42,
            false
        ));
        let caps = AgentCapabilities::<Test>::get(ALICE);
        assert!(!caps.contains(&42u32));
        assert!(caps.contains(&100u32));
    });
}

#[test]
fn complete_unstake_clears_metadata_and_capabilities() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        let uri = b"https://alice.ai".to_vec().try_into().unwrap();
        let name = b"Alice".to_vec().try_into().unwrap();
        assert_ok!(Agents::update_metadata(
            RuntimeOrigin::signed(ALICE),
            uri,
            name
        ));
        assert_ok!(Agents::set_capability(
            RuntimeOrigin::signed(ALICE),
            7,
            true
        ));

        assert_ok!(Agents::request_unstake(RuntimeOrigin::signed(ALICE)));
        frame_system::Pallet::<Test>::set_block_number(101);
        assert_ok!(Agents::complete_unstake(RuntimeOrigin::signed(ALICE)));

        // All storage cleared
        assert!(AgentMetadata::<Test>::get(ALICE).is_none());
        assert!(AgentCapabilities::<Test>::get(ALICE).is_empty());
    });
}

#[test]
fn delegate_voting_stores_record() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        // Delegate to BOB until block 500
        assert_ok!(Agents::delegate_voting(
            RuntimeOrigin::signed(ALICE),
            BOB,
            500
        ));
        let record = VotingDelegations::<Test>::get(ALICE).expect("delegation should exist");
        assert_eq!(record.delegate_to, BOB);
        assert_eq!(record.expires_at, 500u64);
    });
}

#[test]
fn delegate_voting_remove_with_zero_until() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::delegate_voting(
            RuntimeOrigin::signed(ALICE),
            BOB,
            500
        ));
        // Pass until=0 to remove
        assert_ok!(Agents::delegate_voting(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));
        assert!(VotingDelegations::<Test>::get(ALICE).is_none());
    });
}

#[test]
fn delegate_voting_fails_with_past_block() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        frame_system::Pallet::<Test>::set_block_number(100);
        // until=50 is in the past (current block=100)
        assert_noop!(
            Agents::delegate_voting(RuntimeOrigin::signed(ALICE), BOB, 50),
            Error::<Test>::DelegationExpired
        );
    });
}

#[test]
fn delegate_voting_fails_period_too_long() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        // MaxDelegationPeriod = 90_000 blocks in test config
        // Try to delegate for 100_000 blocks — exceeds maximum
        assert_noop!(
            Agents::delegate_voting(RuntimeOrigin::signed(ALICE), BOB, 100_001),
            Error::<Test>::DelegationPeriodTooLong
        );
        // Exactly at limit should work
        assert_ok!(Agents::delegate_voting(
            RuntimeOrigin::signed(ALICE),
            BOB,
            90_000
        ));
    });
}

#[test]
fn slash_appeal_stores_record() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        let reason = [42u8; 32];
        // Submit appeal for era 0 while in early era
        assert_ok!(Agents::slash_appeal(
            RuntimeOrigin::signed(ALICE),
            0,
            reason
        ));
        let rec = PendingSlashAppeals::<Test>::get(ALICE).expect("appeal should exist");
        assert_eq!(rec.slash_era, 0);
        assert_eq!(rec.reason_hash, reason);
    });
}

#[test]
fn slash_appeal_cleared_on_unstake() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::slash_appeal(
            RuntimeOrigin::signed(ALICE),
            0,
            [0u8; 32]
        ));
        assert!(PendingSlashAppeals::<Test>::contains_key(ALICE));
        assert_ok!(Agents::request_unstake(RuntimeOrigin::signed(ALICE)));
        // Advance past cooldown
        frame_system::Pallet::<Test>::set_block_number(200);
        assert_ok!(Agents::complete_unstake(RuntimeOrigin::signed(ALICE)));
        assert!(!PendingSlashAppeals::<Test>::contains_key(ALICE));
    });
}

#[test]
fn slash_appeal_duplicate_rejected() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::slash_appeal(
            RuntimeOrigin::signed(ALICE),
            0,
            [0u8; 32]
        ));
        // Second appeal while first is pending
        assert_noop!(
            Agents::slash_appeal(RuntimeOrigin::signed(ALICE), 0, [1u8; 32]),
            Error::<Test>::AppealAlreadyPending
        );
    });
}

// ── ROUND14: governance credit is bound to a distinct LIVE referendum ─────────
//
// These four tests are the behavioural coverage the guard shipped without. Each one
// fails against the pre-ROUND14 code:
//   * `gov_credit_*_earns_nothing` — the old verifier never read poll status, so a
//     concluded referendum still paid.
//   * `one_live_vote_credits_exactly_once_per_era` — the old extrinsic took no poll
//     index and had no dedup set, so this loop banked the full 20 credits.
//   * `distinct_live_referenda_each_credit_once_up_to_cap` — passes vacuously today
//     (any 20 calls credited 20), and pins the intended semantics going forward.
//   * `gov_dedup_map_clears_each_era` — new map, so there is nothing to clear today.

const CAROL: u64 = 3;

#[test]
fn gov_credit_on_live_referendum_works() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        cast_live_vote(ALICE, 7);

        assert_ok!(Agents::record_gov_vote(
            RuntimeOrigin::signed(ALICE),
            ALICE,
            7
        ));

        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 1);
        assert!(EraGovVotedPolls::<Test>::get(ALICE, 7));
    });
}

#[test]
fn gov_credit_on_concluded_referendum_earns_nothing() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        cast_live_vote(ALICE, 7);
        assert_ok!(Agents::record_gov_vote(
            RuntimeOrigin::signed(ALICE),
            ALICE,
            7
        ));
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 1);

        // New era, and referendum 7 has since concluded. The vote is STILL held —
        // upstream conviction-voting prunes nothing on poll completion — which is
        // precisely why "does this account hold a vote?" was not a sufficient question.
        Agents::drain_era_maps(0);
        conclude_poll(7);
        assert!(HELD_VOTES.with(|v| v.borrow().contains(&(ALICE, 7))));

        assert_noop!(
            Agents::record_gov_vote(RuntimeOrigin::signed(ALICE), ALICE, 7),
            Error::<Test>::NotActivelyVoting
        );
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 0);
    });
}

#[test]
fn gov_credit_on_removed_vote_earns_nothing() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        cast_live_vote(ALICE, 7);
        // Referendum stays live, but the agent withdrew its vote.
        remove_vote(ALICE, 7);

        assert_noop!(
            Agents::record_gov_vote(RuntimeOrigin::signed(ALICE), ALICE, 7),
            Error::<Test>::NotActivelyVoting
        );
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 0);
    });
}

#[test]
fn gov_credit_requires_a_vote_on_that_specific_poll() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        // Alice votes on 1; poll 2 is live but she has not voted on it.
        cast_live_vote(ALICE, 1);
        cast_live_vote(BOB, 2);

        assert_noop!(
            Agents::record_gov_vote(RuntimeOrigin::signed(ALICE), ALICE, 2),
            Error::<Test>::NotActivelyVoting
        );
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 0);
    });
}

#[test]
fn one_live_vote_credits_exactly_once_per_era() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        cast_live_vote(ALICE, 3);

        assert_ok!(Agents::record_gov_vote(
            RuntimeOrigin::signed(ALICE),
            ALICE,
            3
        ));

        // The whole of the rest of the per-era budget, spent on the same referendum.
        // Pre-ROUND14 every one of these succeeded and EraGovParticipation ended at 20,
        // worth the full +alpha bps of activity for a single historical click.
        for _ in 1..<Test as Config>::MaxProposalsPerEra::get() {
            assert_noop!(
                Agents::record_gov_vote(RuntimeOrigin::signed(ALICE), ALICE, 3),
                Error::<Test>::PollAlreadyCredited
            );
        }
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 1);
    });
}

#[test]
fn distinct_live_referenda_each_credit_once_up_to_cap() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));

        // Three distinct live referenda → exactly three credits.
        for poll in 0..3u32 {
            cast_live_vote(ALICE, poll);
            assert_ok!(Agents::record_gov_vote(
                RuntimeOrigin::signed(ALICE),
                ALICE,
                poll
            ));
        }
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 3);

        // A second sweep over the SAME three still-live referenda adds nothing. This is
        // the half that fails pre-ROUND14: with no poll index bound to the credit, every
        // one of these calls succeeded and the count reached 6.
        for poll in 0..3u32 {
            assert_noop!(
                Agents::record_gov_vote(RuntimeOrigin::signed(ALICE), ALICE, poll),
                Error::<Test>::PollAlreadyCredited
            );
        }
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 3);

        // Take it to the per-era ceiling, then one past it.
        let cap = <Test as Config>::MaxProposalsPerEra::get();
        for poll in 3..cap {
            cast_live_vote(ALICE, poll);
            assert_ok!(Agents::record_gov_vote(
                RuntimeOrigin::signed(ALICE),
                ALICE,
                poll
            ));
        }
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), cap);

        cast_live_vote(ALICE, cap);
        assert_noop!(
            Agents::record_gov_vote(RuntimeOrigin::signed(ALICE), ALICE, cap),
            Error::<Test>::GovVoteCapReached
        );
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), cap);
    });
}

#[test]
fn gov_dedup_map_clears_each_era() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        cast_live_vote(ALICE, 5);
        assert_ok!(Agents::record_gov_vote(
            RuntimeOrigin::signed(ALICE),
            ALICE,
            5
        ));
        assert!(EraGovVotedPolls::<Test>::get(ALICE, 5));

        Agents::drain_era_maps(0);

        // A long-running referendum is still live next era, and should pay again —
        // the dedup set is per-era, not permanent.
        assert!(!EraGovVotedPolls::<Test>::get(ALICE, 5));
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 0);
        assert_ok!(Agents::record_gov_vote(
            RuntimeOrigin::signed(ALICE),
            ALICE,
            5
        ));
        assert_eq!(EraGovParticipation::<Test>::get(ALICE), 1);
    });
}

// ── ROUND14: diversity credit is order-independent for honest buyers ──────────

#[test]
fn diversity_credits_buyer_whose_escrow_crosses_the_ratio_cap() {
    new_test_ext().execute_with(|| {
        // stake 1,000 × MaxVolToStakeRatio 10 → diversity cap = 10,000 era volume.
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(BOB), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(CAROL), 1_000));

        // Alice takes her whole cap's worth of volume from Bob.
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 10_000));
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 1);

        // Carol is a genuine new counterparty arriving after the cap is reached. She
        // is judged on the volume Alice had BEFORE her deal (10,000, exactly at cap),
        // not on the total her own escrow creates. Pre-ROUND14 the post-escrow total
        // (10,500) was tested, so Carol was denied credit for the volume she herself
        // brought — and her bloom slot was burned in the same breath.
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &CAROL, 500));
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 2);
        assert_eq!(EraEscrowVolume::<Test>::get(ALICE), 10_500);
    });
}

#[test]
fn diversity_slot_not_burned_when_credit_is_denied() {
    new_test_ext().execute_with(|| {
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(BOB), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(CAROL), 1_000));

        // Bob's first deal is comfortably under the 10,000 cap, so he is credited
        // identically before and after this fix — that keeps this test focused on
        // the slot-burn behaviour alone rather than on the pre/post-total change.
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 5_000));
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 1);

        // Alice then runs well past her cap on Bob's volume. Repeat buyers reuse the
        // same bloom slot, so no diversity decision is taken here at all.
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 15_000));
        assert_eq!(EraEscrowVolume::<Test>::get(ALICE), 20_000);

        // Carol arrives while Alice is over cap: correctly no credit yet.
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &CAROL, 100));
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 1);

        // Alice raises her stake, which raises her cap to 3,000 × 10 = 30,000.
        assert_ok!(Agents::add_stake(RuntimeOrigin::signed(ALICE), 2_000));

        // Carol's next deal now clears the cap and must earn credit. Pre-ROUND14 her
        // slot was marked "seen" on the denied deal above before the credit test ran,
        // so this short-circuited and she could never earn credit for the rest of the
        // era — an honest counterparty permanently written off for arriving late.
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &CAROL, 100));
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 2);
    });
}

#[test]
fn diversity_still_denied_to_a_buyer_arriving_above_the_cap() {
    new_test_ext().execute_with(|| {
        // Guard-rail, not a regression test: this passes both before and after the
        // reordering. It pins that the stake-weighted cap still binds, so a future
        // change cannot quietly turn the diversity gate into a no-op.
        assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(BOB), 1_000));
        assert_ok!(Agents::register(RuntimeOrigin::signed(CAROL), 1_000));

        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 5_000));
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &BOB, 5_100));
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 1);
        assert_eq!(EraEscrowVolume::<Test>::get(ALICE), 10_100);

        // prior_total 10,100 > cap 10,000 → no credit, and none available later this
        // era either unless Alice raises her stake.
        assert_ok!(Agents::add_era_escrow_volume(&ALICE, &CAROL, 1));
        assert_eq!(EraUniqueBuyers::<Test>::get(ALICE), 1);
    });
}
