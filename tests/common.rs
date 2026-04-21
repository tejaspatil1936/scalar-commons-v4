//! Common utilities for integration tests.

#![allow(dead_code)]

use frame_support::{
    parameter_types,
    traits::{ConstU8, ConstU16, ConstU32, ConstU64, Everything},
};
use sp_core::H256;
use sp_runtime::{BuildStorage, traits::{BlakeTwo256, IdentityLookup}};
use sp_io::TestExternalities;

// ── Test accounts ────────────────────────────────────────────────────────────
pub const ALICE:   u64 = 1;
pub const BOB:     u64 = 2;
pub const CAROL:   u64 = 3;
pub const DAVE:    u64 = 4;
pub const EVE:     u64 = 5;
pub const FRANK:   u64 = 6;
pub const ROOT:    u64 = 999;

// ── Token amounts ─────────────────────────────────────────────────────────────
pub const CMN:         u64 = 1_000_000_000_000; // 1 CMN = 10^12 raw
pub const MIN_STAKE:   u64 = 1_000 * CMN;
pub const FULL_STAKE:  u64 = 10_000 * CMN;
#[allow(dead_code)]
pub const RICH_STAKE:  u64 = 100_000 * CMN;

// ── Block helpers ─────────────────────────────────────────────────────────────
pub fn advance_blocks(n: u64) {
    for _ in 0..n {
        let current = frame_system::Pallet::<TestRuntime>::block_number();
        frame_system::Pallet::<TestRuntime>::set_block_number(current + 1);
    }
}

pub fn go_to_block(n: u64) {
    frame_system::Pallet::<TestRuntime>::set_block_number(n);
}

/// Advance past EraDuration (100 blocks in tests) and call permissionless settle_era.
/// settle_era is now ensure_signed with an era timing gate — must be called by a
/// signed account after EraDuration blocks have elapsed since the era started.
pub fn settle_era(caller: u64) {
    let current = frame_system::Pallet::<TestRuntime>::block_number();
    // EraDuration = 100 in test runtime (ConstU64<100>)
    frame_system::Pallet::<TestRuntime>::set_block_number(current + 100);
    frame_support::assert_ok!(
        pallet_emissions::Pallet::<TestRuntime>::settle_era(
            frame_system::RawOrigin::Signed(caller).into()
        )
    );
}

// ── Test runtime ─────────────────────────────────────────────────────────────

use frame_support::construct_runtime;

type Block = frame_system::mocking::MockBlock<TestRuntime>;

construct_runtime!(
    pub enum TestRuntime {
        System:       frame_system,
        Balances:     pallet_balances,
        Agents:       pallet_agents,
        Escrow:       pallet_escrow,
        Oracle:       pallet_oracle,
        Emissions:    pallet_emissions,
        AutoParams:   pallet_auto_params,
        Orchestrator: pallet_orchestrator,
    }
);

// ── Config impls ──────────────────────────────────────────────────────────────

impl frame_system::Config for TestRuntime {
    type BaseCallFilter         = Everything;
    type BlockWeights           = ();
    type BlockLength            = ();
    type RuntimeOrigin          = RuntimeOrigin;
    type RuntimeCall            = RuntimeCall;
    type RuntimeTask            = RuntimeTask;
    type Nonce                  = u64;
    type Hash                   = H256;
    type Hashing                = BlakeTwo256;
    type AccountId              = u64;
    type Lookup                 = IdentityLookup<Self::AccountId>;
    type Block                  = Block;
    type RuntimeEvent           = RuntimeEvent;
    type BlockHashCount         = ConstU64<250>;
    type DbWeight               = ();
    type Version                = ();
    type PalletInfo             = PalletInfo;
    type AccountData            = pallet_balances::AccountData<u64>;
    type OnNewAccount           = ();
    type OnKilledAccount        = ();
    type SystemWeightInfo       = ();
    type SS58Prefix              = ConstU16<42>;
    type OnSetCode              = ();
    type MaxConsumers           = ConstU32<16>;
    type SingleBlockMigrations  = ();
    type MultiBlockMigrator     = ();
    type PreInherents           = ();
    type PostInherents          = ();
    type PostTransactions       = ();
    type ExtensionsWeightInfo   = ();
}

impl pallet_balances::Config for TestRuntime {
    type MaxLocks              = ConstU32<50>;
    type MaxReserves           = ConstU32<50>;
    type ReserveIdentifier     = [u8; 8];
    type Balance               = u64;
    type RuntimeEvent          = RuntimeEvent;
    type DustRemoval           = ();
    type ExistentialDeposit    = ConstU64<1>;
    type AccountStore          = System;
    type WeightInfo            = ();
    type FreezeIdentifier      = ();
    type MaxFreezes            = ConstU32<0>;
    type RuntimeHoldReason     = ();
    type RuntimeFreezeReason   = ();
    type DoneSlashHandler      = ();
}

// ── Agents Config ─────────────────────────────────────────────────────────────

impl pallet_agents::Config for TestRuntime {
    type RuntimeEvent                = RuntimeEvent;
    type Currency                    = Balances;
    type MinStake                    = ConstU64<{1_000 * CMN}>;
    type FullFloorStake              = ConstU64<{10_000 * CMN}>;
    type MaxStakePerAgent            = ConstU64<{1_000_000 * CMN}>;
    type UnstakeCooldown             = ConstU64<100>;
    type BaseRegistrationFee         = ConstU64<{50 * CMN}>;
    type MaxRegistrationsPerBlock    = ConstU32<10>;
    type MaxAgents                   = ConstU32<1000>;
    type Rank3MinCompletions         = ConstU32<3>;
    type MinRank3OracleScore         = ConstU32<0>;
    type Rank3SpanGate               = ConstU64<0>;
    type MaxVolToStakeRatio          = ConstU32<10>;
    type HeartbeatGracePeriod        = ConstU64<100>;
    type HeartbeatDecayPeriod        = ConstU64<1000>;
    type OnAgentRegistered           = Emissions;
    type OnAgentSlashed              = Emissions; // zeros weight snapshot on slash
    type OnStakeChanged              = Emissions; // zeros snapshot before stake increase (MasterChef fix)
    type AgentCollective             = ();
    type OracleScoreGate          = ();
    type GovVoteVerifier           = ();
    type IdentityHandler             = ();
    type OrchestratorLookup          = TestOrchestratorBridge;
    type MaxUriLen                   = ConstU32<256>;
    type MaxNameLen                  = ConstU32<64>;
    type MaxCapabilitiesPerAgent     = ConstU32<20>;
    type MaxDelegationPeriod         = ConstU64<100_000>;
    type SlashAppealWindow           = ConstU64<10>;
    // V4: new Config types
    type MaxProposalsPerEra          = ConstU32<20>;
    type SlashDestination            = ();  // test: slash is fully burned (no treasury in test runtime)
}

// Orchestrator bridge for agents pallet
pub struct TestOrchestratorBridge;
impl pallet_agents::pallet::OrchestratorLookup<u64, u64> for TestOrchestratorBridge {
    fn get_orchestrator(sub_agent: &u64) -> Option<u64> {
        pallet_orchestrator::SubAgentToOrchestrator::<TestRuntime>::get(sub_agent)
    }
    fn add_orchestrator_volume(orchestrator: &u64, amount: u64) {
        pallet_orchestrator::Pallet::<TestRuntime>::add_orchestrator_volume(orchestrator, amount);
    }
}

// ── Escrow Config ─────────────────────────────────────────────────────────────

impl pallet_escrow::Config for TestRuntime {
    type RuntimeEvent              = RuntimeEvent;
    type MaxAgreementsPerPair      = ConstU32<25>;
    type MaxAgreementSpan          = ConstU64<10_000>;
    type MinAgreementAmount        = ConstU64<{1 * CMN}>;
    type MinDeliveryBlocks         = ConstU64<5>;
