//! # pallet-orchestrator v3.0
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
    use pallet_agents::pallet as agents_pallet;
    use pallet_agents::AgentCollective;
    use sp_runtime::traits::{UniqueSaturatedInto, Saturating, Zero};

    pub type BalanceOf<T> =
        <<T as agents_pallet::Config>::Currency as Currency<
            <T as frame_system::Config>::AccountId>>::Balance;

    pub const ACC_SCALE: u128 = 1u128 << 64;

    pub trait WeightInfo {
        fn register_orchestrator()   -> Weight;
        fn propose_sub_agent_link()  -> Weight;
        fn accept_orchestrator_link() -> Weight;
        fn remove_sub_agent_link()   -> Weight;
        fn deregister_orchestrator() -> Weight;
        fn claim_orchestrator()      -> Weight;
    }
    pub struct PlaceholderWeights;
    impl WeightInfo for PlaceholderWeights {
        fn register_orchestrator()   -> Weight { Weight::from_parts(80000000, 0) }
        fn propose_sub_agent_link()  -> Weight { Weight::from_parts(60000000, 0) }
        fn accept_orchestrator_link() -> Weight { Weight::from_parts(80000000, 0) }
        fn remove_sub_agent_link()   -> Weight { Weight::from_parts(70000000, 0) }
        fn deregister_orchestrator() -> Weight { Weight::from_parts(150000000, 0) }
        fn claim_orchestrator()      -> Weight { Weight::from_parts(80000000, 0) }
    }

    #[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, PartialEq, Eq)]
    #[scale_info(skip_type_params(T))]
    pub struct OrchestratorRecord<T: Config> {
        pub max_sub_agents:   u32,
        pub fee_bps:          u32,
        pub registered_at:    BlockNumberFor<T>,
        pub active_sub_count: u32,
    }

    #[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, PartialEq, Eq)]
    #[scale_info(skip_type_params(T))]
    pub struct SubLinkRecord<T: Config> {
        pub linked_at:       BlockNumberFor<T>,
        pub lifetime_volume: BalanceOf<T>,
    }

    #[pallet::config]
    pub trait Config: frame_system::Config + agents_pallet::Config {
        type RuntimeEvent: From<Event<Self>>
            + IsType<<Self as frame_system::Config>::RuntimeEvent>;
        #[pallet::constant] type MaxSubAgentsPerOrchestrator: Get<u32>;
        #[pallet::constant] type MaxOrchestratorFeeBps:       Get<u32>;
        #[pallet::constant] type LinkApprovalWindow:          Get<BlockNumberFor<Self>>;
        #[pallet::constant] type MaxPendingProposals:         Get<u32>;
        /// V4: Supply cap — orchestrator claims must not push total_issuance over this.
        /// Matches pallet_emissions::Config::SupplyCap.
        #[pallet::constant] type SupplyCap: Get<BalanceOf<Self>>;
    }

    #[pallet::storage]
    pub type OrchestratorRegistration<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, OrchestratorRecord<T>, OptionQuery>;

    #[pallet::storage]
    pub type SubAgentLinks<T: Config> = StorageDoubleMap<
        _, Blake2_128Concat, T::AccountId, Blake2_128Concat, T::AccountId,
        SubLinkRecord<T>, OptionQuery,
    >;

    #[pallet::storage]
    pub type SubAgentToOrchestrator<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, T::AccountId, OptionQuery>;

    #[pallet::storage]
    pub type PendingLinkProposals<T: Config> = StorageDoubleMap<
        _, Blake2_128Concat, T::AccountId, Blake2_128Concat, T::AccountId,
        BlockNumberFor<T>, OptionQuery,
    >;

    #[pallet::storage]
    pub type EraOrchestratorVolume<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, BalanceOf<T>, ValueQuery>;

    #[pallet::storage]
    pub type OrchestratorRewardDebt<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u128, ValueQuery>;

    #[pallet::storage]
    pub type OrchestratorWeightSnapshot<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u128, ValueQuery>;

    #[pallet::storage]
    pub type OrchestratorGlobalAcc<T: Config> = StorageValue<_, u128, ValueQuery>;

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
        OrchestratorRegistered   { who: T::AccountId, max_sub_agents: u32, fee_bps: u32 },
        LinkProposed             { orchestrator: T::AccountId, sub_agent: T::AccountId, expires_at: BlockNumberFor<T> },
        LinkAccepted             { orchestrator: T::AccountId, sub_agent: T::AccountId },
        LinkRemoved              { orchestrator: T::AccountId, sub_agent: T::AccountId, by: T::AccountId },
        OrchestratorDeregistered { who: T::AccountId, links_cleared: u32 },
        OrchestratorRewardClaimed { orchestrator: T::AccountId, amount: BalanceOf<T> },
    }

    #[pallet::error]
    pub enum Error<T> {
        NotRegistered, AlreadyRegistered, FeeTooHigh,
        AgentMustBeRank2, NotAnAgent, AlreadyLinked,
        NotLinked, SubAgentCapFull, ProposalExpired,
        ProposalNotFound, NotOrchestratorOrSubAgent,
        NothingToClaim,
        /// An orchestrator cannot link itself as its own sub-agent.
        SelfLink,
    }

    #[pallet::call]
    impl<T: Config> Pallet<T>
    where
        BalanceOf<T>: From<u32>,
        u128: TryInto<BalanceOf<T>>,
    {
        #[pallet::call_index(0)]
        #[pallet::weight(T::DbWeight::get().reads_writes(3, 2)
            .saturating_add(Weight::from_parts(80_000_000, 0)))]
        pub fn register_orchestrator(
            origin: OriginFor<T>, max_sub_agents: u32, fee_bps: u32,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(agents_pallet::Pallet::<T>::is_agent(&who), Error::<T>::NotAnAgent);
            ensure!(!OrchestratorRegistration::<T>::contains_key(&who), Error::<T>::AlreadyRegistered);
            ensure!(fee_bps <= T::MaxOrchestratorFeeBps::get(), Error::<T>::FeeTooHigh);

            let rank = <T as agents_pallet::Config>::AgentCollective::rank_of(&who).unwrap_or(0);
            ensure!(rank >= 2u32, Error::<T>::AgentMustBeRank2);

            let now = frame_system::Pallet::<T>::block_number();
            OrchestratorRegistration::<T>::insert(&who, OrchestratorRecord {
                max_sub_agents, fee_bps, registered_at: now, active_sub_count: 0,
            });
            let acc = OrchestratorGlobalAcc::<T>::get();
            OrchestratorRewardDebt::<T>::insert(&who, acc);

            Self::deposit_event(Event::OrchestratorRegistered { who, max_sub_agents, fee_bps });
            Ok(())
        }

        #[pallet::call_index(1)]
        #[pallet::weight(T::DbWeight::get().reads_writes(4, 2)
            .saturating_add(Weight::from_parts(60_000_000, 0)))]
        pub fn propose_sub_agent_link(
            origin: OriginFor<T>, sub_agent: T::AccountId,
        ) -> DispatchResult {
            let orchestrator = ensure_signed(origin)?;
            ensure!(OrchestratorRegistration::<T>::contains_key(&orchestrator), Error::<T>::NotRegistered);
            // An orchestrator cannot link itself as its own sub-agent.
            // Self-linking would let a single account earn both agent emissions
            // and orchestrator emissions from the same escrow volume.
            ensure!(orchestrator != sub_agent, Error::<T>::SelfLink);
            ensure!(agents_pallet::Pallet::<T>::is_agent(&sub_agent), Error::<T>::NotAnAgent);
            ensure!(!SubAgentToOrchestrator::<T>::contains_key(&sub_agent), Error::<T>::AlreadyLinked);

            let record = OrchestratorRegistration::<T>::get(&orchestrator)
                .ok_or(Error::<T>::NotRegistered)?;
            ensure!(record.active_sub_count < record.max_sub_agents, Error::<T>::SubAgentCapFull);

            let now = frame_system::Pallet::<T>::block_number();
            let expires_at = now.saturating_add(T::LinkApprovalWindow::get());
            PendingLinkProposals::<T>::insert(&orchestrator, &sub_agent, expires_at);

            Self::deposit_event(Event::LinkProposed { orchestrator, sub_agent, expires_at });
            Ok(())
        }

        #[pallet::call_index(2)]
        #[pallet::weight(T::DbWeight::get().reads_writes(4, 4)
            .saturating_add(Weight::from_parts(80_000_000, 0)))]
        pub fn accept_orchestrator_link(
            origin: OriginFor<T>, orchestrator: T::AccountId,
        ) -> DispatchResult {
            let sub_agent = ensure_signed(origin)?;
            ensure!(!SubAgentToOrchestrator::<T>::contains_key(&sub_agent), Error::<T>::AlreadyLinked);

            let expires_at = PendingLinkProposals::<T>::get(&orchestrator, &sub_agent)
                .ok_or(Error::<T>::ProposalNotFound)?;
            let now = frame_system::Pallet::<T>::block_number();
            ensure!(now <= expires_at, Error::<T>::ProposalExpired);

            PendingLinkProposals::<T>::remove(&orchestrator, &sub_agent);
            let now2 = frame_system::Pallet::<T>::block_number();
            SubAgentLinks::<T>::insert(&orchestrator, &sub_agent, SubLinkRecord {
                linked_at: now2, lifetime_volume: Zero::zero(),
            });
            SubAgentToOrchestrator::<T>::insert(&sub_agent, orchestrator.clone());
            OrchestratorRegistration::<T>::mutate(&orchestrator, |maybe_rec| {
                if let Some(rec) = maybe_rec { rec.active_sub_count = rec.active_sub_count.saturating_add(1); }
            });

            Self::deposit_event(Event::LinkAccepted { orchestrator, sub_agent });
            Ok(())
        }

        #[pallet::call_index(3)]
        #[pallet::weight(T::DbWeight::get().reads_writes(3, 3)
            .saturating_add(Weight::from_parts(70_000_000, 0)))]
        pub fn remove_sub_agent_link(origin: OriginFor<T>, other: T::AccountId) -> DispatchResult {
            let caller = ensure_signed(origin)?;
            let (orchestrator, sub_agent) = if OrchestratorRegistration::<T>::contains_key(&caller) {
                ensure!(
                    SubAgentToOrchestrator::<T>::get(&other) == Some(caller.clone()),
                    Error::<T>::NotLinked
                );
                (caller.clone(), other.clone())
            } else if let Some(orch) = SubAgentToOrchestrator::<T>::get(&caller) {
                ensure!(orch == other, Error::<T>::NotLinked);
                (other.clone(), caller.clone())
            } else {
                return Err(Error::<T>::NotOrchestratorOrSubAgent.into());
            };

            SubAgentLinks::<T>::remove(&orchestrator, &sub_agent);
            SubAgentToOrchestrator::<T>::remove(&sub_agent);
            OrchestratorRegistration::<T>::mutate(&orchestrator, |maybe_rec| {
                if let Some(rec) = maybe_rec {
                    rec.active_sub_count = rec.active_sub_count.saturating_sub(1);
                }
            });
            Self::deposit_event(Event::LinkRemoved { orchestrator, sub_agent, by: caller });
            Ok(())
        }

        #[pallet::call_index(4)]
        #[pallet::weight(T::DbWeight::get().reads_writes(5, 5)
            .saturating_add(Weight::from_parts(150_000_000, 0)))]
        pub fn deregister_orchestrator(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(OrchestratorRegistration::<T>::contains_key(&who), Error::<T>::NotRegistered);

            let links_cleared = SubAgentLinks::<T>::drain_prefix(&who)
                .map(|(sub_agent, _)| { SubAgentToOrchestrator::<T>::remove(&sub_agent); 1u32 })
                .sum::<u32>();
            let _ = PendingLinkProposals::<T>::clear_prefix(&who, 1000, None);
            OrchestratorRegistration::<T>::remove(&who);

            Self::deposit_event(Event::OrchestratorDeregistered { who, links_cleared });
            Ok(())
        }

        #[pallet::call_index(5)]
        #[pallet::weight(T::DbWeight::get().reads_writes(5, 3)
            .saturating_add(Weight::from_parts(80_000_000, 0)))]
        pub fn claim_orchestrator(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            let acc    = OrchestratorGlobalAcc::<T>::get();
            let debt   = OrchestratorRewardDebt::<T>::get(&who);
            let weight = OrchestratorWeightSnapshot::<T>::get(&who);
            ensure!(acc > debt && weight > 0, Error::<T>::NothingToClaim);

            let delta   = acc.saturating_sub(debt);
            let pending = delta.saturating_mul(weight).checked_div(ACC_SCALE).unwrap_or(0);
            OrchestratorRewardDebt::<T>::insert(&who, acc);
            ensure!(pending > 0, Error::<T>::NothingToClaim);

            // V4: Supply cap gate — orchestrator emissions share the 100B CMN cap.
            let supply_cap: u128 = sp_runtime::traits::UniqueSaturatedInto::<u128>
                ::unique_saturated_into(T::SupplyCap::get());
            let total_issued: u128 = sp_runtime::traits::UniqueSaturatedInto::<u128>
                ::unique_saturated_into(
                    <T as agents_pallet::Config>::Currency::total_issuance()
                );
            let mintable = supply_cap.saturating_sub(total_issued).min(pending);
            ensure!(mintable > 0, Error::<T>::NothingToClaim);

            let amount: BalanceOf<T> = mintable.try_into().unwrap_or_else(|_| Zero::zero());
            if amount.is_zero() { return Err(Error::<T>::NothingToClaim.into()); }

            let _ = <T as agents_pallet::Config>::Currency::deposit_creating(&who, amount);
            Self::deposit_event(Event::OrchestratorRewardClaimed { orchestrator: who, amount });
            Ok(())
        }
    }

    impl<T: Config> Pallet<T>
    where
        BalanceOf<T>: From<u32>,
        u128: TryInto<BalanceOf<T>>,
    {
        pub fn get_orchestrator(sub_agent: &T::AccountId) -> Option<T::AccountId> {
            SubAgentToOrchestrator::<T>::get(sub_agent)
        }

        pub fn add_orchestrator_volume(orchestrator: &T::AccountId, amount: BalanceOf<T>) {
            if OrchestratorRegistration::<T>::contains_key(orchestrator) {
                EraOrchestratorVolume::<T>::mutate(orchestrator, |v| *v = v.saturating_add(amount));
            }
        }

        pub fn compute_era_orchestrator_weights(emission_multiplier: u32) -> (u128, u32) {
            let mut total_weight: u128 = 0;
            let mut count: u32 = 0;

            // Zero ALL orchestrator snapshots before computing new values.
            // The MasterChef pattern: pending = (acc_delta) × latest_snapshot.
            // If an orchestrator had high volume last era and zero this era,
            // their snapshot from last era persists. When OrchestratorGlobalAcc
            // grows this era (from other orchestrators), claim_orchestrator
            // multiplies that delta by the stale high snapshot = overclaim.
            // Zeroing before rewriting ensures only active eras contribute weight.
            let reg_count = OrchestratorRegistration::<T>::iter().count() as u32;
            let clear_bound = reg_count.saturating_add(reg_count / 5).max(10);
            let _ = OrchestratorWeightSnapshot::<T>::clear(clear_bound, None);

            for (orch, vol) in EraOrchestratorVolume::<T>::iter() {
                if vol.is_zero() { continue; }
                let vol_u128: u128 = UniqueSaturatedInto::<u128>::unique_saturated_into(vol);
                let sqrt_vol = pallet_agents::integer_sqrt(vol_u128);
                let orch_weight = sqrt_vol
                    .saturating_mul(emission_multiplier as u128)
                    .checked_div(10_000).unwrap_or(0);
                if orch_weight > 0 {
                    OrchestratorWeightSnapshot::<T>::insert(&orch, orch_weight);
                    total_weight = total_weight.saturating_add(orch_weight);
                    count = count.saturating_add(1);
                }
            }
            (total_weight, count)
        }

        pub fn settle_orchestrator_era(emission: BalanceOf<T>, total_weight: u128) {
            if total_weight > 0 {
                let em_u128: u128 = UniqueSaturatedInto::<u128>::unique_saturated_into(emission);
                if let Some(delta) = em_u128.checked_mul(ACC_SCALE).and_then(|x| x.checked_div(total_weight)) {
                    OrchestratorGlobalAcc::<T>::mutate(|acc| *acc = acc.saturating_add(delta));
                }
            }
            let count = OrchestratorRegistration::<T>::iter().count() as u32;
            let bound = count.saturating_add(count / 5).max(10);
            let _ = EraOrchestratorVolume::<T>::clear(bound, None);
        }
    }
}
