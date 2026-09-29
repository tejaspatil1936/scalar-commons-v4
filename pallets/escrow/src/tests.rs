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

// Completion-fee provider: 0 bps by default (existing tests are fee-free), settable per test.
thread_local! {
    static FEE_BPS: core::cell::Cell<u32> = const { core::cell::Cell::new(0) };
}
pub struct MockFeeBps;
impl frame_support::traits::Get<u32> for MockFeeBps {
    fn get() -> u32 {
        FEE_BPS.with(|f| f.get())
    }
}
fn set_fee_bps(bps: u32) {
    FEE_BPS.with(|f| f.set(bps));
}

/// Stand-in for the runtime's Treasury: `FeeDestination` credits this account, so a test
/// can assert on where the completion fee and dispute penalty actually land.
const TREASURY: u64 = 99;
pub struct MockTreasury;
impl frame_support::traits::OnUnbalanced<pallet_balances::NegativeImbalance<Test>>
    for MockTreasury
{
    fn on_nonzero_unbalanced(amount: pallet_balances::NegativeImbalance<Test>) {
        <Balances as frame_support::traits::Currency<u64>>::resolve_creating(&TREASURY, amount);
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
    type CompletionFeeProvider = MockFeeBps; // 0 unless a test sets it via `set_fee_bps`
    type FeeDestination = MockTreasury; // credits TREASURY so fee routing is observable
}

fn new_test_ext() -> sp_io::TestExternalities {
    set_fee_bps(0);
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

// ── Ledger-level tests (#186) ────────────────────────────────────────────────
//
// Every test below asserts on events and storage/balances, never only on a call's
// return value ("trust the ledger"). Events are only recorded from block 1.

fn last_escrow_events() -> Vec<crate::pallet::Event<Test>> {
    System::events()
        .into_iter()
        .filter_map(|r| match r.event {
            RuntimeEvent::Escrow(e) => Some(e),
            _ => None,
        })
        .collect()
}

/// Register both agents at block 1 and open one agreement (`amount`, deliver_by 500).
fn setup_agreement(amount: u64) {
    System::set_block_number(1);
    register_both();
    assert_ok!(Escrow::create_agreement(
        RuntimeOrigin::signed(ALICE),
        BOB,
        amount,
        [1u8; 32],
        500,
        None,
    ));
}

/// E5 — full lifecycle create → deliver → confirm leaves the ledger consistent.
/// NOTE: the issue brief does not define E5; it is encoded here as the settlement
/// lifecycle invariant (funds, counters, storage and events all agree).
#[test]
fn e5_lifecycle_events_storage_and_balances_agree() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        register_both();
        let alice_reserved0 = Balances::reserved_balance(ALICE);
        let alice_free0 = Balances::free_balance(ALICE);
        let bob_free0 = Balances::free_balance(BOB);
        let issuance0 = Balances::total_issuance();

        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            1_000,
            [1u8; 32],
            500,
            None,
        ));
        assert_eq!(Balances::reserved_balance(ALICE), alice_reserved0 + 1_000);
        assert_eq!(Balances::free_balance(ALICE), alice_free0 - 1_000);
        assert_eq!(pallet_agents::ActiveEscrowCount::<Test>::get(BOB), 1);
        assert_eq!(ActiveAgreementCount::<Test>::get(), 1);
        assert_eq!(NextSeq::<Test>::get(ALICE, BOB), 1);
        let a = &Agreements::<Test>::get(ALICE, BOB)[0];
        assert_eq!(
            (a.status, a.amount, a.seq, a.created_at),
            (AgreementStatus::Created, 1_000, 0, 1)
        );

        System::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        let a = &Agreements::<Test>::get(ALICE, BOB)[0];
        assert_eq!(
            (a.status, a.delivery_proof),
            (AgreementStatus::Delivered, Some([2u8; 32]))
        );

        assert_ok!(Escrow::confirm_delivery(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));
        assert!(Agreements::<Test>::get(ALICE, BOB).is_empty());
        assert_eq!(Balances::reserved_balance(ALICE), alice_reserved0);
        assert_eq!(Balances::free_balance(ALICE), alice_free0 - 1_000);
        assert_eq!(Balances::free_balance(BOB), bob_free0 + 1_000);
        assert_eq!(Balances::total_issuance(), issuance0);
        assert_eq!(pallet_agents::ActiveEscrowCount::<Test>::get(BOB), 0);
        assert_eq!(ActiveAgreementCount::<Test>::get(), 0);

        assert_eq!(
            last_escrow_events(),
            vec![
                Event::AgreementCreated {
                    buyer: ALICE,
                    provider: BOB,
                    seq: 0,
                    amount: 1_000
                },
                Event::DeliveryRecorded {
                    provider: BOB,
                    buyer: ALICE,
                    seq: 0,
                    proof: [2u8; 32]
                },
                Event::DeliveryConfirmed {
                    buyer: ALICE,
                    provider: BOB,
                    seq: 0,
                    amount: 1_000
                },
            ]
        );
    });
}

/// E6 — the completion fee (25 bps of the agreement) reaches the Treasury via
/// `FeeDestination`, the provider gets the remainder, and issuance is unchanged
/// (the fee is re-credited, not burned).
#[test]
fn e6_completion_fee_is_routed_to_treasury() {
    new_test_ext().execute_with(|| {
        set_fee_bps(25); // 25 bps = 0.25%: 1_000_000 * 25 / 10_000 = 2_500
        System::set_block_number(1);
        register_both();
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            100_000,
            [1u8; 32],
            500,
            None,
        ));
        System::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        let bob_free0 = Balances::free_balance(BOB);
        let reserved0 = Balances::reserved_balance(ALICE);
        let issuance0 = Balances::total_issuance();
        assert_eq!(Balances::free_balance(TREASURY), 0);

        assert_ok!(Escrow::confirm_delivery(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));

        // 100_000 * 25 bps = 250 to Treasury; provider nets 99_750.
        assert_eq!(Balances::free_balance(TREASURY), 250);
        assert_eq!(Balances::free_balance(BOB), bob_free0 + 99_750);
        assert_eq!(Balances::reserved_balance(ALICE), reserved0 - 100_000);
        assert_eq!(Balances::total_issuance(), issuance0);
        // The event reports the gross agreement amount.
        assert_eq!(
            last_escrow_events().last(),
            Some(&Event::DeliveryConfirmed {
                buyer: ALICE,
                provider: BOB,
                seq: 0,
                amount: 100_000
            })
        );
    });
}

/// E6 — with a zero fee nothing reaches the Treasury and the provider is paid in full.
#[test]
fn e6_zero_fee_sends_nothing_to_treasury() {
    new_test_ext().execute_with(|| {
        setup_agreement(1_000);
        System::set_block_number(10);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        let bob_free0 = Balances::free_balance(BOB);
        assert_ok!(Escrow::confirm_delivery(
            RuntimeOrigin::signed(ALICE),
            BOB,
            0
        ));
        assert_eq!(Balances::free_balance(TREASURY), 0);
        assert_eq!(Balances::free_balance(BOB), bob_free0 + 1_000);
    });
}

/// E19 — a self-deal is rejected with no funds reserved, no storage written, no event.
#[test]
fn e19_self_deal_leaves_no_trace() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        register_both();
        let reserved0 = Balances::reserved_balance(ALICE);
        let free0 = Balances::free_balance(ALICE);
        assert_noop!(
            Escrow::create_agreement(
                RuntimeOrigin::signed(ALICE),
                ALICE,
                1_000,
                [1u8; 32],
                500,
                None
            ),
            Error::<Test>::SelfDeal
        );
        assert!(Agreements::<Test>::get(ALICE, ALICE).is_empty());
        assert_eq!(NextSeq::<Test>::get(ALICE, ALICE), 0);
        assert_eq!(Balances::reserved_balance(ALICE), reserved0);
        assert_eq!(Balances::free_balance(ALICE), free0);
        assert_eq!(ActiveAgreementCount::<Test>::get(), 0);
        assert_eq!(pallet_agents::ActiveEscrowCount::<Test>::get(ALICE), 0);
        assert!(last_escrow_events().is_empty());
    });
}

/// E24 — the bilateral cap (5 in the mock) holds: the 6th open agreement is refused
/// without moving funds, and a slot frees up once one settles.
#[test]
fn e24_pair_cap_enforced_and_slot_frees_on_settlement() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        register_both();
        let reserved0 = Balances::reserved_balance(ALICE);
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
        assert_eq!(Agreements::<Test>::get(ALICE, BOB).len(), 5);
        assert_eq!(Balances::reserved_balance(ALICE), reserved0 + 50);
        let events_before = last_escrow_events().len();

        assert_noop!(
            Escrow::create_agreement(RuntimeOrigin::signed(ALICE), BOB, 10, [1u8; 32], 500, None),
            Error::<Test>::BilateralCapReached
        );
        assert_eq!(Agreements::<Test>::get(ALICE, BOB).len(), 5);
        assert_eq!(NextSeq::<Test>::get(ALICE, BOB), 5);
        assert_eq!(Balances::reserved_balance(ALICE), reserved0 + 50);
        assert_eq!(pallet_agents::ActiveEscrowCount::<Test>::get(BOB), 5);
        assert_eq!(last_escrow_events().len(), events_before);

        // The cap is per (buyer, provider): another buyer can still open one with BOB.
        assert_ok!(Agents::register(RuntimeOrigin::signed(3), 1_000));
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(3),
            BOB,
            10,
            [1u8; 32],
            500,
            None
        ));
        assert_eq!(Agreements::<Test>::get(3, BOB).len(), 1);

        // Settling one frees a slot for ALICE.
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
        assert_eq!(Agreements::<Test>::get(ALICE, BOB).len(), 4);
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            10,
            [1u8; 32],
            500,
            None
        ));
        let a = Agreements::<Test>::get(ALICE, BOB);
        assert_eq!(a.len(), 5);
        // Sequence numbers are never reused.
        assert_eq!(a.iter().map(|x| x.seq).max(), Some(5));
    });
}

/// MinDeliveryBlocks — delivery is refused until `created_at + MinDeliveryBlocks` (5),
/// allowed exactly at that block, and the refusal leaves the agreement untouched.
#[test]
fn min_delivery_blocks_boundary() {
    new_test_ext().execute_with(|| {
        setup_agreement(1_000); // created_at = 1, so delivery opens at block 6
        System::set_block_number(5);
        assert_noop!(
            Escrow::record_delivery(RuntimeOrigin::signed(BOB), ALICE, 0, [2u8; 32]),
            Error::<Test>::MinDeliveryBlocksNotElapsed
        );
        let a = &Agreements::<Test>::get(ALICE, BOB)[0];
        assert_eq!(
            (a.status, a.delivery_proof),
            (AgreementStatus::Created, None)
        );
        assert_eq!(last_escrow_events().len(), 1); // only AgreementCreated

        System::set_block_number(6);
        assert_ok!(Escrow::record_delivery(
            RuntimeOrigin::signed(BOB),
            ALICE,
            0,
            [2u8; 32]
        ));
        let a = &Agreements::<Test>::get(ALICE, BOB)[0];
        assert_eq!(
            (a.status, a.delivery_proof),
            (AgreementStatus::Delivered, Some([2u8; 32]))
        );
        assert_eq!(
            last_escrow_events().last(),
            Some(&Event::DeliveryRecorded {
                provider: BOB,
                buyer: ALICE,
                seq: 0,
                proof: [2u8; 32]
            })
        );
    });
}

/// MinDeliveryBlocks — `deliver_by` must exceed `now + MinDeliveryBlocks`; a rejected
/// create reserves nothing.
#[test]
fn min_delivery_blocks_bounds_deliver_by_at_creation() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        register_both();
        let reserved0 = Balances::reserved_balance(ALICE);
        // now(1) + MinDelivery(5) = 6: deliver_by 6 is too early, 7 is the first allowed.
        assert_noop!(
            Escrow::create_agreement(RuntimeOrigin::signed(ALICE), BOB, 1_000, [1u8; 32], 6, None),
            Error::<Test>::DeadlineTooEarly
        );
        assert_eq!(Balances::reserved_balance(ALICE), reserved0);
        assert_ok!(Escrow::create_agreement(
            RuntimeOrigin::signed(ALICE),
            BOB,
            1_000,
            [1u8; 32],
            7,
            None
        ));
        assert_eq!(Agreements::<Test>::get(ALICE, BOB)[0].deliver_by, 7);
    });
}

/// Refund path — an undelivered agreement is refundable only strictly after
/// `deliver_by + BuyerResponseWindow` (500 + 50); the buyer gets the full amount back.
#[test]
fn refund_after_buyer_response_window_returns_funds_and_clears_state() {
    new_test_ext().execute_with(|| {
        setup_agreement(1_000);
        let free_after_create = Balances::free_balance(ALICE);
        let reserved_after_create = Balances::reserved_balance(ALICE);

        System::set_block_number(550); // == deliver_by + window: not yet
        assert_noop!(
            Escrow::claim_refund(RuntimeOrigin::signed(ALICE), BOB, 0),
            Error::<Test>::DisputeTimeoutNotElapsed
        );
        assert_eq!(Agreements::<Test>::get(ALICE, BOB).len(), 1);
        assert_eq!(Balances::reserved_balance(ALICE), reserved_after_create);

        System::set_block_number(551);
        assert_ok!(Escrow::claim_refund(RuntimeOrigin::signed(ALICE), BOB, 0));
        assert!(Agreements::<Test>::get(ALICE, BOB).is_empty());
        assert_eq!(Balances::free_balance(ALICE), free_after_create + 1_000);
        assert_eq!(
            Balances::reserved_balance(ALICE),
            reserved_after_create - 1_000
        );
        assert_eq!(pallet_agents::ActiveEscrowCount::<Test>::get(BOB), 0);
        assert_eq!(ActiveAgreementCount::<Test>::get(), 0);
        assert_eq!(
            last_escrow_events().last(),
            Some(&Event::RefundClaimed {
                buyer: ALICE,
                provider: BOB,
                seq: 0,
                amount: 1_000
            })
        );
    });
}

/// Refund path — only the buyer of record can refund; a stranger finds no agreement and
/// the ledger is untouched.
#[test]
fn refund_by_non_buyer_is_refused() {
    new_test_ext().execute_with(|| {
        setup_agreement(1_000);
        System::set_block_number(1_000);
        let reserved0 = Balances::reserved_balance(ALICE);
        assert_noop!(
            Escrow::claim_refund(RuntimeOrigin::signed(3), BOB, 0),
            Error::<Test>::AgreementNotFound
        );
        // The provider signing as "buyer" is likewise not found (no BOB→BOB agreement).
        assert_noop!(
            Escrow::claim_refund(RuntimeOrigin::signed(BOB), BOB, 0),
            Error::<Test>::AgreementNotFound
        );
        assert_eq!(Agreements::<Test>::get(ALICE, BOB).len(), 1);
        assert_eq!(Balances::reserved_balance(ALICE), reserved0);
    });
}

/// Refund path — a disputed agreement refunds the buyer only once `DisputeTimeoutWindow`
/// (200) has passed since it opened, and only the post-bounty remainder is returned.
#[test]
fn refund_of_disputed_agreement_waits_for_dispute_timeout() {
    new_test_ext().execute_with(|| {
        setup_agreement(1_000);
        System::set_block_number(10);
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
        // Bounty = max(2% of 1_000 = 20, MinBounty 10) = 20 leaves the agreement amount.
        let a = &Agreements::<Test>::get(ALICE, BOB)[0];
        assert_eq!(
            (a.status, a.amount, a.dispute_opened_at),
            (AgreementStatus::Disputed, 980, Some(10))
        );
        let reserved0 = Balances::reserved_balance(ALICE);
        let free0 = Balances::free_balance(ALICE);

        System::set_block_number(209); // opened(10) + 200 = 210 is the first refundable block
        assert_noop!(
            Escrow::claim_refund(RuntimeOrigin::signed(ALICE), BOB, 0),
            Error::<Test>::DisputeTimeoutNotElapsed
        );
        System::set_block_number(210);
        assert_ok!(Escrow::claim_refund(RuntimeOrigin::signed(ALICE), BOB, 0));
        assert!(Agreements::<Test>::get(ALICE, BOB).is_empty());
        assert_eq!(Balances::free_balance(ALICE), free0 + 980);
        assert_eq!(Balances::reserved_balance(ALICE), reserved0 - 980);
        assert_eq!(pallet_agents::ActiveEscrowCount::<Test>::get(BOB), 0);
        assert_eq!(
            last_escrow_events().last(),
            Some(&Event::RefundClaimed {
                buyer: ALICE,
                provider: BOB,
                seq: 0,
                amount: 980
            })
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
