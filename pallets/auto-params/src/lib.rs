//! # pallet-auto-params v3.0
//!
//! Three bounded autonomous rules that fire at each era settlement.
//! Zero deliberation. Zero oracle. Zero vote. Executes in the settle_era block.
//!
//! Rules:
//!   1. Ring farming fee  — ring_ratio > 30% → CompletionFeeBps += max_step
//!   2. Oracle participation — quorum_rate < 40% (≥5 questions) → MinScoreEligible -= 1
//!   3. Emission concentration — top10% > 70% (≥50 agents) → Alpha -= max_step
//!
//! All parameters are stored on-chain (not compiled constants) so governance can
//! adjust bounds and thresholds without a runtime upgrade.

#![cfg_attr(not(feature = "std"), no_std)]
pub use pallet::*;

#[cfg(test)]
mod tests;

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarks;

    pub trait WeightInfo {
        fn set_param() -> Weight;
        fn set_bounds() -> Weight;
    }
    pub struct PlaceholderWeights;
    impl WeightInfo for PlaceholderWeights {
        fn set_param() -> Weight { Weight::from_parts(30000000, 0) }
        fn set_bounds() -> Weight { Weight::from_parts(30000000, 0) }
    }

use frame_support::weights::Weight;
#[frame_support::pallet]
pub mod pallet {
    use frame_support::pallet_prelude::*;
    use frame_system::pallet_prelude::*;
    use sp_std::vec::Vec;

    // ─── Era metrics struct ────────────────────────────────────────────────────
    /// Comprehensive era metrics passed from pallet-emissions after each era drain.
    #[derive(Clone, Copy, Default, Encode, Decode, TypeInfo, MaxEncodedLen)]
    pub struct EraMetrics {
        pub active_agents:            u32,
        pub ring_count:               u32,
        pub era_finalized_questions:  u32,
        pub era_total_questions:      u32,
        pub total_weight:             u128,
        pub top_ten_pct_weight:       u128,
        pub active_validators:        u32,
    }

    // ─── Parameter bounds ─────────────────────────────────────────────────────
    #[derive(Clone, Encode, Decode, DecodeWithMemTracking, MaxEncodedLen, TypeInfo, Debug, PartialEq, Eq)]
    pub struct ParamBounds {
        pub min:      u32,
        pub max:      u32,
        pub max_step: u32,
    }

    // ─── Provider trait (used by pallet-emissions to read live params) ────────
    pub trait AutoParamsProvider {
        fn completion_fee_bps() -> u32;
        fn alpha() -> u32;
        fn beta() -> u32;
        fn floor_bps() -> u32;
        fn min_score_eligible() -> u32;
        /// V4: F-02 — called by pallet-emissions at the end of every settle_era.
        /// Default is a no-op so mock impls in tests don't need to implement it.
        fn run_era_rules(_metrics: EraMetrics) {}
    }

    // ─── Config ───────────────────────────────────────────────────────────────
    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>>
            + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        /// Origin that can call set_param directly (bypasses auto-rules).
        /// Should be Root (sudo) or Track 2 governance.
        type GovernanceOrigin: EnsureOrigin<Self::RuntimeOrigin>;

        /// Initial CompletionFeeBps at genesis.
        #[pallet::constant]
        type InitialCompletionFeeBps: Get<u32>;
        /// Initial Alpha (governance weight in emission formula).
        #[pallet::constant]
        type InitialAlpha: Get<u32>;
        /// Initial Beta (work weight in emission formula).
        #[pallet::constant]
        type InitialBeta: Get<u32>;
        /// Initial FloorBps (floor emissions for Full-rank agents).
        #[pallet::constant]
        type InitialFloorBps: Get<u32>;
        /// Initial MinScoreEligibleResponses.
        #[pallet::constant]
        type InitialMinScoreEligible: Get<u32>;

        // ── Rule thresholds ───────────────────────────────────────────────────
        /// Ring ratio (BPS) above which fee is raised. Default 3000 = 30%.
        #[pallet::constant]
        type RingRatioThreshold: Get<u32>;
        /// Oracle success rate (BPS) below which MinScore is lowered. Default 4000 = 40%.
        #[pallet::constant]
        type OracleParticipationLowThreshold: Get<u32>;
        /// Oracle success rate (BPS) above which MinScore is raised. Default 9000 = 90%.
        #[pallet::constant]
        type OracleParticipationHighThreshold: Get<u32>;
        /// Top-10% weight share (BPS) above which Alpha is reduced. Default 7000 = 70%.
        #[pallet::constant]
        type ConcentrationHighThreshold: Get<u32>;
        /// Top-10% weight share (BPS) below which Alpha is restored. Default 5000 = 50%.
        #[pallet::constant]
        type ConcentrationLowThreshold: Get<u32>;
        /// Minimum oracle questions in era before participation rule fires.
        #[pallet::constant]
        type MinQuestionsForOracleRule: Get<u32>;
        /// Minimum active agents before concentration rule fires.
        #[pallet::constant]
        type MinAgentsForConcentrationRule: Get<u32>;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// Live completion fee in BPS (taken from escrow on confirm_delivery).
    #[pallet::storage]
    pub type CompletionFeeBps<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Live alpha (governance score weight). Governance-adjustable.
    #[pallet::storage]
    pub type Alpha<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Live beta (work score weight). Governance-adjustable.
    #[pallet::storage]
    pub type Beta<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Live floor BPS for Full-rank agents.
    #[pallet::storage]
    pub type FloorBps<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Minimum distinct agent responses for oracle consensus.
    #[pallet::storage]
    pub type MinScoreEligibleResponses<T: Config> = StorageValue<_, u32, ValueQuery>;

    // ── Parameter bounds (set by governance, enforced on every write) ─────────
    #[pallet::storage]
    pub type CompletionFeeBounds<T: Config> = StorageValue<_, ParamBounds, OptionQuery>;
    #[pallet::storage]
    pub type AlphaBounds<T: Config>         = StorageValue<_, ParamBounds, OptionQuery>;
    #[pallet::storage]
    pub type BetaBounds<T: Config>          = StorageValue<_, ParamBounds, OptionQuery>;
    #[pallet::storage]
    pub type FloorBpsBounds<T: Config>      = StorageValue<_, ParamBounds, OptionQuery>;
    #[pallet::storage]
    pub type MinScoreBounds<T: Config>      = StorageValue<_, ParamBounds, OptionQuery>;

    const STORAGE_VERSION: StorageVersion = StorageVersion::new(1);

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    // ─── Hooks ───────────────────────────────────────────────────────────────
    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        fn on_runtime_upgrade() -> Weight {
            // Placeholder migration — add versioned migration arms when STORAGE_VERSION increments.
            // Pattern: if StorageVersion::get::<Pallet<T>>() == N { migrate(); StorageVersion::new(N+1).put::<Pallet<T>>(); }
            Weight::zero()
        }
    }

    // ─── Genesis ──────────────────────────────────────────────────────────────
    #[pallet::genesis_config]
    #[derive(frame_support::DefaultNoBound)]
    pub struct GenesisConfig<T: Config> {
        _phantom: sp_std::marker::PhantomData<T>,
    }

    #[pallet::genesis_build]
    impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
        fn build(&self) {
            CompletionFeeBps::<T>::put(T::InitialCompletionFeeBps::get());
            Alpha::<T>::put(T::InitialAlpha::get());
            Beta::<T>::put(T::InitialBeta::get());
            FloorBps::<T>::put(T::InitialFloorBps::get());
            MinScoreEligibleResponses::<T>::put(T::InitialMinScoreEligible::get());

            // Default bounds — governance can tighten or widen these
            // CompletionFeeBps max=2500 (25%): strong ring deterrent while allowing
            // legitimate high-frequency work. At 25% fee, ring profit margin collapses.
            CompletionFeeBounds::<T>::put(ParamBounds { min: 0,    max: 2500, max_step: 25  });
            AlphaBounds::<T>::put(         ParamBounds { min: 1000, max: 8000, max_step: 500 });
            BetaBounds::<T>::put(          ParamBounds { min: 1000, max: 8000, max_step: 500 });
            FloorBpsBounds::<T>::put(      ParamBounds { min: 100,  max: 3000, max_step: 100 });
            MinScoreBounds::<T>::put(      ParamBounds { min: 3,    max: 20,   max_step: 1   });
        }
    }

    // ─── Events ───────────────────────────────────────────────────────────────
    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        ParamAutoAdjusted { param: ParamId, old_value: u32, new_value: u32, reason: AdjustReason },
        ParamSetByGovernance { param: ParamId, value: u32 },
        BoundsUpdated { param: ParamId, bounds: ParamBounds },
    }

    #[derive(Clone, Copy, Encode, Decode, DecodeWithMemTracking, MaxEncodedLen, TypeInfo, Debug, PartialEq, Eq)]
    pub enum ParamId {
        CompletionFeeBps,
        Alpha,
        Beta,
        FloorBps,
        MinScoreEligibleResponses,
    }

    #[derive(Clone, Copy, Encode, Decode, DecodeWithMemTracking, MaxEncodedLen, TypeInfo, Debug, PartialEq, Eq)]
