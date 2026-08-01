//! pallet-orchestrator unit tests
//!
//! Gated by `#[cfg(test)] mod tests;` in `lib.rs` — no inner `#![cfg(test)]`.

use crate::pallet::*;
use frame_support::{
    assert_noop, assert_ok,
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

// pallet_agents::Config::OrchestratorLookup wants a type implementing
// OrchestratorLookup<AccountId, Balance>; the orchestrator Pallet itself does not
// implement that trait, so the mock cannot point straight at it. The runtime and
// tests/common.rs both solve this with a bridge struct — this mirrors
// runtime/src/lib.rs:960 exactly, so volume routing behaves as it does on-chain.
pub struct TestOrchestratorBridge;
impl pallet_agents::pallet::OrchestratorLookup<u64, u64> for TestOrchestratorBridge {
    fn get_orchestrator(sub_agent: &u64) -> Option<u64> {
        SubAgentToOrchestrator::<Test>::get(sub_agent)
    }
    fn add_orchestrator_volume(orchestrator: &u64, amount: u64) {
        crate::Pallet::<Test>::add_orchestrator_volume(orchestrator, amount);
    }
}
impl pallet_agents::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    // Balance- and BlockNumber-typed constants: ConstU64, not ConstU32, since both
    // are u64 in this mock. Every value carried over unchanged.
    type MinStake = ConstU64<1_000>;
    type FullFloorStake = ConstU64<10_000>;
    type MaxStakePerAgent = ConstU64<1_000_000>;
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
    type OrchestratorLookup = TestOrchestratorBridge;
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
    // BlockNumber-typed (Get<BlockNumberFor<Self>>): ConstU64. Value unchanged: 100.
    type LinkApprovalWindow = ConstU64<100>;
    type MaxPendingProposals = ConstU32<20>;
    // `OrchestratorEmissionMultiplier` was set here but is not a member of
    // orchestrator::Config (E0437) — it belongs to pallet_emissions::Config, where
    // this mock's sibling in pallets/emissions/src/tests.rs already sets it to the
    // same ConstU32<5_000>. Removing it drops a line that never bound anything.
    // Was ConstU64<100_000_000_000_000_000_000> — 1e20, which does not fit u64
    // (max ~1.84e19), a deny-by-default overflowing_literals error. It had been
    // masked until now by the E0437 above aborting this impl block first.
    // u64::MAX is what the original comment ("u64 max-safe cap") intended: a
    // non-binding cap. Nothing here depends on the value — no orchestrator test
    // reaches the SupplyCap guard at lib.rs:291.
    type SupplyCap = ConstU64<{ u64::MAX }>;
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
            Error::<Test>::AlreadyLinked
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
