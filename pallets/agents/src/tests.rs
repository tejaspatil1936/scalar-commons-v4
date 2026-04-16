//! pallet-agents unit tests
//! Run: cargo test -p pallet-agents -- --nocapture

#![cfg(test)]

use crate::*;
use frame_support::{
    assert_ok, assert_noop, parameter_types,
    traits::{ConstU32, ConstU64},
};
use sp_core::H256;
use sp_runtime::{
    BuildStorage,
    traits::{BlakeTwo256, IdentityLookup},
};

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
    type BaseCallFilter             = frame_support::traits::Everything;
    type BlockWeights               = ();
    type BlockLength                = ();
    type RuntimeOrigin              = RuntimeOrigin;
    type RuntimeCall                = RuntimeCall;
    type RuntimeTask                = ();
    type Nonce                      = u64;
    type Hash                       = H256;
    type Hashing                    = BlakeTwo256;
    type AccountId                  = u64;
    type Lookup                     = IdentityLookup<Self::AccountId>;
    type Block                      = Block;
    type RuntimeEvent               = RuntimeEvent;
    type BlockHashCount             = BlockHashCount;
    type DbWeight                   = ();
    type Version                    = ();
    type PalletInfo                 = PalletInfo;
    type AccountData                = pallet_balances::AccountData<u64>;
    type OnNewAccount               = ();
    type OnKilledAccount            = ();
    type SystemWeightInfo           = ();
    type SS58Prefix                 = SS58Prefix;
    type OnSetCode                  = ();
    type MaxConsumers               = ConstU32<16>;
}

impl pallet_balances::Config for Test {
    type MaxLocks          = ConstU32<50>;
    type MaxReserves       = ConstU32<50>;
    type ReserveIdentifier = [u8; 8];
    type Balance           = u64;
    type RuntimeEvent      = RuntimeEvent;
    type DustRemoval       = ();
    type ExistentialDeposit = ConstU64<1>;
    type AccountStore      = System;
    type WeightInfo        = ();
    type FreezeIdentifier  = ();
    type MaxFreezes        = ConstU32<0>;
    type RuntimeHoldReason = ();
    type RuntimeFreezeReason = ();
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
    type RuntimeEvent            = RuntimeEvent;
    type Currency                = Balances;
    type MinStake                = MinStake;
    type FullFloorStake          = FullFloorStake;
    type MaxStakePerAgent        = MaxStakePerAgent;
    type UnstakeCooldown         = UnstakeCooldown;
    type BaseRegistrationFee     = BaseRegistrationFee;
    type MaxRegistrationsPerBlock = MaxRegistrationsPerBlock;
    type MaxAgents               = MaxAgents;
    type Rank3MinCompletions     = Rank3MinCompletions;
    type MinRank3OracleScore     = MinRank3OracleScore;
    type Rank3SpanGate           = Rank3SpanGate;
    type MaxVolToStakeRatio      = MaxVolToStakeRatio;
    type HeartbeatGracePeriod    = HeartbeatGracePeriod;
    type HeartbeatDecayPeriod    = HeartbeatDecayPeriod;
    type OnAgentRegistered       = ();
    type OnAgentSlashed          = (); // unit test: no emissions pallet
    type OnStakeChanged          = (); // unit test: no emissions pallet
    type AgentCollective         = ();
    type OracleScoreGate          = ();
    type GovVoteVerifier           = ();
    type IdentityHandler         = ();
    type OrchestratorLookup      = ();
    type MaxUriLen               = ConstU32<256>;
    type MaxNameLen              = ConstU32<64>;
    type MaxCapabilitiesPerAgent = ConstU32<20>;
    type MaxDelegationPeriod     = ConstU64<90_000>; // BlockNumber = u64 in test runtime
    type SlashAppealWindow       = ConstU64<10>;     // BlockNumber = u64 in test runtime
    // V4: new Config types
    type MaxProposalsPerEra      = ConstU32<20>;
    type SlashDestination        = ();   // test: slash burns fully (no treasury mock needed)
}

// ── Test helpers ─────────────────────────────────────────────────────────────
fn new_test_ext() -> sp_io::TestExternalities {
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
    pallet_balances::GenesisConfig::<Test> {
        balances: vec![
            (1, 100_000),  // alice
            (2, 100_000),  // bob
            (3, 100_000),  // charlie
            (4, 10),       // poor_dave
        ],
    }
    .assimilate_storage(&mut storage)
    .unwrap();
    storage.into()
}

const ALICE: u64 = 1;
const BOB:   u64 = 2;

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
