//! # pallet-oracle v3.0
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
        traits::{Currency, ReservableCurrency},
    };
    use frame_system::pallet_prelude::*;
    use pallet_agents::pallet as agents_pallet;
    use crate::CapabilityChecker;
    use crate::escrow_bridge::DisputeCallback;
    use sp_runtime::traits::Saturating;
    use sp_std::vec::Vec;

    pub type BalanceOf<T> = pallet_agents::pallet::BalanceOf<T>;

    pub trait WeightInfo {
        fn create_oracle_request()  -> Weight;
        fn submit_response()        -> Weight;
        fn finalise_request()       -> Weight;
        fn expire_request()         -> Weight;
        fn batch_submit_response()  -> Weight;
    }
    pub struct PlaceholderWeights;
    impl WeightInfo for PlaceholderWeights {
        fn create_oracle_request()  -> Weight { Weight::from_parts(150000000, 0) }
        fn submit_response()        -> Weight { Weight::from_parts(120000000, 0) }
        fn finalise_request()       -> Weight { Weight::from_parts(500000000, 0) }
        fn expire_request()         -> Weight { Weight::from_parts(80000000, 0) }
        fn batch_submit_response()  -> Weight { Weight::from_parts(70000000, 0) }
    }

    #[derive(Clone, Copy, Encode, Decode, DecodeWithMemTracking, MaxEncodedLen, TypeInfo, Debug, PartialEq, Eq)]
    pub enum ConsensusMode { Factual, Adversarial }

    #[derive(Clone, Copy, Encode, Decode, DecodeWithMemTracking, MaxEncodedLen, TypeInfo, Debug, PartialEq, Eq)]
    pub enum OracleRequestStatus { Open, Collecting, Finalised }

    #[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo)]
    #[scale_info(skip_type_params(T))]
    pub struct OracleRequest<T: Config> {
        pub creator:             T::AccountId,
        pub question_hash:       [u8; 32],
        pub bounty:              BalanceOf<T>,
        pub mode:                ConsensusMode,
        pub min_responses:       u32,
        pub consensus_threshold: u8,
        pub response_deadline:   BlockNumberFor<T>,
        pub challenge_window:    BlockNumberFor<T>,
        pub required_capability: Option<u32>,
        pub status:              OracleRequestStatus,
        pub response_count:      u32,
        pub dispute_context:     Option<DisputeContext<T>>,
    }

    #[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, PartialEq, Eq)]
    #[scale_info(skip_type_params(T))]
    pub struct DisputeContext<T: Config> {
        pub buyer:    T::AccountId,
        pub provider: T::AccountId,
        pub seq:      u32,
    }

    #[pallet::config]
    pub trait Config: frame_system::Config + agents_pallet::Config {
        type RuntimeEvent: From<Event<Self>>
            + IsType<<Self as frame_system::Config>::RuntimeEvent>;
        #[pallet::constant] type MinOracleBounty:        Get<BalanceOf<Self>>;
        #[pallet::constant] type MaxOpenRequests:        Get<u32>;
        #[pallet::constant] type MinChallengeWindow:     Get<BlockNumberFor<Self>>;
        #[pallet::constant] type MinConsensusThreshold:  Get<u8>;
        #[pallet::constant] type MaxResponsesPerRequest: Get<u32>;
        #[pallet::constant] type MaxBatchSubmissions:    Get<u32>;
        type DisputeCallback: crate::escrow_bridge::DisputeCallback<Self::AccountId, BalanceOf<Self>>;
        type CapabilityChecker: crate::CapabilityChecker<Self::AccountId>;
    }

    #[pallet::storage]
    pub type OracleRequests<T: Config> =
        CountedStorageMap<_, Identity, [u8; 32], OracleRequest<T>>;

    #[pallet::storage]
    pub type OracleResponses<T: Config> = StorageDoubleMap<
        _, Identity, [u8; 32], Blake2_128Concat, T::AccountId, [u8; 32], OptionQuery,
    >;

    #[pallet::storage]
    pub type OracleResults<T: Config> =
        StorageMap<_, Identity, [u8; 32], [u8; 32], OptionQuery>;

    #[pallet::storage]
    pub type OracleAccuracy<T: Config> = StorageDoubleMap<
        _, Blake2_128Concat, T::AccountId, Twox64Concat, u32, (u32, u32), ValueQuery,
    >;

    #[pallet::storage]
    pub type OracleScore<T: Config> = StorageDoubleMap<
        _, Blake2_128Concat, T::AccountId, Twox64Concat, u32, u32, ValueQuery,
    >;

    #[pallet::storage]
    pub type EraFinalisedQuestions<T: Config> = StorageValue<_, u32, ValueQuery>;

    #[pallet::storage]
    pub type EraTotalQuestions<T: Config> = StorageValue<_, u32, ValueQuery>;

    #[pallet::storage]
    pub type CapabilityQuestionCount<T: Config> =
        StorageMap<_, Twox64Concat, u32, u32, ValueQuery>;

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
        OracleRequestCreated    { id: [u8; 32], creator: T::AccountId, bounty: BalanceOf<T> },
        OracleResponseSubmitted { id: [u8; 32], agent: T::AccountId },
        OracleRequestFinalised  { id: [u8; 32], winning_hash: [u8; 32], respondents_paid: u32 },
        OracleRequestExpired    { id: [u8; 32] },
        ScoreUpdated            { agent: T::AccountId, capability: u32, new_score: u32 },
        BatchResponseSubmitted  { agent: T::AccountId, accepted: u32, skipped: u32 },
    }

    #[pallet::error]
    pub enum Error<T> {
        NotRegistered, BountyTooLow, MaxOpenRequestsReached,
        InvalidConsensusThreshold, ChallengeTooShort, RequestNotFound,
        RequestAlreadyFinalised, AlreadyResponded, DeadlinePassed,
        RequestExpired, ChallengeWindowActive, InsufficientResponses,
        CapabilityNotRegistered, BatchEmpty, ResponseLimitReached,
        /// A request with this question_hash already exists.
        /// Prevents front-running attacks that overwrite existing requests
        /// and permanently lock the original creator's bounty reserve.
        DuplicateRequest,
    }

    #[pallet::call]
    impl<T: Config> Pallet<T>
    where
        BalanceOf<T>: From<u32>,
    {
        #[pallet::call_index(0)]
        #[pallet::weight(T::DbWeight::get().reads_writes(3, 3)
            .saturating_add(Weight::from_parts(150_000_000, 0)))]
        pub fn create_oracle_request(
            origin:              OriginFor<T>,
            question_hash:       [u8; 32],
            bounty:              BalanceOf<T>,
            mode:                ConsensusMode,
            min_responses:       u32,
            consensus_threshold: u8,
            response_deadline:   BlockNumberFor<T>,
            challenge_window:    BlockNumberFor<T>,
            required_capability: Option<u32>,
        ) -> DispatchResult {
            let creator = ensure_signed(origin)?;
            ensure!(agents_pallet::Pallet::<T>::is_agent(&creator), Error::<T>::NotRegistered);
            ensure!(bounty >= T::MinOracleBounty::get(), Error::<T>::BountyTooLow);
            ensure!(OracleRequests::<T>::count() < T::MaxOpenRequests::get(), Error::<T>::MaxOpenRequestsReached);
            ensure!(consensus_threshold <= 100, Error::<T>::InvalidConsensusThreshold);
            ensure!(consensus_threshold >= T::MinConsensusThreshold::get(), Error::<T>::InvalidConsensusThreshold);
            ensure!(challenge_window >= T::MinChallengeWindow::get(), Error::<T>::ChallengeTooShort);

            ensure!(
                !OracleRequests::<T>::contains_key(question_hash),
                Error::<T>::DuplicateRequest
            );
            <T as agents_pallet::Config>::Currency::reserve(&creator, bounty)?;
            OracleRequests::<T>::insert(question_hash, OracleRequest::<T> {
                creator: creator.clone(), question_hash, bounty, mode,
                min_responses, consensus_threshold, response_deadline, challenge_window,
                required_capability, status: OracleRequestStatus::Open,
                response_count: 0, dispute_context: None,
            });
            EraTotalQuestions::<T>::mutate(|c| *c = c.saturating_add(1));
            Self::deposit_event(Event::OracleRequestCreated { id: question_hash, creator, bounty });
            Ok(())
        }

        #[pallet::call_index(1)]
        #[pallet::weight(T::DbWeight::get().reads_writes(4, 3)
            .saturating_add(Weight::from_parts(80_000_000, 0)))]
        pub fn submit_response(
            origin: OriginFor<T>, request_id: [u8; 32], answer_hash: [u8; 32], capability: u32,
        ) -> DispatchResult {
            let agent = ensure_signed(origin)?;
            ensure!(agents_pallet::Pallet::<T>::is_agent(&agent), Error::<T>::NotRegistered);
            ensure!(OracleResponses::<T>::get(request_id, &agent).is_none(), Error::<T>::AlreadyResponded);

            OracleRequests::<T>::try_mutate(request_id, |maybe_req| -> DispatchResult {
                let req = maybe_req.as_mut().ok_or(Error::<T>::RequestNotFound)?;
                ensure!(
                    req.status == OracleRequestStatus::Open || req.status == OracleRequestStatus::Collecting,
                    Error::<T>::RequestAlreadyFinalised
                );
                let now = frame_system::Pallet::<T>::block_number();
                ensure!(now <= req.response_deadline, Error::<T>::DeadlinePassed);
                ensure!(req.response_count < T::MaxResponsesPerRequest::get(), Error::<T>::ResponseLimitReached);
                if let Some(cap_id) = req.required_capability {
                    ensure!(T::CapabilityChecker::agent_has_capability(&agent, cap_id), Error::<T>::CapabilityNotRegistered);
                    CapabilityQuestionCount::<T>::mutate(cap_id, |c| *c = c.saturating_add(1));
                }
                let _ = capability;
                OracleResponses::<T>::insert(request_id, &agent, answer_hash);
                req.response_count = req.response_count.saturating_add(1);
                req.status = OracleRequestStatus::Collecting;
                Ok(())
            })?;
            Self::deposit_event(Event::OracleResponseSubmitted { id: request_id, agent });
            Ok(())
        }

        #[pallet::call_index(2)]
        #[pallet::weight(T::DbWeight::get().reads_writes(10, 10)
            .saturating_add(Weight::from_parts(500_000_000, 0)))]
        pub fn finalise_request(origin: OriginFor<T>, request_id: [u8; 32]) -> DispatchResult {
            ensure_signed(origin)?;
            let req = OracleRequests::<T>::get(request_id).ok_or(Error::<T>::RequestNotFound)?;
            ensure!(req.status == OracleRequestStatus::Collecting, Error::<T>::InsufficientResponses);
            let now = frame_system::Pallet::<T>::block_number();
            ensure!(now > req.response_deadline.saturating_add(req.challenge_window), Error::<T>::ChallengeWindowActive);
