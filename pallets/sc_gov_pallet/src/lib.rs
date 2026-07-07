//! # pallet-sc-gov
//!
//! Governance coordination pallet for Scalar Commons.
//!
//! Provides agent-level voting delegation: any account may delegate its governance
//! weight to a trusted delegate.  The delegate accumulates a vote count used by
//! emissions and off-chain tooling to route conviction-voting transactions.
//!
//! ## Storage
//! - `Delegations`       — delegator → current delegate (one-to-one)
//! - `DelegateVoteCount` — delegate  → count of active delegators (reverse index)
//!
//! ## Extrinsics
//! - `delegate_voting`   — set or override delegation; counts vote for new delegate
//! - `remove_delegation` — clear delegation; decrements delegate vote count
#![cfg_attr(not(feature = "std"), no_std)]
pub use pallet::*;

#[cfg(test)]
mod tests;

#[frame_support::pallet]
pub mod pallet {
    use frame_support::pallet_prelude::*;
    use frame_system::pallet_prelude::*;

    // ─── Config ──────────────────────────────────────────────────────────────

    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    /// Active delegation: delegator → delegate.
    /// Governance tooling reads this map to route conviction-voting calls.
    #[pallet::storage]
    pub type Delegations<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, T::AccountId, OptionQuery>;

    /// Reverse index: delegate → count of active delegators.
    /// Emissions reads this to credit governance-participation weight.
    #[pallet::storage]
    pub type DelegateVoteCount<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u32, ValueQuery>;

    // ─── Pallet struct ───────────────────────────────────────────────────────

    const STORAGE_VERSION: StorageVersion = StorageVersion::new(1);

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    // ─── Events ──────────────────────────────────────────────────────────────

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        /// Governance vote delegated. `delegator` weight now counts for `to`.
        VotingDelegated {
            delegator: T::AccountId,
            to: T::AccountId,
        },
        /// Governance delegation removed. `delegate` vote count decremented.
        VotingDelegationRemoved { delegator: T::AccountId },
    }

    // ─── Errors ──────────────────────────────────────────────────────────────

    #[pallet::error]
    pub enum Error<T> {
        /// Delegating to yourself would create a trivial self-loop.
        CannotDelegateToSelf,
    }

    // ─── Extrinsics ──────────────────────────────────────────────────────────

    #[pallet::call]
    impl<T: Config> Pallet<T> {
        /// Delegate governance voting power to `to`.
        ///
        /// Stores the delegation in `Delegations` and increments `DelegateVoteCount`
        /// for `to`.  If a prior delegation exists it is atomically replaced:
        /// the old delegate's count is decremented before the new one is incremented.
        #[pallet::call_index(0)]
        #[pallet::weight(T::DbWeight::get().reads_writes(2, 3)
            .saturating_add(Weight::from_parts(50_000_000, 0)))]
        pub fn delegate_voting(origin: OriginFor<T>, to: T::AccountId) -> DispatchResult {
            let delegator = ensure_signed(origin)?;
            ensure!(delegator != to, Error::<T>::CannotDelegateToSelf);

            // Guards before any storage mutation
            if let Some(prev) = Delegations::<T>::get(&delegator) {
                // Decrement old delegate's count before overwriting
                DelegateVoteCount::<T>::mutate(&prev, |c| *c = c.saturating_sub(1));
            }

            Delegations::<T>::insert(&delegator, &to);
            DelegateVoteCount::<T>::mutate(&to, |c| *c = c.saturating_add(1));

            Self::deposit_event(Event::VotingDelegated { delegator, to });
            Ok(())
        }

        /// Remove governance voting delegation.
        ///
        /// Clears `Delegations[delegator]` and decrements the former delegate's
        /// `DelegateVoteCount`.  No-op if no delegation is active.
        #[pallet::call_index(1)]
        #[pallet::weight(T::DbWeight::get().reads_writes(2, 2)
            .saturating_add(Weight::from_parts(40_000_000, 0)))]
        pub fn remove_delegation(origin: OriginFor<T>) -> DispatchResult {
            let delegator = ensure_signed(origin)?;

            if let Some(prev) = Delegations::<T>::take(&delegator) {
                DelegateVoteCount::<T>::mutate(&prev, |c| *c = c.saturating_sub(1));
                Self::deposit_event(Event::VotingDelegationRemoved { delegator });
            }
            Ok(())
        }
    }

    // ─── Public helpers ──────────────────────────────────────────────────────

    impl<T: Config> Pallet<T> {
        /// Returns the number of active delegators for `who`.
        /// Exposed for cross-pallet reads (e.g. emissions weight calculation).
        pub fn delegation_count(who: &T::AccountId) -> u32 {
            DelegateVoteCount::<T>::get(who)
        }
    }
}
