//! pallet-escrow unit tests
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

frame_support::construct_runtime!(
    pub enum Test {
        System:   frame_system,
        Balances: pallet_balances,
        Agents:   pallet_agents,
        Escrow:   crate,
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
    pub const MinStakeX: u64 = 1_000;
    pub const FFStakeX:  u64 = 10_000;
    pub const MaxStakeX: u64 = 1_000_000;
}

impl pallet_agents::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type MinStake = MinStakeX;
    type FullFloorStake = FFStakeX;
    type MaxStakePerAgent = MaxStakeX;
    // BlockNumber- and Balance-typed constants: ConstU64, not ConstU32. Values unchanged.
    type UnstakeCooldown = ConstU64<100>;
    type BaseRegistrationFee = ConstU64<50>;
    type MaxRegistrationsPerBlock = ConstU32<10>;
    type MaxAgents = ConstU32<100>;
    type Rank3MinCompletions = ConstU32<50>;
    type MinRank3OracleScore = ConstU32<0>;
    type Rank3SpanGate = ConstU64<0>;
    type MaxVolToStakeRatio = ConstU32<0>;
    type HeartbeatGracePeriod = ConstU64<600>;
    type HeartbeatDecayPeriod = ConstU64<14400>;
    type OnAgentRegistered = ();
    type OnAgentSlashed = ();
    type OnStakeChanged = ();
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

// Static zero fee provider
pub struct ZeroFee;
impl frame_support::traits::Get<u32> for ZeroFee {
    fn get() -> u32 {
        0
    }
}

parameter_types! {
    pub const MaxAgreements:     u32 = 5;
    pub const MaxAgreementSpan:  u64 = 1_000;
    pub const MinAmount:         u64 = 10;
    pub const MinDelivery:       u64 = 5;
    pub const BuyerRespWindow:   u64 = 50;
    pub const DisputeTimeout:    u64 = 200;
    pub const DisputeRespWindow: u64 = 100;
    pub const DisputeBountyBps:  u32 = 200; // 2%
    pub const MinBounty:         u64 = 10;
    pub const DisputeBurnBps:    u32 = 0;
}

impl super::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    // No `Currency` here: escrow::Config does not declare one — it spends through
    // pallet_agents::Config::Currency, which this mock already sets to Balances.
    type MaxAgreementsPerPair = MaxAgreements;
    type MaxAgreementSpan = MaxAgreementSpan;
    type MinAgreementAmount = MinAmount;
    type MinDeliveryBlocks = MinDelivery;
    type BuyerResponseWindow = BuyerRespWindow;
    type DisputeTimeoutWindow = DisputeTimeout;
    type DisputeResponseWindow = DisputeRespWindow;
    type DisputeBountyBps = DisputeBountyBps;
    type MinDisputeBounty = MinBounty;
    type DisputeBurnBps = DisputeBurnBps;
    type DisputeOracle = ();
    type DisputeCallback = ();
    type CompletionFeeProvider = ZeroFee;
    type FeeDestination = (); // test: fee is burned (no treasury in unit test runtime)
}

fn new_test_ext() -> sp_io::TestExternalities {
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
    pallet_balances::GenesisConfig::<Test> {
        balances: vec![(1, 200_000), (2, 200_000), (3, 200_000)],
        dev_accounts: None, // new field; None = generate none, as before
    }
    .assimilate_storage(&mut storage)
    .unwrap();
    storage.into()
}

const ALICE: u64 = 1; // buyer
const BOB: u64 = 2; // provider

fn register_both() {
    assert_ok!(Agents::register(RuntimeOrigin::signed(ALICE), 1_000));
    assert_ok!(Agents::register(RuntimeOrigin::signed(BOB), 1_000));
}

fn create(amount: u64) -> u32 {
    assert_ok!(Escrow::create_agreement(
        RuntimeOrigin::signed(ALICE),
        BOB,
        amount,
        [1u8; 32],
        500,
        None,
    ));
    0u32 // seq 0 for first agreement
}

#[test]
fn full_happy_path() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        // Advance past min delivery blocks
        frame_system::Pallet::<Test>::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        let bob_before = Balances::free_balance(BOB);
        assert_ok!(Escrow::confirm_delivery(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));
        // Bob should have received the 1000 CMN
        assert_eq!(Balances::free_balance(BOB), bob_before + 1_000);
        // Agreement removed
        assert!(Agreements::<Test>::get(ALICE, BOB).is_empty());
        // ActiveEscrowCount decremented
        assert_eq!(pallet_agents::ActiveEscrowCount::<Test>::get(BOB), 0);
    });
}

#[test]
fn cannot_create_self_deal() {
    new_test_ext().execute_with(|| {
        register_both();
        assert_noop!(
            Escrow::create_agreement(
                RuntimeOrigin::signed(ALICE),
                ALICE,
                1_000,
                [1u8; 32],
                500,
                None,
            ),
            Error::<Test>::SelfDeal
        );
    });
}

#[test]
fn create_agreement_rejects_provider_without_capability() {
    new_test_ext().execute_with(|| {
        register_both();
        // BOB is registered but never called set_capability(7).
        assert_noop!(
            Escrow::create_agreement(
                RuntimeOrigin::signed(ALICE),
                BOB,
                1_000,
                [1u8; 32],
                500,
                Some(7),
            ),
            Error::<Test>::ProviderLacksCapability
        );
        // With the capability registered, the same call succeeds.
        assert_ok!(Agents::set_capability(RuntimeOrigin::signed(BOB), 7, true));
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            1_000,
            [1u8; 32],
            500,
            Some(7),
        ));
    });
}

#[test]
fn record_delivery_rejects_provider_without_capability() {
    new_test_ext().execute_with(|| {
        register_both();
        assert_ok!(Agents::set_capability(RuntimeOrigin::signed(BOB), 7, true));
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            1_000,
            [1u8; 32],
            500,
            Some(7),
        ));
        // Provider drops the capability after the agreement is created.
        assert_ok!(Agents::set_capability(RuntimeOrigin::signed(BOB), 7, false));
        System::set_block_number(10); // past MinDeliveryBlocks(5)
        assert_noop!(
            Escrow::record_delivery(RuntimeOrigin::signed(BOB), ALICE, 0, [2u8; 32]),
            Error::<Test>::ProviderLacksCapability
        );
    });
}

#[test]
fn create_agreement_rejects_deliver_by_beyond_span() {
    new_test_ext().execute_with(|| {
        register_both();
        // now(0) + MaxAgreementSpan(1000) = 1000; 1001 is one block too far.
        assert_noop!(
            Escrow::create_agreement(
                RuntimeOrigin::signed(ALICE),
                BOB,
                1_000,
                [1u8; 32],
                1_001,
                None,
            ),
            Error::<Test>::SpanTooLong
        );
        // Exactly at the span is allowed and stored unclamped.
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            1_000,
            [1u8; 32],
            1_000,
            None,
        ));
        assert_eq!(Agreements::<Test>::get(ALICE, BOB)[0].deliver_by, 1_000);
    });
}

#[test]
fn extend_deadline_rejects_beyond_span() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        assert_noop!(
            Escrow::extend_deadline(RuntimeOrigin::signed(ALICE), BOB, 0, 1_001),
            Error::<Test>::SpanTooLong
        );
    });
}

#[test]
fn cannot_deliver_before_min_blocks() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        // Block 0 — min delivery is 5 blocks
        assert_noop!(
            Escrow::record_delivery(RuntimeOrigin::signed(BOB), ALICE, 0, [2u8; 32]),
            Error::<Test>::MinDeliveryBlocksNotElapsed
        );
    });
}

#[test]
fn dispute_sets_status_and_reserves_bounty() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        frame_system::Pallet::<Test>::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        assert_ok!(Escrow::dispute_delivery(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));
        let agreements = Agreements::<Test>::get(ALICE, BOB);
        assert_eq!(agreements[0].status, AgreementStatus::Disputed);
        // Bounty (2% of 1000 = 20, clamped to min_bounty=10) deducted from amount
        assert!(agreements[0].amount < 1_000);
    });
}

#[test]
fn claim_refund_after_timeout() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        frame_system::Pallet::<Test>::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        assert_ok!(Escrow::dispute_delivery(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));

        let alice_before = Balances::reserved_balance(ALICE);
        // Advance past dispute timeout (200 blocks)
        frame_system::Pallet::<Test>::set_block_number(220);
        assert_ok!(Escrow::claim_refund(RuntimeOrigin::signed(ALICE), BOB, 0));
        // Alice's reserve should decrease (funds released)
        assert!(Balances::reserved_balance(ALICE) < alice_before);
    });
}

#[test]
fn provider_wins_oracle_settles_correctly() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        frame_system::Pallet::<Test>::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        assert_ok!(Escrow::dispute_delivery(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));
        let bob_before = Balances::free_balance(BOB);
        // Simulate oracle callback: provider wins
        assert_ok!(Escrow::settle_dispute_from_oracle(&ALICE, &BOB, 0, true));
        assert!(Balances::free_balance(BOB) > bob_before);
    });
}

#[test]
fn deadline_too_early_rejected() {
    new_test_ext().execute_with(|| {
        register_both();
        // deliver_by = block 0 (in the past at block 0) → should fail
        assert_noop!(
            Escrow::create_agreement(RuntimeOrigin::signed(ALICE), BOB, 1_000, [1u8; 32], 2, None,),
            Error::<Test>::DeadlineTooEarly
        );
    });
}

#[test]
fn bilateral_cap_prevents_too_many_agreements() {
    new_test_ext().execute_with(|| {
        register_both();
        for _ in 0..5 {
            assert_ok!(Escrow::create_agreement(
                RuntimeOrigin::signed(ALICE),
                BOB,
                10,
                [1u8; 32],
                500,
                None,
            ));
        }
        // 6th should fail
        assert_noop!(
            Escrow::create_agreement(RuntimeOrigin::signed(ALICE), BOB, 10, [1u8; 32], 500, None,),
            Error::<Test>::BilateralCapReached
        );
    });
}

#[test]
fn extend_deadline_works_for_buyer() {
    new_test_ext().execute_with(|| {
        register_both();
        // Create agreement with deliver_by = 500 (must be > now(0) + MinDelivery(5) = 5)
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            1_000,
            [1u8; 32],
            500,
            None,
        ));
        // Extend deadline to 800 (must be > 500, <= created_at(0) + MaxAgreementSpan(1000))
        assert_ok!(Escrow::extend_deadline(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0,
            800
        ));
        let agreements = Agreements::<Test>::get(ALICE, BOB);
        assert_eq!(agreements[0].deliver_by, 800);
    });
}

#[test]
fn extend_deadline_fails_if_new_not_later() {
    new_test_ext().execute_with(|| {
        register_both();
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            1_000,
            [1u8; 32],
            500,
            None,
        ));
        // 300 < 500 — not later
        assert_noop!(
            Escrow::extend_deadline(RuntimeOrigin::signed(ALICE), BOB, 0, 300),
            Error::<Test>::NewDeadlineMustBeLater
        );
    });
}

#[test]
fn extend_deadline_fails_after_delivery_recorded() {
    new_test_ext().execute_with(|| {
        register_both();
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            1_000,
            [1u8; 32],
            500,
            None,
        ));
        frame_system::Pallet::<Test>::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        // Cannot extend after delivery recorded (status = Delivered)
        assert_noop!(
            Escrow::extend_deadline(RuntimeOrigin::signed(ALICE), BOB, 0, 800),
            Error::<Test>::WrongStatus
        );
    });
}

// ── E18 + E2: provider consent and expiry (#180) ─────────────────────────────

fn bob_active() -> u32 {
    pallet_agents::ActiveEscrowCount::<Test>::get(BOB)
}

#[test]
fn unaccepted_agreement_does_not_count_toward_active_escrow() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        assert!(PendingAcceptance::<Test>::contains_key(ALICE, (BOB, 0u32)));
        assert_eq!(bob_active(), 0);
        // Accepting is what makes it count.
        assert_ok!(Escrow::accept_agreement(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0
        ));
        assert!(!PendingAcceptance::<Test>::contains_key(ALICE, (BOB, 0u32)));
        assert_eq!(bob_active(), 1);
        // Only the provider can accept, and only once.
        assert_noop!(
            Escrow::accept_agreement(RuntimeOrigin::signed(BOB), ALICE, 0),
            Error::<Test>::NotPending
        );
    });
}

#[test]
fn provider_can_reject_pending_agreement_and_buyer_is_refunded() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        assert_eq!(Balances::reserved_balance(ALICE), 1_000);
        // A stranger cannot reject on the provider's behalf.
        assert_noop!(
            Escrow::reject_agreement(RuntimeOrigin::signed(3), ALICE, 0),
            Error::<Test>::AgreementNotFound
        );
        assert_ok!(Escrow::reject_agreement(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0
        ));
        assert_eq!(Balances::reserved_balance(ALICE), 0);
        assert!(Agreements::<Test>::get(ALICE, BOB).is_empty());
        assert!(!PendingAcceptance::<Test>::contains_key(ALICE, (BOB, 0u32)));
        assert_eq!(bob_active(), 0);
        assert_eq!(ActiveAgreementCount::<Test>::get(), 0);
    });
}

#[test]
fn buyer_can_cancel_pending_agreement() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        assert_ok!(Escrow::cancel_pending(RuntimeOrigin::signed(ALICE), BOB, 0));
        assert_eq!(Balances::reserved_balance(ALICE), 0);
        assert!(Agreements::<Test>::get(ALICE, BOB).is_empty());
        assert!(!PendingAcceptance::<Test>::contains_key(ALICE, (BOB, 0u32)));
        assert_eq!(bob_active(), 0);
        // Once accepted, the buyer can no longer cancel unilaterally.
        create(1_000);
        assert_ok!(Escrow::accept_agreement(
            RuntimeOrigin::signed(BOB),
            ALICE,
            1
        ));
        assert_noop!(
            Escrow::cancel_pending(RuntimeOrigin::signed(ALICE), BOB, 1),
            Error::<Test>::NotPending
        );
    });
}

#[test]
fn record_delivery_requires_acceptance() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        System::set_block_number(10);
        assert_noop!(
            Escrow::record_delivery(RuntimeOrigin::signed(BOB), ALICE, 0, [2u8; 32]),
            Error::<Test>::NotAccepted
        );
        assert_ok!(Escrow::accept_agreement(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0
        ));
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
    });
}

#[test]
fn victim_can_unstake_with_pending_agreements_open() {
    new_test_ext().execute_with(|| {
        register_both();
        // E18: the buyer spams the provider with pending agreements.
        for _ in 0..3 {
            create(1_000);
        }
        assert_eq!(bob_active(), 0);
        assert_ok!(Agents::request_unstake(RuntimeOrigin::signed(BOB)));
    });
}

#[test]
fn expire_agreement_refunds_buyer_after_deadline_plus_grace() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000); // deliver_by = 500
        assert_ok!(Escrow::accept_agreement(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0
        ));
        assert_eq!(bob_active(), 1);
        System::set_block_number(500 + EXPIRY_GRACE as u64 + 1);
        // Anyone may trigger it.
        assert_ok!(Escrow::expire_agreement(
            RuntimeOrigin::signed(3),
            ALICE,
            BOB,
            0
        ));
        assert_eq!(Balances::reserved_balance(ALICE), 0);
        assert!(Agreements::<Test>::get(ALICE, BOB).is_empty());
        assert_eq!(bob_active(), 0);
        assert_eq!(ActiveAgreementCount::<Test>::get(), 0);
    });
}

#[test]
fn expire_agreement_rejects_before_deadline() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000); // deliver_by = 500
        assert_ok!(Escrow::accept_agreement(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0
        ));
        System::set_block_number(400);
        assert_noop!(
            Escrow::expire_agreement(RuntimeOrigin::signed(3), ALICE, BOB, 0),
            Error::<Test>::AgreementNotExpired
        );
        // Inside the grace window is still too early (needs now > deliver_by + grace).
        System::set_block_number(500 + EXPIRY_GRACE as u64);
        assert_noop!(
            Escrow::expire_agreement(RuntimeOrigin::signed(3), ALICE, BOB, 0),
            Error::<Test>::AgreementNotExpired
        );
    });
}

#[test]
fn expire_agreement_rejects_when_delivered() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        assert_ok!(Escrow::accept_agreement(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0
        ));
        System::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        System::set_block_number(600);
        assert_noop!(
            Escrow::expire_agreement(RuntimeOrigin::signed(3), ALICE, BOB, 0),
            Error::<Test>::AlreadyDelivered
        );
    });
}

#[test]
fn grandfathered_agreement_without_entry_is_treated_as_accepted() {
    new_test_ext().execute_with(|| {
        register_both();
        create(1_000);
        // Simulate an agreement created before this change: it counted at creation and
        // has no PendingAcceptance entry.
        PendingAcceptance::<Test>::remove(ALICE, (BOB, 0u32));
        pallet_agents::ActiveEscrowCount::<Test>::insert(BOB, 1);
        System::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        assert_ok!(Escrow::confirm_delivery(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));
        assert_eq!(bob_active(), 0);
        // And a grandfathered agreement is not acceptable a second time.
        assert_noop!(
            Escrow::accept_agreement(RuntimeOrigin::signed(BOB), ALICE, 0),
            Error::<Test>::AgreementNotFound
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
