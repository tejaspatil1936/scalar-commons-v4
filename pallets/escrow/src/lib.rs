//! # pallet-escrow v3.0
#![cfg_attr(not(feature = "std"), no_std)]
pub use pallet::*;

#[cfg(test)]
mod tests;

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarks;

pub trait DisputeOracle<AccountId, Balance, BlockNumber> {
    fn post_dispute_question(
        buyer: &AccountId, provider: &AccountId,
        seq: u32, bounty: Balance, deadline: BlockNumber, capability_id: Option<u32>,
    ) -> Result<[u8; 32], frame_support::pallet_prelude::DispatchError>;
}
impl<AccountId, Balance, BlockNumber> DisputeOracle<AccountId, Balance, BlockNumber> for () {
    fn post_dispute_question(
        _: &AccountId, _: &AccountId, _: u32, _: Balance, _: BlockNumber, _: Option<u32>,
    ) -> Result<[u8; 32], frame_support::pallet_prelude::DispatchError> { Ok([0u8; 32]) }
}

pub trait DisputeCallback<AccountId, Balance> {
    fn on_dispute_resolved(
        buyer: &AccountId, provider: &AccountId, seq: u32, provider_wins: bool,
    ) -> frame_support::pallet_prelude::DispatchResult;
}
impl<AccountId, Balance> DisputeCallback<AccountId, Balance> for () {
    fn on_dispute_resolved(_: &AccountId, _: &AccountId, _: u32, _: bool)
        -> frame_support::pallet_prelude::DispatchResult { Ok(()) }
}

pub mod dispute_hashes {
    pub const PROVIDER_WINS_PREIMAGE: &[u8] = b"scalar:dispute:provider_wins";
    pub const BUYER_WINS_PREIMAGE:    &[u8] = b"scalar:dispute:buyer_wins";
}

#[frame_support::pallet]
pub mod pallet {
    use frame_support::{
        pallet_prelude::*,
        traits::{Currency, ReservableCurrency, OnUnbalanced, Imbalance},
    };
    use frame_system::pallet_prelude::*;
    use pallet_agents::pallet as agents_pallet;
    use crate::DisputeOracle;
    use sp_runtime::traits::{Saturating, Zero};

    /// Use agents' currency balance type to avoid cross-pallet type mismatches.
    pub type BalanceOf<T> = pallet_agents::pallet::BalanceOf<T>;

    pub trait WeightInfo {
        fn create_agreement() -> Weight;
        fn record_delivery()  -> Weight;
        fn confirm_delivery() -> Weight;
        fn dispute_delivery() -> Weight;
        fn claim_refund()     -> Weight;
        fn extend_deadline()  -> Weight;
    }
    pub struct PlaceholderWeights;
    impl WeightInfo for PlaceholderWeights {
        fn create_agreement() -> Weight { Weight::from_parts(150000000, 0) }
        fn record_delivery()  -> Weight { Weight::from_parts(100000000, 0) }
        fn confirm_delivery() -> Weight { Weight::from_parts(220000000, 0) }
        fn dispute_delivery() -> Weight { Weight::from_parts(300000000, 0) }
        fn claim_refund()     -> Weight { Weight::from_parts(80000000, 0) }
        fn extend_deadline()  -> Weight { Weight::from_parts(60000000, 0) }
    }

    #[derive(Clone, Copy, Encode, Decode, MaxEncodedLen, TypeInfo, Debug, PartialEq, Eq)]
    pub enum AgreementStatus { Created, Delivered, Disputed }

    #[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, PartialEq, Eq)]
    #[scale_info(skip_type_params(T))]
    pub struct Agreement<T: Config> {
        pub amount:             BalanceOf<T>,
        pub deliverable_hash:   [u8; 32],
        pub deliver_by:         BlockNumberFor<T>,
        pub created_at:         BlockNumberFor<T>,
        pub status:             AgreementStatus,
        pub delivery_proof:     Option<[u8; 32]>,
        pub seq:                u32,
        pub capability_id:      Option<u32>,
        pub dispute_opened_at:  Option<BlockNumberFor<T>>,
        pub dispute_request_id: Option<[u8; 32]>,
    }

    #[pallet::config]
    pub trait Config: frame_system::Config + agents_pallet::Config {
        type RuntimeEvent: From<Event<Self>>
            + IsType<<Self as frame_system::Config>::RuntimeEvent>;
        #[pallet::constant] type MaxAgreementsPerPair:  Get<u32>;
        #[pallet::constant] type MaxAgreementSpan:      Get<BlockNumberFor<Self>>;
        #[pallet::constant] type MinAgreementAmount:    Get<BalanceOf<Self>>;
        #[pallet::constant] type MinDeliveryBlocks:     Get<BlockNumberFor<Self>>;
        #[pallet::constant] type BuyerResponseWindow:   Get<BlockNumberFor<Self>>;
        #[pallet::constant] type DisputeTimeoutWindow:  Get<BlockNumberFor<Self>>;
        #[pallet::constant] type DisputeResponseWindow: Get<BlockNumberFor<Self>>;
        #[pallet::constant] type DisputeBountyBps:      Get<u32>;
        #[pallet::constant] type MinDisputeBounty:      Get<BalanceOf<Self>>;
        #[pallet::constant] type DisputeBurnBps:        Get<u32>;
        type DisputeOracle: crate::DisputeOracle<Self::AccountId, BalanceOf<Self>, BlockNumberFor<Self>>;
        type DisputeCallback: crate::DisputeCallback<Self::AccountId, BalanceOf<Self>>;
        type CompletionFeeProvider: Get<u32>;
        /// V4: Receives the completion fee (25 bps of agreement value) each settlement.
        /// Set to Treasury in the runtime so fees fund governance proposals.
        /// () burns the fee (acceptable for tests, wrong for production).
        type FeeDestination: OnUnbalanced<
            <<Self as agents_pallet::Config>::Currency
             as frame_support::traits::Currency<Self::AccountId>>::NegativeImbalance
        >;
    }

    #[pallet::storage]
    pub type Agreements<T: Config> = StorageDoubleMap<
        _, Blake2_128Concat, T::AccountId, Blake2_128Concat, T::AccountId,
        BoundedVec<Agreement<T>, T::MaxAgreementsPerPair>, ValueQuery,
    >;

    #[pallet::storage]
    pub type NextSeq<T: Config> = StorageDoubleMap<
        _, Blake2_128Concat, T::AccountId, Blake2_128Concat, T::AccountId,
        u32, ValueQuery,
    >;

    #[pallet::storage]
    pub type DisputeToAgreement<T: Config> = StorageMap<
        _, Identity, [u8; 32], (T::AccountId, T::AccountId, u32), OptionQuery,
    >;

    #[pallet::storage]
    pub type ActiveAgreementCount<T: Config> = StorageValue<_, u32, ValueQuery>;

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
        AgreementCreated  { buyer: T::AccountId, provider: T::AccountId, seq: u32, amount: BalanceOf<T> },
        DeliveryRecorded  { provider: T::AccountId, buyer: T::AccountId, seq: u32, proof: [u8; 32] },
        DeliveryConfirmed { buyer: T::AccountId, provider: T::AccountId, seq: u32, amount: BalanceOf<T> },
        DisputeOpened     { buyer: T::AccountId, provider: T::AccountId, seq: u32, request_id: [u8; 32] },
        DisputeResolved   { buyer: T::AccountId, provider: T::AccountId, seq: u32, provider_wins: bool },
        RefundClaimed     { buyer: T::AccountId, provider: T::AccountId, seq: u32, amount: BalanceOf<T> },
        DeadlineExtended  { buyer: T::AccountId, provider: T::AccountId, seq: u32,
                            old_deadline: BlockNumberFor<T>, new_deadline: BlockNumberFor<T> },
    }

    #[pallet::error]
    pub enum Error<T> {
        SelfDeal, BuyerNotAgent, ProviderNotAgent, AmountTooLow,
        BilateralCapReached, SeqOverflow, AgreementNotFound, WrongStatus,
        DeadlinePassed, DeadlineTooEarly, DisputeTimeoutNotElapsed,
        MinDeliveryBlocksNotElapsed, NewDeadlineMustBeLater, DeadlineWouldExceedMaxSpan,
    }

    #[pallet::call]
    impl<T: Config> Pallet<T>
    where
        BalanceOf<T>: From<u32>,
        <T as agents_pallet::Config>::Currency: ReservableCurrency<T::AccountId>,
    {
        #[pallet::call_index(0)]
        #[pallet::weight(T::DbWeight::get().reads_writes(6, 5)
            .saturating_add(Weight::from_parts(150_000_000, 0)))]
        pub fn create_agreement(
            origin:           OriginFor<T>,
            provider:         T::AccountId,
            #[pallet::compact] amount: BalanceOf<T>,
            deliverable_hash: [u8; 32],
            deliver_by:       BlockNumberFor<T>,
            capability_id:    Option<u32>,
        ) -> DispatchResult {
            let buyer = ensure_signed(origin)?;
            ensure!(buyer != provider,                              Error::<T>::SelfDeal);
            ensure!(agents_pallet::Pallet::<T>::is_agent(&buyer),  Error::<T>::BuyerNotAgent);
            ensure!(agents_pallet::Pallet::<T>::is_agent(&provider), Error::<T>::ProviderNotAgent);
            ensure!(amount >= T::MinAgreementAmount::get(),         Error::<T>::AmountTooLow);

            let now = frame_system::Pallet::<T>::block_number();
            ensure!(deliver_by > now.saturating_add(T::MinDeliveryBlocks::get()), Error::<T>::DeadlineTooEarly);
            let clamped = deliver_by.min(now.saturating_add(T::MaxAgreementSpan::get()));

            let seq = NextSeq::<T>::try_mutate(&buyer, &provider, |s| -> Result<u32, DispatchError> {
                let cur = *s;
                *s = s.checked_add(1).ok_or(Error::<T>::SeqOverflow)?;
                Ok(cur)
            })?;

            let agreement = Agreement::<T> {
                amount, deliverable_hash, deliver_by: clamped, created_at: now,
                status: AgreementStatus::Created, delivery_proof: None, seq, capability_id,
                dispute_opened_at: None, dispute_request_id: None,
            };
            Agreements::<T>::try_mutate(&buyer, &provider, |vec| {
                vec.try_push(agreement).map_err(|_| Error::<T>::BilateralCapReached)
