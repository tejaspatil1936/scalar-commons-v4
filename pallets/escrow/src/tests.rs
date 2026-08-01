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
    type GovVoteVerifier = ();
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
