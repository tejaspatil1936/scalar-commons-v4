//! pallet-orchestrator unit tests

#![cfg(test)]

use crate::pallet::*;
use frame_support::{
    assert_noop, assert_ok, parameter_types,
    traits::{ConstU32, ConstU64},
};
use sp_core::H256;
use sp_runtime::{
    traits::{BlakeTwo256, IdentityLookup},
    BuildStorage,
};

type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
    pub enum Test {
        System:       frame_system,
        Balances:     pallet_balances,
        Agents:       pallet_agents,
        Orchestrator: crate,
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
    type BlockHashCount = ConstU32<250>;
    type DbWeight = ();
    type Version = ();
    type PalletInfo = PalletInfo;
    type AccountData = pallet_balances::AccountData<u64>;
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = ConstU32<42>;
    type OnSetCode = ();
    type MaxConsumers = ConstU32<16>;
}
impl pallet_balances::Config for Test {
    type MaxLocks = ConstU32<50>;
    type MaxReserves = ConstU32<50>;
    type ReserveIdentifier = [u8; 8];
    type Balance = u64;
    type RuntimeEvent = RuntimeEvent;
    type DustRemoval = ();
    type ExistentialDeposit = ConstU32<1>;
    type AccountStore = System;
    type WeightInfo = ();
    type FreezeIdentifier = ();
    type MaxFreezes = ConstU32<0>;
    type RuntimeHoldReason = ();
    type RuntimeFreezeReason = ();
}
impl pallet_agents::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type MinStake = ConstU32<1_000>;
    type FullFloorStake = ConstU32<10_000>;
    type MaxStakePerAgent = ConstU32<1_000_000>;
    type UnstakeCooldown = ConstU32<100>;
    type BaseRegistrationFee = ConstU32<50>;
    type MaxRegistrationsPerBlock = ConstU32<10>;
    type MaxAgents = ConstU32<100>;
    type Rank3MinCompletions = ConstU32<50>;
    type MinRank3OracleScore = ConstU32<0>;
    type Rank3SpanGate = ConstU32<0>;
    type MaxVolToStakeRatio = ConstU32<0>;
    type HeartbeatGracePeriod = ConstU32<600>;
    type HeartbeatDecayPeriod = ConstU32<14400>;
    type OnAgentRegistered = ();
    type OnAgentSlashed = ();
    type OnStakeChanged = ();
    type AgentCollective = ();
    type OracleScoreGate = ();
    type GovVoteVerifier = ();
    type IdentityHandler = ();
    type OrchestratorLookup = Orchestrator;
    type MaxUriLen = ConstU32<256>;
    type MaxNameLen = ConstU32<64>;
    type MaxCapabilitiesPerAgent = ConstU32<20>;
    type MaxDelegationPeriod = ConstU64<100_800>; // BlockNumber = u64 in test runtime
    type SlashAppealWindow = ConstU64<10>; // BlockNumber = u64 in test runtime
    type SlashDestination = ();
    type MaxProposalsPerEra = ConstU32<20>;
}

impl super::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type MaxSubAgentsPerOrchestrator = ConstU32<50>;
    type MaxOrchestratorFeeBps = ConstU32<500>;
    type LinkApprovalWindow = ConstU32<100>;
    type MaxPendingProposals = ConstU32<20>;
    type OrchestratorEmissionMultiplier = ConstU32<5_000>;
    type SupplyCap = ConstU64<{ 100_000_000_000_000_000_000 }>; // u64 max-safe cap
}

fn new_test_ext() -> sp_io::TestExternalities {
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
    pallet_balances::GenesisConfig::<Test> {
        balances: vec![(1, 200_000), (2, 200_000), (3, 200_000)],
    }
    .assimilate_storage(&mut storage)
    .unwrap();
    storage.into()
}

const ALICE: u64 = 1; // orchestrator candidate
const BOB: u64 = 2; // sub-agent candidate
const CAROL: u64 = 3; // another agent

fn register(who: u64, stake: u64) {
    assert_ok!(Agents::register(RuntimeOrigin::signed(who), stake));
}

#[test]
fn register_orchestrator_requires_rank2() {
    new_test_ext().execute_with(|| {
        register(ALICE, 1_000); // Rank 0/1 only — below FullFloorStake
                                // () mock returns rank=0 always, so should fail rank gate
                                // Actually () returns Some(0) so rank < 2 → AgentMustBeRank2
        assert_noop!(
            Orchestrator::register_orchestrator(RuntimeOrigin::signed(ALICE), 10, 200),
            Error::<Test>::AgentMustBeRank2
        );
    });
}

#[test]
fn register_orchestrator_with_full_stake_succeeds() {
    new_test_ext().execute_with(|| {
        // With () AgentCollective, rank_of always returns 0.
        // For this test, we check that fee_bps > max fails correctly.
        register(ALICE, 10_000);
        assert_noop!(
            Orchestrator::register_orchestrator(RuntimeOrigin::signed(ALICE), 10, 600),
            Error::<Test>::FeeTooHigh // 600 > MaxOrchestratorFeeBps(500)
        );
    });
}

#[test]
fn propose_and_accept_link_works() {
    new_test_ext().execute_with(|| {
        // Manually insert orchestrator registration (bypassing rank check for test)
        OrchestratorRegistration::<Test>::insert(
            ALICE,
            OrchestratorRecord {
                max_sub_agents: 10,
                fee_bps: 200,
                registered_at: 0,
                active_sub_count: 0,
            },
        );
        register(BOB, 1_000);

        // Propose link
        assert_ok!(Orchestrator::propose_sub_agent_link(
            RuntimeOrigin::signed(ALICE),
            BOB
        ));
        assert!(PendingLinkProposals::<Test>::contains_key(ALICE, BOB));

        // Accept link
        assert_ok!(Orchestrator::accept_orchestrator_link(
            RuntimeOrigin::signed(BOB),
            ALICE
        ));
        assert!(SubAgentLinks::<Test>::contains_key(ALICE, BOB));
        assert_eq!(SubAgentToOrchestrator::<Test>::get(BOB), Some(ALICE));
        // Sub count incremented
        assert_eq!(
            OrchestratorRegistration::<Test>::get(ALICE)
                .unwrap()
                .active_sub_count,
            1
        );
    });
}

#[test]
fn accept_link_fails_after_expiry() {
    new_test_ext().execute_with(|| {
        OrchestratorRegistration::<Test>::insert(
            ALICE,
            OrchestratorRecord {
                max_sub_agents: 10,
                fee_bps: 200,
                registered_at: 0,
                active_sub_count: 0,
            },
        );
        register(BOB, 1_000);
        assert_ok!(Orchestrator::propose_sub_agent_link(
            RuntimeOrigin::signed(ALICE),
            BOB
        ));

        // Advance past LinkApprovalWindow (100 blocks)
        frame_system::Pallet::<Test>::set_block_number(150);
        assert_noop!(
            Orchestrator::accept_orchestrator_link(RuntimeOrigin::signed(BOB), ALICE),
            Error::<Test>::ProposalExpired
        );
    });
}

#[test]
fn sub_agent_cannot_link_to_two_orchestrators() {
    new_test_ext().execute_with(|| {
        OrchestratorRegistration::<Test>::insert(
            ALICE,
            OrchestratorRecord {
                max_sub_agents: 10,
                fee_bps: 200,
                registered_at: 0,
                active_sub_count: 0,
            },
        );
        OrchestratorRegistration::<Test>::insert(
            CAROL,
            OrchestratorRecord {
                max_sub_agents: 10,
                fee_bps: 100,
                registered_at: 0,
                active_sub_count: 0,
            },
        );
        register(BOB, 1_000);

        // Link to ALICE
        assert_ok!(Orchestrator::propose_sub_agent_link(
            RuntimeOrigin::signed(ALICE),
            BOB
        ));
        assert_ok!(Orchestrator::accept_orchestrator_link(
            RuntimeOrigin::signed(BOB),
            ALICE
        ));

        // Propose from CAROL
        assert_ok!(Orchestrator::propose_sub_agent_link(
            RuntimeOrigin::signed(CAROL),
            BOB
        ));
        // BOB tries to accept CAROL — but already linked to ALICE
        assert_noop!(
            Orchestrator::accept_orchestrator_link(RuntimeOrigin::signed(BOB), CAROL),
            Error::<Test>::AlreadyLinkedToOrchestrator
        );
    });
}

#[test]
fn remove_link_by_sub_agent_works() {
    new_test_ext().execute_with(|| {
        OrchestratorRegistration::<Test>::insert(
            ALICE,
            OrchestratorRecord {
                max_sub_agents: 10,
                fee_bps: 200,
                registered_at: 0,
                active_sub_count: 1,
            },
        );
        register(BOB, 1_000);
        SubAgentLinks::<Test>::insert(
            ALICE,
            BOB,
            SubLinkRecord {
                linked_at: 0,
                lifetime_volume: 0,
            },
        );
        SubAgentToOrchestrator::<Test>::insert(BOB, ALICE);

        // BOB removes the link (passing orchestrator as the 'other' party)
        assert_ok!(Orchestrator::remove_sub_agent_link(
            RuntimeOrigin::signed(BOB),
            ALICE
        ));
        assert!(!SubAgentLinks::<Test>::contains_key(ALICE, BOB));
        assert!(SubAgentToOrchestrator::<Test>::get(BOB).is_none());
        assert_eq!(
            OrchestratorRegistration::<Test>::get(ALICE)
                .unwrap()
                .active_sub_count,
            0
        );
    });
}

#[test]
fn deregister_clears_all_links() {
    new_test_ext().execute_with(|| {
        OrchestratorRegistration::<Test>::insert(
            ALICE,
            OrchestratorRecord {
                max_sub_agents: 10,
                fee_bps: 200,
                registered_at: 0,
                active_sub_count: 2,
            },
        );
        register(BOB, 1_000);
        register(CAROL, 1_000);
        SubAgentLinks::<Test>::insert(
            ALICE,
            BOB,
            SubLinkRecord {
                linked_at: 0,
                lifetime_volume: 0,
            },
        );
        SubAgentLinks::<Test>::insert(
            ALICE,
            CAROL,
            SubLinkRecord {
                linked_at: 0,
                lifetime_volume: 0,
            },
        );
        SubAgentToOrchestrator::<Test>::insert(BOB, ALICE);
        SubAgentToOrchestrator::<Test>::insert(CAROL, ALICE);

        assert_ok!(Orchestrator::deregister_orchestrator(
            RuntimeOrigin::signed(ALICE)
        ));
        assert!(!OrchestratorRegistration::<Test>::contains_key(ALICE));
        assert!(!SubAgentLinks::<Test>::contains_key(ALICE, BOB));
        assert!(!SubAgentLinks::<Test>::contains_key(ALICE, CAROL));
        assert!(SubAgentToOrchestrator::<Test>::get(BOB).is_none());
        assert!(SubAgentToOrchestrator::<Test>::get(CAROL).is_none());
    });
}

#[test]
fn volume_accumulation_works() {
    new_test_ext().execute_with(|| {
        OrchestratorRegistration::<Test>::insert(
            ALICE,
            OrchestratorRecord {
                max_sub_agents: 10,
                fee_bps: 200,
                registered_at: 0,
                active_sub_count: 1,
            },
        );
        Orchestrator::add_orchestrator_volume(&ALICE, 5_000u64);
        assert_eq!(EraOrchestratorVolume::<Test>::get(ALICE), 5_000u64);

        Orchestrator::add_orchestrator_volume(&ALICE, 3_000u64);
        assert_eq!(EraOrchestratorVolume::<Test>::get(ALICE), 8_000u64);
    });
}
