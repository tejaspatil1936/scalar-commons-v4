//! # pallet-emissions v3.0
#![cfg_attr(not(feature = "std"), no_std)]
pub use pallet::*;

#[cfg(test)]
mod tests;

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarks;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::{
        pallet_prelude::*,
        traits::Currency,
    };
    use frame_system::pallet_prelude::*;
    use pallet_agents::pallet::{self as agents_pallet, integer_sqrt};
    use pallet_agents::AgentCollective;
    use pallet_auto_params::pallet::AutoParamsProvider;
    use sp_runtime::traits::{UniqueSaturatedInto, Saturating, Zero};
    use sp_std::vec::Vec;

    pub trait WeightInfo {
        fn settle_era()                -> Weight;
        fn claim()                     -> Weight;
        fn batch_claim()               -> Weight;
        fn set_era_emission_override() -> Weight;
    }
    pub struct PlaceholderWeights;
    impl WeightInfo for PlaceholderWeights {
        fn settle_era()                -> Weight { Weight::from_parts(1000000000, 0) }
        fn claim()                     -> Weight { Weight::from_parts(90000000, 0) }
        fn batch_claim()               -> Weight { Weight::from_parts(90000000, 0) }
        fn set_era_emission_override() -> Weight { Weight::from_parts(30000000, 0) }
    }

    pub const ACC_SCALE:   u128 = 1u128 << 64;
    pub const BPS_SCALE:   u128 = 10_000;
    pub const SCORE_SCALE: u128 = 10_000;

    pub type BalanceOf<T> =
        <<T as Config>::Currency as Currency<<T as frame_system::Config>::AccountId>>::Balance;

    pub trait OracleScoreProvider<AccountId> {
        fn best_score(who: &AccountId) -> u32;
    }
    impl<AccountId> OracleScoreProvider<AccountId> for () {
        fn best_score(_: &AccountId) -> u32 { 0 }
    }

    pub trait ValidatorCountProvider {
        fn active_validator_count() -> u32;
    }
    impl ValidatorCountProvider for () {
        fn active_validator_count() -> u32 { 0 }
    }

    pub trait OracleCounters {
        fn drain_era_counters() -> (u32, u32);
    }
    impl OracleCounters for () {
        fn drain_era_counters() -> (u32, u32) { (0, 0) }
    }

    pub trait OrchestratorEmissions<Balance: Copy> {
        fn compute_weights(multiplier: u32) -> (u128, u32);
        fn settle(orch_emission: Balance, orch_weight: u128);
    }
    impl<Balance: Copy + Default> OrchestratorEmissions<Balance> for () {
        fn compute_weights(_: u32) -> (u128, u32) { (0, 0) }
        fn settle(_: Balance, _: u128) {}
    }

    #[pallet::config]
    pub trait Config:
        frame_system::Config
        + agents_pallet::Config
    {
        type RuntimeEvent: From<Event<Self>>
            + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        type Currency: Currency<Self::AccountId>;

        #[pallet::constant] type SupplyCap:                    Get<BalanceOf<Self>>;
        #[pallet::constant] type InitialEmissionsPerEra:       Get<BalanceOf<Self>>;
        #[pallet::constant] type TargetEmissionPerAgent:       Get<BalanceOf<Self>>;
        #[pallet::constant] type FloorEmissionPerEra:          Get<BalanceOf<Self>>;
        #[pallet::constant] type EraDuration:                  Get<BlockNumberFor<Self>>;
        #[pallet::constant] type MaxBatchClaimSize:            Get<u32>;
        #[pallet::constant] type OracleBonusBps:               Get<u32>;
        #[pallet::constant] type MaxProposalsPerEra:           Get<u32>;
        #[pallet::constant] type UnitVolume:                   Get<BalanceOf<Self>>;
        /// Minimum era escrow volume required to qualify for the floor emission.
        /// Agents below this threshold earn zero — not even floor weight.
        /// Set >= UnitVolume to ensure any ring deal is also large enough to qualify.
        /// Governance can raise this to increase the cost of sybil floor farming.
        /// At launch: set to 5 × UnitVolume (5,000 CMN) to require meaningful work.
        #[pallet::constant] type MinQualifyingVol:             Get<BalanceOf<Self>>;
        /// Maximum additional weight an agent earns by deploying their full staked
        /// capital in escrow. At VelocityBonusBps=3000 an agent cycling their entire
        /// stake through escrow each era earns +30% weight vs an idle agent with the
        /// same stake. Velocity = era_vol / stake, scaled against MaxVolToStakeRatio.
        /// Set to 0 to disable the velocity bonus entirely.
        #[pallet::constant] type VelocityBonusBps:            Get<u32>;
        // V4: GenesisAgentBonusBps and GenesisAgentBonusEras removed.
        // Replaced by per-agent onboarding_boost (10,000 bps for first 10 completions).
        #[pallet::constant] type MaxEmissionOverrideEras:      Get<u32>;
        #[pallet::constant] type OrchestratorEmissionMultiplier: Get<u32>;

        type AutoParams: AutoParamsProvider;
        type OracleScoreProvider:    OracleScoreProvider<Self::AccountId>;
        type OracleCounters:         OracleCounters;
        type ValidatorCountProvider: ValidatorCountProvider;
        type OrchestratorEmissions:  OrchestratorEmissions<BalanceOf<Self>>;
    }

    #[pallet::storage]
    pub type AccRewardPerStake<T: Config> = StorageValue<_, u128, ValueQuery>;

    #[pallet::storage]
    pub type AgentRewardDebt<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u128, ValueQuery>;

    #[pallet::storage]
    pub type AgentWeightSnapshot<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u128, ValueQuery>;

    #[pallet::storage]
    pub type LastEraEmission<T: Config> = StorageValue<_, BalanceOf<T>, ValueQuery>;

    #[pallet::storage]
    pub type EmissionOverrides<T: Config> =
        StorageMap<_, Twox64Concat, u32, BalanceOf<T>, OptionQuery>;

    /// V4: F-04 — tracks the last settled era to prevent double-mint.
    /// settle_era guards against being called twice in the same era.
    #[pallet::storage]
    pub type LastSettledEra<T: Config> = StorageValue<_, u32, OptionQuery>;

    /// Block number at which the current era started.
    /// Initialized at genesis (block 0) and updated each time drain_era_maps fires.
    /// Used by settle_era to prevent premature settlement: callers must wait
    /// at least EraDuration blocks after the era started before settling.
    #[pallet::storage]
    pub type EraStartBlock<T: Config> = StorageValue<_, BlockNumberFor<T>, ValueQuery>;

    const STORAGE_VERSION: StorageVersion = StorageVersion::new(1);
    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        fn on_runtime_upgrade() -> Weight { Weight::zero() }
    }

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        EraSettled          { era: u32, total_emission: BalanceOf<T>, total_weight: u128 },
        NextEraScheduled    { block: BlockNumberFor<T>, scheduled: bool },
        EmissionOverrideSet { era: u32, amount: BalanceOf<T> },
        RewardClaimed       { agent: T::AccountId, amount: BalanceOf<T> },
        CapReached          { agent: T::AccountId },
    }

    #[pallet::error]
    pub enum Error<T> {
        NotRegistered, NothingToClaim, ArithmeticOverflow,
        OverrideTooFarInFuture, OverrideAmountExceedsCap,
        /// V4: F-04 — settle_era already called for this era. Prevents double-mint.
        EraAlreadySettled,
        /// Era duration has not yet elapsed since the last settlement.
        /// Any signed account can call settle_era, but only after EraDuration blocks.
        EraNotDue,
    }

    #[pallet::call]
    impl<T: Config> Pallet<T>
    where
        BalanceOf<T>: From<u32>,
        u128: TryInto<BalanceOf<T>>,
    {
        #[pallet::call_index(0)]
        #[pallet::weight(T::DbWeight::get().reads_writes(5, 5)
            .saturating_add(Weight::from_parts(1_000_000_000, 0)))]
        pub fn settle_era(origin: OriginFor<T>) -> DispatchResult {
            // Permissionless: any registered agent (or anyone) can trigger settlement.
            // Economic incentive: all agents benefit from settlement — they are motivated
            // to call this. The double-settlement guard prevents abuse.
            ensure_signed(origin)?;

            let era = agents_pallet::EraNumber::<T>::get();
            let now = frame_system::Pallet::<T>::block_number();

            // Era timing gate: must wait at least EraDuration blocks since era started.
            // This prevents premature settlement within the same era.
            let era_start = EraStartBlock::<T>::get();
            ensure!(
                now >= era_start.saturating_add(T::EraDuration::get()),
                Error::<T>::EraNotDue
            );

            // V4: F-04 — double-settlement guard. Prevents double-mint in same era.
            ensure!(
                LastSettledEra::<T>::get().map_or(true, |last| era > last),
                Error::<T>::EraAlreadySettled
            );
            LastSettledEra::<T>::put(era);
            // Record the block this era settled as the start of the NEXT era.
            EraStartBlock::<T>::put(now);

            let agent_count = agents_pallet::AgentStake::<T>::count() as u128;
            let emission: BalanceOf<T> = if let Some(override_amount) = EmissionOverrides::<T>::take(era) {
                override_amount
            } else {
                let target:  u128 = UniqueSaturatedInto::<u128>::unique_saturated_into(T::TargetEmissionPerAgent::get());
                let floor:   u128 = UniqueSaturatedInto::<u128>::unique_saturated_into(T::FloorEmissionPerEra::get());
                let ceiling: u128 = UniqueSaturatedInto::<u128>::unique_saturated_into(T::InitialEmissionsPerEra::get());
                let scaled = target.saturating_mul(agent_count).max(floor).min(ceiling);
                scaled.try_into().unwrap_or(T::FloorEmissionPerEra::get())
            };

            let (era_finalized_q, era_total_q) = T::OracleCounters::drain_era_counters();

            let cached_alpha            = T::AutoParams::alpha()     as u128;
            let cached_beta             = T::AutoParams::beta()      as u128;
            let cached_floor            = T::AutoParams::floor_bps() as u128;
            let cached_oracle_bonus_bps = T::OracleBonusBps::get()  as u128;
            let cached_unit_vol: u128   = UniqueSaturatedInto::<u128>::unique_saturated_into(T::UnitVolume::get());
            let cached_max_props        = (T::MaxProposalsPerEra::get() as u128).max(1);
            let cached_velocity_bps     = T::VelocityBonusBps::get() as u128;
            // V4: Remove genesis cliff. Replace with per-agent onboarding_boost read inside loop.
            // Each agent gets 10,000 bps bonus for their first 10 completions, regardless of era.
            let current_era             = agents_pallet::EraNumber::<T>::get();
            let _ = current_era; // retained for potential future era-aware logic

            let mut total_weight:   u128 = 0;
            let mut top_weight_sum: u128 = 0;
            let mut all_weights: Vec<u128> = sp_std::vec![];

            for (agent, stake) in agents_pallet::AgentStake::<T>::iter() {
                let stake_u128 = UniqueSaturatedInto::<u128>::unique_saturated_into(stake);
                // V4: onboarding_boost — 10,000 bps bonus for first 10 completions (any era).
                // Linearly decays: completion 1 = 10,000 bps, completion 10 = 1,000 bps, after = 0.
                // Completions read once here and passed into compute_weight_cached to avoid
                // a second storage read for the activity-gate check inside the function.
                let completions = agents_pallet::CompletedAgreements::<T>::get(&agent);
                let onboarding_boost: u128 = if completions < 10 {
                    10_000u128.saturating_sub(completions as u128 * 1_000u128)
                } else {
                    0u128
                };
                let w = Self::compute_weight_cached(
                    &agent, stake_u128,
                    cached_alpha, cached_beta, cached_floor,
                    cached_oracle_bonus_bps, cached_unit_vol, cached_max_props,
                    onboarding_boost,
                    cached_velocity_bps,
                );
                if w > 0 {
                    AgentWeightSnapshot::<T>::insert(&agent, w);
                    total_weight = total_weight.saturating_add(w);
                    all_weights.push(w);
                }
            }

            if !all_weights.is_empty() {
                all_weights.sort_unstable_by(|a, b| b.cmp(a));
                let top_n = (all_weights.len() / 10).max(1);
                top_weight_sum = all_weights.iter().take(top_n).sum();
            }

            // Drain era maps AFTER weight computation but before next era
            agents_pallet::Pallet::<T>::drain_era_maps(era);
