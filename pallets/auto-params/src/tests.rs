//! pallet-auto-params unit tests.
//!
//! `lib.rs` has always declared `#[cfg(test)] mod tests;`, but no backing file ever existed
//! in this repo's history — so `cargo test` failed to resolve the module (E0583) before the
//! workspace test build could even start.
//!
//! The coverage here is still partial and the gap is real: the three era-settlement rules
//! (fee-bps adaptation, alpha/beta weighting, the eligibility floor) are exercised only
//! indirectly, through the emissions mock's `AutoParamsProvider` and the integration suite.
//! What IS covered directly is spec 306's `EmissionVolumeAlphaBps` — the parameter that
//! bounds every era's emission — because D7 makes it sudo/governance-settable and an
//! unbounded or unseeded value there is the difference between "mint at most the work we
//! measured" and either "mint nothing, ever" or "mint anything at all".

use crate::*;
use frame_support::{
    assert_noop, assert_ok, parameter_types,
    traits::{ConstU16, ConstU32, ConstU64, Hooks, StorageVersion},
};
use sp_core::H256;
use sp_runtime::{
    traits::{BlakeTwo256, IdentityLookup},
    BuildStorage,
};

type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
    pub enum Test {
        System:     frame_system,
        AutoParams: crate,
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
    type BlockHashCount = ConstU64<250>;
    type DbWeight = ();
    type Version = ();
    type PalletInfo = PalletInfo;
    type AccountData = ();
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = ConstU16<42>;
    type OnSetCode = ();
    type MaxConsumers = ConstU32<16>;
    type ExtensionsWeightInfo = ();
    type SingleBlockMigrations = ();
    type MultiBlockMigrator = ();
    type PreInherents = ();
    type PostInherents = ();
    type PostTransactions = ();
}

parameter_types! {
    // Mirrors runtime/src/lib.rs so the values under test are the shipped ones.
    pub const InitFeeBps:      u32 = 25;
    pub const InitAlpha:       u32 = 1_500;
    pub const InitBeta:        u32 = 5_000;
    pub const InitFloor:       u32 = 1_000;
    pub const InitMinScore:    u32 = 5;
    pub const InitVolAlphaBps: u32 = 10_000;
}

impl crate::pallet::Config for Test {
    type RuntimeEvent = RuntimeEvent;
    type GovernanceOrigin = frame_system::EnsureRoot<u64>;
    type InitialCompletionFeeBps = InitFeeBps;
    type InitialAlpha = InitAlpha;
    type InitialBeta = InitBeta;
    type InitialFloorBps = InitFloor;
    type InitialMinScoreEligible = InitMinScore;
    type InitialEmissionVolumeAlphaBps = InitVolAlphaBps;
    type RingRatioThreshold = ConstU32<3_000>;
    type OracleParticipationLowThreshold = ConstU32<4_000>;
    type OracleParticipationHighThreshold = ConstU32<9_000>;
    type ConcentrationHighThreshold = ConstU32<7_000>;
    type ConcentrationLowThreshold = ConstU32<5_000>;
    type MinQuestionsForOracleRule = ConstU32<3>;
    type MinAgentsForConcentrationRule = ConstU32<5>;
}

fn new_test_ext() -> sp_io::TestExternalities {
    let mut storage = frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap();
    crate::GenesisConfig::<Test>::default()
        .assimilate_storage(&mut storage)
        .unwrap();
    let mut ext: sp_io::TestExternalities = storage.into();
    // A real chain genesis writes the pallet's STORAGE_VERSION through `on_genesis`, which
    // only runs when genesis is built through the runtime's own RuntimeGenesisConfig.
    // Calling `assimilate_storage` on the pallet's GenesisConfig directly — what a mock
    // does — skips it, leaving the version at 0. Set it here so `new_test_ext` models a
    // freshly launched spec-306 chain; the migration tests override it deliberately.
    ext.execute_with(|| StorageVersion::new(2).put::<Pallet<Test>>());
    ext.commit_all().unwrap();
    ext
}

// ── spec 306: EmissionVolumeAlphaBps ─────────────────────────────────────────

#[test]
fn genesis_seeds_alpha_at_one_times_volume() {
    new_test_ext().execute_with(|| {
        assert_eq!(EmissionVolumeAlphaBps::<Test>::get(), 10_000);
        assert_eq!(
            <Pallet<Test> as AutoParamsProvider>::emission_volume_alpha_bps(),
            10_000,
            "the provider the emissions pallet actually reads must agree with storage"
        );
        let b = EmissionVolumeAlphaBounds::<Test>::get().expect("bounds seeded at genesis");
        assert_eq!((b.min, b.max), (0, 100_000));
    });
}

#[test]
fn governance_can_lower_alpha_to_zero_and_raise_it_back() {
    new_test_ext().execute_with(|| {
        // Zero is a real emission stop that does not pause `settle_era` or `claim`, so no
        // economically essential function comes to depend on a privileged caller
        // (CLAUDE.md first principle #3). It is the lever spec 305 did not have.
        assert_ok!(AutoParams::set_param(
            RuntimeOrigin::root(),
            ParamId::EmissionVolumeAlphaBps,
            0
        ));
        assert_eq!(EmissionVolumeAlphaBps::<Test>::get(), 0);

        assert_ok!(AutoParams::set_param(
            RuntimeOrigin::root(),
            ParamId::EmissionVolumeAlphaBps,
            20_000
        ));
        assert_eq!(EmissionVolumeAlphaBps::<Test>::get(), 20_000);
    });
}

#[test]
fn alpha_cannot_be_set_outside_its_bounds() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            AutoParams::set_param(
                RuntimeOrigin::root(),
                ParamId::EmissionVolumeAlphaBps,
                100_001
            ),
            Error::<Test>::ValueOutOfBounds
        );
        assert_eq!(
            EmissionVolumeAlphaBps::<Test>::get(),
            10_000,
            "a rejected write must leave the live value untouched"
        );
    });
}

#[test]
fn alpha_is_not_settable_by_an_unprivileged_account() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            AutoParams::set_param(
                RuntimeOrigin::signed(1),
                ParamId::EmissionVolumeAlphaBps,
                100_000
            ),
            sp_runtime::DispatchError::BadOrigin
        );
    });
}

#[test]
fn param_id_discriminants_are_stable_wire_format() {
    // ParamId is a call argument, so its SCALE indices are wire format. If this ever fails,
    // a variant was inserted rather than appended and every already-encoded set_param call
    // now points at a different parameter.
    use parity_scale_codec::Encode;
    assert_eq!(ParamId::CompletionFeeBps.encode(), vec![0]);
    assert_eq!(ParamId::Alpha.encode(), vec![1]);
    assert_eq!(ParamId::Beta.encode(), vec![2]);
    assert_eq!(ParamId::FloorBps.encode(), vec![3]);
    assert_eq!(ParamId::MinScoreEligibleResponses.encode(), vec![4]);
    assert_eq!(ParamId::EmissionVolumeAlphaBps.encode(), vec![5]);
}

// ── spec 306: v1 -> v2 migration ─────────────────────────────────────────────

#[test]
fn v2_migration_seeds_alpha_on_a_chain_that_never_ran_genesis() {
    new_test_ext().execute_with(|| {
        // A forkless upgrade does not re-run genesis. Reconstruct the spec-305 shape:
        // storage version 1, and the new ValueQuery item reading its default of 0.
        EmissionVolumeAlphaBps::<Test>::kill();
        EmissionVolumeAlphaBounds::<Test>::kill();
        StorageVersion::new(1).put::<Pallet<Test>>();
        assert_eq!(
            EmissionVolumeAlphaBps::<Test>::get(),
            0,
            "precondition: unseeded alpha reads 0, which would bound every era at 0 x volume"
        );

        let _ = <Pallet<Test> as Hooks<u64>>::on_runtime_upgrade();

        assert_eq!(StorageVersion::get::<Pallet<Test>>(), 2);
        assert_eq!(EmissionVolumeAlphaBps::<Test>::get(), 10_000);
        assert!(EmissionVolumeAlphaBounds::<Test>::get().is_some());
    });
}

#[test]
fn v2_migration_does_not_overwrite_a_governance_choice_on_re_run() {
    new_test_ext().execute_with(|| {
        assert_ok!(AutoParams::set_param(
            RuntimeOrigin::root(),
            ParamId::EmissionVolumeAlphaBps,
            2_500
        ));
        // Already at v2 from genesis, so the hook must be a no-op.
        let _ = <Pallet<Test> as Hooks<u64>>::on_runtime_upgrade();
        assert_eq!(
            EmissionVolumeAlphaBps::<Test>::get(),
            2_500,
            "an upgrade must not silently undo a governance decision"
        );
    });
}
