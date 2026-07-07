//! pallet-oracle unit tests

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
        System:   frame_system,
        Balances: pallet_balances,
        Agents:   pallet_agents,
        Oracle:   crate,
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

parameter_types! {
    pub const MinStakeA:         u64 = 1_000;
    pub const FullFloorStakeA:   u64 = 10_000;
    pub const MaxStakeA:         u64 = 1_000_000;
    pub const UnstakeCooldownA:  u64 = 100;
    pub const BaseFeeA:          u64 = 50;
    pub const MaxRegsA:          u32 = 10;
    pub const MaxAgentsA:        u32 = 100;
}

impl pallet_agents::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type Currency = Balances;
    type MinStake = MinStakeA;
    type FullFloorStake = FullFloorStakeA;
    type MaxStakePerAgent = MaxStakeA;
    type UnstakeCooldown = UnstakeCooldownA;
    type BaseRegistrationFee = BaseFeeA;
    type MaxRegistrationsPerBlock = MaxRegsA;
    type MaxAgents = MaxAgentsA;
    type Rank3MinCompletions = ConstU32<50>;
    type MinRank3OracleScore = ConstU32<1000>;
    type Rank3SpanGate = ConstU32<100>;
    type MaxVolToStakeRatio = ConstU32<10>;
    type HeartbeatGracePeriod = ConstU32<600>;
    type HeartbeatDecayPeriod = ConstU32<14400>;
    type OnAgentRegistered = ();
    type OnAgentSlashed = ();
    type OnStakeChanged = ();
    type AgentCollective = ();
    type OracleScoreGate = Oracle;
    type GovVoteVerifier = (); // wire back
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
    pub const MinOracleBounty:       u64 = 100;
    pub const MaxOpenRequests:       u32 = 50;
    pub const MinChallengeWindow:    u64 = 5;
    pub const MinConsensusThreshold: u8  = 50;
    pub const MaxResponsesPerReq:    u32 = 100;
}

impl super::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type MinOracleBounty = MinOracleBounty;
    type MaxOpenRequests = MaxOpenRequests;
    type MinChallengeWindow = MinChallengeWindow;
    type MinConsensusThreshold = MinConsensusThreshold;
    type MaxResponsesPerRequest = MaxResponsesPerReq;
    type DisputeCallback = ();
    type CapabilityChecker = (); // permissive in tests
    type MaxBatchSubmissions = ConstU32<20>;
    type WeightInfo = ();
}

fn new_test_ext() -> sp_io::TestExternalities {
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
    pallet_balances::GenesisConfig::<Test> {
        balances: vec![(1, 200_000), (2, 200_000), (3, 200_000), (4, 200_000)],
    }
    .assimilate_storage(&mut storage)
    .unwrap();
    storage.into()
}

const ALICE: u64 = 1;
const BOB: u64 = 2;
const CAROL: u64 = 3;
const DAVE: u64 = 4;

fn register(who: u64) {
    assert_ok!(Agents::register(RuntimeOrigin::signed(who), 1_000));
}

fn q_hash() -> [u8; 32] {
    [1u8; 32]
}

#[test]
fn create_request_works() {
    new_test_ext().execute_with(|| {
        register(ALICE);
        assert_ok!(Oracle::create_oracle_request(
            RuntimeOrigin::signed(ALICE),
            q_hash(),
            100,
            ConsensusMode::Factual,
            3,
            67,
            100,
            5,
            None,
        ));
        assert!(OracleRequests::<Test>::contains_key(q_hash()));
    });
}

#[test]
fn create_request_fails_bounty_too_low() {
    new_test_ext().execute_with(|| {
        register(ALICE);
        assert_noop!(
            Oracle::create_oracle_request(
                RuntimeOrigin::signed(ALICE),
                q_hash(),
                50,
                ConsensusMode::Factual,
                3,
                67,
                100,
                5,
                None,
            ),
            Error::<Test>::BountyTooLow
        );
    });
}

#[test]
fn submit_response_updates_status() {
    new_test_ext().execute_with(|| {
        register(ALICE);
        register(BOB);
        assert_ok!(Oracle::create_oracle_request(
            RuntimeOrigin::signed(ALICE),
            q_hash(),
            100,
            ConsensusMode::Factual,
            2,
            67,
            100,
            5,
            None,
        ));
        assert_ok!(Oracle::submit_response(
            RuntimeOrigin::signed(BOB),
            q_hash(),
            [42u8; 32],
            0,
        ));
        let req = OracleRequests::<Test>::get(q_hash()).unwrap();
        assert_eq!(req.status, OracleRequestStatus::Collecting);
        assert_eq!(req.response_count, 1);
    });
}

#[test]
fn cannot_respond_twice() {
    new_test_ext().execute_with(|| {
        register(ALICE);
        register(BOB);
        assert_ok!(Oracle::create_oracle_request(
            RuntimeOrigin::signed(ALICE),
            q_hash(),
            100,
            ConsensusMode::Factual,
            2,
            67,
            100,
            5,
            None,
        ));
        assert_ok!(Oracle::submit_response(
            RuntimeOrigin::signed(BOB),
            q_hash(),
            [1u8; 32],
            0
        ));
        assert_noop!(
            Oracle::submit_response(RuntimeOrigin::signed(BOB), q_hash(), [1u8; 32], 0),
            Error::<Test>::AlreadyResponded
        );
    });
}

#[test]
fn factual_consensus_with_majority() {
    new_test_ext().execute_with(|| {
        register(ALICE);
        register(BOB);
        register(CAROL);
        register(DAVE);
        let winner_hash = [99u8; 32];
        let loser_hash = [77u8; 32];

        // ALICE creates, BOB/CAROL/DAVE respond (2 agree on winner_hash)
        assert_ok!(Oracle::create_oracle_request(
            RuntimeOrigin::signed(ALICE),
            q_hash(),
            300,
            ConsensusMode::Factual,
            3,
            67,
            10,
            5,
            None,
        ));
        assert_ok!(Oracle::submit_response(
            RuntimeOrigin::signed(BOB),
            q_hash(),
            winner_hash,
            0
        ));
        assert_ok!(Oracle::submit_response(
            RuntimeOrigin::signed(CAROL),
            q_hash(),
            winner_hash,
            0
        ));
        assert_ok!(Oracle::submit_response(
            RuntimeOrigin::signed(DAVE),
            q_hash(),
            loser_hash,
            0
        ));

        // Advance past deadline + challenge window
        frame_system::Pallet::<Test>::set_block_number(20);
        assert_ok!(Oracle::finalise_request(
            RuntimeOrigin::signed(ALICE),
            q_hash()
        ));

        // BOB and CAROL should have correct accuracy
        let (correct_b, total_b) = OracleAccuracy::<Test>::get(BOB, 0);
        assert_eq!((correct_b, total_b), (1, 1));
        let (correct_d, total_d) = OracleAccuracy::<Test>::get(DAVE, 0);
        assert_eq!((correct_d, total_d), (0, 1));
        // Scores updated
        assert_eq!(OracleScore::<Test>::get(BOB, 0), 10_000);
        assert_eq!(OracleScore::<Test>::get(DAVE, 0), 0);
    });
}

#[test]
fn expire_request_refunds_creator() {
    new_test_ext().execute_with(|| {
        register(ALICE);
        let balance_before = Balances::free_balance(ALICE);
        assert_ok!(Oracle::create_oracle_request(
            RuntimeOrigin::signed(ALICE),
            q_hash(),
            100,
            ConsensusMode::Factual,
            3,
            67,
            5,
            3,
            None,
        ));
        frame_system::Pallet::<Test>::set_block_number(10);
        assert_ok!(Oracle::expire_request(
            RuntimeOrigin::signed(ALICE),
            q_hash()
        ));
        // Bounty refunded (minus tx fees in real system, ignored in test)
        assert_eq!(Balances::free_balance(ALICE), balance_before);
    });
}

#[test]
fn no_consensus_refunds_creator() {
    new_test_ext().execute_with(|| {
        register(ALICE);
        register(BOB);
        register(CAROL);
        register(DAVE);
        let balance_before = Balances::free_balance(ALICE);

        assert_ok!(Oracle::create_oracle_request(
            RuntimeOrigin::signed(ALICE),
            q_hash(),
            300,
            ConsensusMode::Factual,
            3,
            67,
            10,
            5,
            None,
        ));

        // All 3 respondents give DIFFERENT answers — no 67% consensus possible
        assert_ok!(Oracle::submit_response(
            RuntimeOrigin::signed(BOB),
            q_hash(),
            [10u8; 32],
            0
        ));
        assert_ok!(Oracle::submit_response(
            RuntimeOrigin::signed(CAROL),
            q_hash(),
            [20u8; 32],
            0
        ));
        assert_ok!(Oracle::submit_response(
            RuntimeOrigin::signed(DAVE),
            q_hash(),
            [30u8; 32],
            0
        ));

        frame_system::Pallet::<Test>::set_block_number(20);
        assert_ok!(Oracle::finalise_request(
            RuntimeOrigin::signed(ALICE),
            q_hash()
        ));

        // No result stored (no consensus)
        assert!(OracleResults::<Test>::get(q_hash()).is_none());
        // Creator refunded
        assert_eq!(Balances::free_balance(ALICE), balance_before);
    });
}

#[test]
fn batch_submit_response_accepts_valid_skips_invalid() {
    new_test_ext().execute_with(|| {
        register(ALICE);
        register(BOB);
        register(CAROL);
        register(DAVE);

        // ALICE creates two requests
        let q1 = [1u8; 32];
        let q2 = [2u8; 32];
        assert_ok!(Oracle::create_oracle_request(
            RuntimeOrigin::signed(ALICE),
            q1,
            150,
            ConsensusMode::Factual,
            2,
            67,
            100,
            5,
            None,
        ));
        assert_ok!(Oracle::create_oracle_request(
            RuntimeOrigin::signed(ALICE),
            q2,
            150,
            ConsensusMode::Factual,
            2,
            67,
            100,
            5,
            None,
        ));

        // BOB submits batch: q1 (valid) + q2 (valid) + bogus_id (will be skipped)
        let bogus_id = [99u8; 32];
        let submissions: Vec<([u8; 32], [u8; 32], u32)> = vec![
            (q1, [10u8; 32], 0),
            (q2, [20u8; 32], 0),
            (bogus_id, [30u8; 32], 0), // will be skipped — request not found
        ];
        let bounded: pallet_oracle::pallet::BoundedVec<_, _> = submissions.try_into().unwrap();

        assert_ok!(Oracle::batch_submit_response(
            RuntimeOrigin::signed(BOB),
            bounded
        ));

        // BOB has responded to both valid requests
        assert!(OracleResponses::<Test>::get(q1, BOB).is_some());
        assert!(OracleResponses::<Test>::get(q2, BOB).is_some());
        // Bogus request still doesn't exist
        assert!(!OracleRequests::<Test>::contains_key(bogus_id));
    });
}
