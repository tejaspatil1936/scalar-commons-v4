//! # pallet-agents v3.0
//!
//! ## Responsibilities (Milestone 1 scope)
//! - Agent registration: stake locking, fee burn, rate limiting
//! - Work volume tracking: per-era escrow volume + buyer diversity (anti-ring)
//! - Era snapshots: ring_count + active_count before drain (fed to auto-params)
//! - Rank promotion triggers: calls into pallet-ranked-collective
//! - Cross-pallet hooks: OnAgentRegistered, ActiveEscrowCount management
//!
//! ## NOT in this pallet (handled by standard pallets)
//! - Tiers/ranks   → pallet-ranked-collective
//! - Governance    → pallet-referenda + pallet-conviction-voting
//! - Floor pay     → pallet-salary (per rank)
//! - Heartbeat     → pallet-im-online + LastHeartbeat in this pallet
//! - Succession    → v3.1 feature (ink! contract)

#![cfg_attr(not(feature = "std"), no_std)]
pub use pallet::*;

#[cfg(test)]
mod tests;

#[cfg(feature = "runtime-benchmarks")]
pub mod benchmarks;


    /// Weight functions needed by pallet-agents.
    /// Replaced by benchmarked weights from pallets/agents/src/weights.rs before mainnet.
    pub trait WeightInfo {
        fn register() -> Weight;
        fn add_stake() -> Weight;
        fn request_unstake() -> Weight;
        fn complete_unstake() -> Weight;
        fn heartbeat() -> Weight;
        fn record_gov_vote() -> Weight;
        fn update_metadata() -> Weight;
        fn set_capability() -> Weight;
        fn delegate_voting() -> Weight;
    }
    /// Placeholder weights returning zero — replaced by benchmark output before mainnet.
    pub struct PlaceholderWeights;
    impl WeightInfo for PlaceholderWeights {
        fn register()         -> Weight { Weight::from_parts(200_000_000, 0) }
        fn add_stake()        -> Weight { Weight::from_parts(80_000_000, 0) }
        fn request_unstake()  -> Weight { Weight::from_parts(60_000_000, 0) }
        fn complete_unstake() -> Weight { Weight::from_parts(90_000_000, 0) }
        fn heartbeat()        -> Weight { Weight::from_parts(40_000_000, 0) }
        fn record_gov_vote()  -> Weight { Weight::from_parts(35_000_000, 0) }
        fn update_metadata()  -> Weight { Weight::from_parts(50_000_000, 0) }
        fn set_capability()   -> Weight { Weight::from_parts(60_000_000, 0) }
        fn delegate_voting()  -> Weight { Weight::from_parts(40_000_000, 0) }
    }

use frame_support::weights::Weight;
#[frame_support::pallet]
pub mod pallet {
    use frame_support::{
        pallet_prelude::*,
        traits::{Currency, LockIdentifier, LockableCurrency, WithdrawReasons,
                 ExistenceRequirement, ReservableCurrency, OnUnbalanced, Imbalance},
    };
    use frame_system::pallet_prelude::*;
    use sp_runtime::traits::{Saturating, Zero};
    use sp_std::vec::Vec;

    // ─── Lock identifier ─────────────────────────────────────────────────────
    pub const AGENT_LOCK_ID: LockIdentifier = *b"agntlock";

    // ─── Balance type alias ──────────────────────────────────────────────────
    pub type BalanceOf<T> =
        <<T as Config>::Currency as Currency<<T as frame_system::Config>::AccountId>>::Balance;

    // ─── Cross-pallet hook traits ────────────────────────────────────────────

    /// Called by emissions pallet to initialise reward debt when a new agent registers.
    /// Without this, a new agent could claim all prior-era emissions immediately.
    pub trait OnAgentRegistered<AccountId> {
        fn on_registered(who: &AccountId);
    }
    impl<AccountId> OnAgentRegistered<AccountId> for () {
        fn on_registered(_: &AccountId) {}
    }

    /// Called by agents pallet execute_slash after funds are withdrawn.
    /// Emissions implements this to zero AgentWeightSnapshot, preventing one-era overclaim
    /// where the old (pre-slash) weight snapshot would be used in do_claim().
    pub trait OnAgentSlashed<AccountId> {
        fn on_slashed(who: &AccountId);
    }
    impl<AccountId> OnAgentSlashed<AccountId> for () {
        fn on_slashed(_: &AccountId) {}
    }

    /// Called by agents pallet BEFORE stake changes (add_stake).
    /// Emissions implements this to zero AgentWeightSnapshot so the agent
    /// cannot overclaim prior-era emissions using their new higher weight.
    ///
    /// The MasterChef accumulator pattern assumes weight is constant between
    /// settlements. When stake increases between eras, the pending amount
    /// would be multiplied by the new weight, overclaiming prior-era rewards.
    /// Zeroing the snapshot on stake change means the agent forfeits unclaimed
    /// rewards from the previous era — a conservative (under-pays) choice that
    /// closes the exploit.
    pub trait OnStakeChanged<AccountId> {
        fn on_stake_changed(who: &AccountId);
    }
    impl<AccountId> OnStakeChanged<AccountId> for () {
        fn on_stake_changed(_: &AccountId) {}
    }

    /// Called by agents pallet to promote/query agent rank in ranked-collective.
    pub trait AgentCollective<AccountId> {
        fn induct(who: &AccountId) -> DispatchResult;
        fn promote(who: &AccountId) -> DispatchResult;
        fn rank_of(who: &AccountId) -> Option<u32>;
        /// Remove agent from collective on deregistration. No-op if not a member.
        fn remove(who: &AccountId);
    }
    impl<AccountId> AgentCollective<AccountId> for () {
        fn induct(_: &AccountId) -> DispatchResult { Ok(()) }
        fn promote(_: &AccountId) -> DispatchResult { Ok(()) }
        fn rank_of(_: &AccountId) -> Option<u32> { Some(0) }
        fn remove(_: &AccountId) {}
    }

    /// Oracle score provider — lets emissions read oracle accuracy without circular dep.
    pub trait OracleScoreGate<AccountId> {
        /// Returns 0–10,000. 0 means no oracle history.
        fn best_score(who: &AccountId) -> u32;
    }
    impl<AccountId> OracleScoreGate<AccountId> for () {
        fn best_score(_: &AccountId) -> u32 { 0 }
    }

    /// Cross-pallet: verifies that an agent is CURRENTLY casting a vote in
    /// pallet_conviction_voting before credit is given via record_gov_vote().
    ///
    /// Prevents governance vote spoofing: record_gov_vote previously required
    /// only that the agent signed the extrinsic, with no proof of actual voting.
    /// Any agent doing minimal work (1,000 CMN/era) could call record_gov_vote()
    /// 20 times to claim full gov_score (+4,000 bps activity) for free.
    ///
    /// The runtime implements this by checking VotingFor storage in
    /// pallet_conviction_voting, keeping pallet_agents free from that dependency.
    /// The () default returns `true` so existing unit tests pass without a mock.
    pub trait GovVoteVerifier<AccountId> {
        fn is_actively_voting(who: &AccountId) -> bool;
    }
    impl<AccountId> GovVoteVerifier<AccountId> for () {
        fn is_actively_voting(_: &AccountId) -> bool { true }
    }

    /// Cross-pallet: writes capability registration to pallet-identity additional fields.
    /// Called by agents::set_capability() to persist capability state.
    pub trait IdentityHandler<AccountId> {
        /// Returns true if agent has a registered identity record.
        fn has_identity(who: &AccountId) -> bool;
        /// Sets or clears a capability field in the agent's identity.
        /// capability_id maps to a deterministic field key (b"cap:NNNN").
        fn set_capability(who: &AccountId, capability_id: u32, active: bool) -> frame_support::pallet_prelude::DispatchResult;
        /// Returns true if agent has this capability active.
        fn agent_has_capability(who: &AccountId, capability_id: u32) -> bool;
    }
    /// No-op implementation for test environments (identity not required in mock).
    impl<AccountId> IdentityHandler<AccountId> for () {
        fn has_identity(_: &AccountId) -> bool { true } // permissive in tests
        fn set_capability(_: &AccountId, _: u32, _: bool) -> frame_support::pallet_prelude::DispatchResult { Ok(()) }
        fn agent_has_capability(_: &AccountId, _: u32) -> bool { true }
    }

    /// Called by pallet-orchestrator to credit volume on the orchestrator side.
    pub trait OrchestratorLookup<AccountId, Balance> {
        /// Returns the orchestrator linked to this sub-agent, if any.
        fn get_orchestrator(sub_agent: &AccountId) -> Option<AccountId>;
        /// Credits volume to the orchestrator's era accumulator.
        fn add_orchestrator_volume(orchestrator: &AccountId, amount: Balance);
    }
    impl<AccountId, Balance> OrchestratorLookup<AccountId, Balance> for () {
        fn get_orchestrator(_: &AccountId) -> Option<AccountId> { None }
        fn add_orchestrator_volume(_: &AccountId, _: Balance) {}
    }

    // ─── Pure math ───────────────────────────────────────────────────────────

    /// Integer square root (Newton's method). Correct for all u128 values.
    /// weight ∝ √stake so 100× stake → 10× weight (not 100×) — anti-whale.
    pub fn integer_sqrt(n: u128) -> u128 {
        if n == 0 { return 0; }
        let mut x = n;
        let mut y = (x + 1) / 2;
        while y < x { x = y; y = (x + n / x) / 2; }
        x
    }

    // ─── Config ──────────────────────────────────────────────────────────────
    #[pallet::config]
    pub trait Config: frame_system::Config {
        type RuntimeEvent: From<Event<Self>>
            + IsType<<Self as frame_system::Config>::RuntimeEvent>;

        type Currency: LockableCurrency<Self::AccountId, Moment = BlockNumberFor<Self>>
            + ReservableCurrency<Self::AccountId>;

        /// Minimum stake to register (Basic tier).
        #[pallet::constant]
        type MinStake: Get<BalanceOf<Self>>;

        /// Stake threshold for Full agent rank (rank → 2).
        #[pallet::constant]
        type FullFloorStake: Get<BalanceOf<Self>>;

        /// Maximum stake per agent (anti-concentration).
        #[pallet::constant]
        type MaxStakePerAgent: Get<BalanceOf<Self>>;

        /// Cooldown blocks after request_unstake() before complete_unstake().
        #[pallet::constant]
        type UnstakeCooldown: Get<BlockNumberFor<Self>>;

        /// Base registration fee (burned on every registration).
        #[pallet::constant]
        type BaseRegistrationFee: Get<BalanceOf<Self>>;

        /// Max new registrations per block (flash-flood protection).
        #[pallet::constant]
        type MaxRegistrationsPerBlock: Get<u32>;

        /// Hard cap on total registered agents.
        #[pallet::constant]
        type MaxAgents: Get<u32>;

        /// Minimum completions required to reach Rank 3.
        #[pallet::constant]
        type Rank3MinCompletions: Get<u32>;

        /// Minimum oracle score to reach Rank 3 (0 = disabled).
        #[pallet::constant]
        type MinRank3OracleScore: Get<u32>;

        /// Blocks since first stake before Rank 3 is achievable.
        #[pallet::constant]
        type Rank3SpanGate: Get<BlockNumberFor<Self>>;

        /// Stake × this ratio = diversity credit cap (0 = disabled).
        #[pallet::constant]
        type MaxVolToStakeRatio: Get<u32>;

        /// Grace period (blocks) before heartbeat decay begins.
        #[pallet::constant]
        type HeartbeatGracePeriod: Get<BlockNumberFor<Self>>;

        /// Decay period (blocks): floor falls from 100% to 10% over this span.
        #[pallet::constant]
        type HeartbeatDecayPeriod: Get<BlockNumberFor<Self>>;

        /// Hook: called when agent registers. Initialises emission debt.
        type OnAgentRegistered: OnAgentRegistered<Self::AccountId>;

        /// Cross-pallet: ranked-collective for rank management.
        type AgentCollective: AgentCollective<Self::AccountId>;

        /// Cross-pallet: oracle score for Rank 3 gate.
        type OracleScoreGate: OracleScoreGate<Self::AccountId>;

        /// Cross-pallet: verifies the agent is actively casting a governance vote
        /// before record_gov_vote() awards participation credit.
        /// Wired to pallet_conviction_voting in the runtime; () in unit tests.
        type GovVoteVerifier: GovVoteVerifier<Self::AccountId>;

        /// Cross-pallet: pallet-identity integration for capability registration.
        type IdentityHandler: IdentityHandler<Self::AccountId>;

        /// Cross-pallet: orchestrator volume crediting.
        type OrchestratorLookup: OrchestratorLookup<Self::AccountId, BalanceOf<Self>>;

        /// Max byte length of agent service endpoint URI.
        #[pallet::constant]
        type MaxUriLen: Get<u32>;

        /// Max byte length of agent display name.
        #[pallet::constant]
        type MaxNameLen: Get<u32>;

        /// Maximum number of capabilities per agent.
        #[pallet::constant]
        type MaxCapabilitiesPerAgent: Get<u32>;

        /// Maximum delegation period in blocks.
        #[pallet::constant]
        type MaxDelegationPeriod: Get<BlockNumberFor<Self>>;

        /// Window after a slash within which an appeal can be filed.
        /// After this window, the slash is final.
        #[pallet::constant]
        type SlashAppealWindow: Get<BlockNumberFor<Self>>;

        /// V4: F-07 — receives the treasury share of executed slashes (50%).
        /// Set to pallet_treasury::Pallet<Runtime> in the runtime config.
        /// The burned share (50%) is handled by dropping the NegativeImbalance.
        type SlashDestination: OnUnbalanced<
            <<Self as Config>::Currency as Currency<Self::AccountId>>::NegativeImbalance
        >;

        /// V4: F-05 — max governance votes per agent per era.
        /// Matches the emissions pallet's MaxProposalsPerEra so gov_score cap is enforced at call time.
        #[pallet::constant]
        type MaxProposalsPerEra: Get<u32>;

        /// V4: Hook called after execute_slash completes.
        /// pallet-emissions implements this to zero AgentWeightSnapshot,
        /// preventing one-era overclaim from the stale pre-slash weight.
        type OnAgentSlashed: OnAgentSlashed<Self::AccountId>;

        /// V4: Hook called BEFORE stake increases via add_stake().
        /// pallet-emissions implements this to zero AgentWeightSnapshot,
        /// preventing overclaim of prior-era rewards using the new higher weight.
        type OnStakeChanged: OnStakeChanged<Self::AccountId>;
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    /// On-chain metadata for agent discovery.
    #[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, PartialEq, Eq, Default)]
    #[scale_info(skip_type_params(T))]
    pub struct AgentMeta<T: Config> {
        /// Off-chain service endpoint URI (e.g. "https://agent.example.com/rpc").
        pub uri:        BoundedVec<u8, T::MaxUriLen>,
        /// Human-readable display name for the agent.
        pub name:       BoundedVec<u8, T::MaxNameLen>,
        /// Block at which metadata was last updated.
        pub updated_at: BlockNumberFor<T>,
    }

    // ─── Slash appeal struct ──────────────────────────────────────────────────

    /// Record of a pending slash appeal submitted by an agent.
    #[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, PartialEq, Eq)]
    #[scale_info(skip_type_params(T))]
    pub struct SlashAppealRecord<T: Config> {
        /// Era in which the slash occurred.
        pub slash_era:    u32,
        /// Block at which this appeal was submitted.
        pub appealed_at:  BlockNumberFor<T>,
        /// Hash of the off-chain justification document (IPFS CID).
        pub reason_hash:  [u8; 32],
    }

    // ─── Delegation struct ────────────────────────────────────────────────────

    /// On-chain record of an agent's governance delegation.
    #[derive(Clone, Encode, Decode, MaxEncodedLen, TypeInfo, PartialEq, Eq)]
    #[scale_info(skip_type_params(T))]
    pub struct DelegationRecord<T: Config> {
        /// Account receiving the delegation.
        pub delegate_to: T::AccountId,
        /// Block at which this delegation expires (agent must renew or it lapses).
        pub expires_at:  BlockNumberFor<T>,
        /// Block at which delegation was created.
        pub created_at:  BlockNumberFor<T>,
    }

    // ─── Storage ─────────────────────────────────────────────────────────────

    /// Locked stake per registered agent.
    #[pallet::storage]
    pub type AgentStake<T: Config> =
        CountedStorageMap<_, Blake2_128Concat, T::AccountId, BalanceOf<T>>;

    /// Block at which this agent first locked stake (used for Rank 3 span gate).
    #[pallet::storage]
    pub type StakeRegisteredAt<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, BlockNumberFor<T>, ValueQuery>;

    /// Unstake request: block at which cooldown expires.
    #[pallet::storage]
    pub type UnstakeAt<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, BlockNumberFor<T>, OptionQuery>;

    /// Lifetime completed escrow agreements (drives rank promotion).
    #[pallet::storage]
    pub type CompletedAgreements<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u32, ValueQuery>;

    /// Number of open escrow agreements this agent holds as provider.
    /// Must be 0 before request_unstake() is allowed.
    #[pallet::storage]
    pub type ActiveEscrowCount<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u32, ValueQuery>;

    // ── Per-era storage (cleared by drain_era_maps each era) ─────────────────

    /// Total escrow volume this era per agent.
    #[pallet::storage]
    pub type EraEscrowVolume<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, BalanceOf<T>, ValueQuery>;

    /// Unique buyer count this era per agent (anti-ring diversity signal).
    #[pallet::storage]
    pub type EraUniqueBuyers<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u32, ValueQuery>;

    /// Bloom filter: (agent, buyer_slot) → seen this era.
    /// buyer_slot = blake2_256(buyer_accountid)[0..4] as u32 % 65536
    /// Collision rate ~1/65536 per pair — negligible for anti-ring purposes.
    #[pallet::storage]
    pub type EraSeenBuyerSlots<T: Config> = StorageDoubleMap<
        _, Blake2_128Concat, T::AccountId,
           Blake2_128Concat, u32,
        bool, ValueQuery,
    >;

    /// Governance votes recorded this era per agent.
    #[pallet::storage]
    pub type EraGovParticipation<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, u32, ValueQuery>;

    // ── Era snapshot storage (written by drain_era_maps, read by auto-params) ─

    /// Count of ring-suspect agents before last drain.
    /// Ring-suspect = active this era AND unique_buyers <= 1 AND established (>1 lifetime completion).
    #[pallet::storage]
    pub type EraRingSnapshot<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Count of active agents before last drain (any volume > 0 this era).
    #[pallet::storage]
    pub type EraActiveSnapshot<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Current era number. Incremented by drain_era_maps().
    #[pallet::storage]
    pub type EraNumber<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Block count limiter: reset to 0 every block in on_initialize.
    #[pallet::storage]
    pub type RegistrationsThisBlock<T: Config> = StorageValue<_, u32, ValueQuery>;

    /// Last heartbeat block per agent. Updated by heartbeat() extrinsic.
    #[pallet::storage]
    pub type LastHeartbeat<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, BlockNumberFor<T>, ValueQuery>;

    /// Pending slash appeals: agent → (slash_era, appeal_block, reason_hash).
    /// Governance referendum [Track 0] can overturn the slash within AppealWindow.
    #[pallet::storage]
    pub type PendingSlashAppeals<T: Config> = StorageMap<
        _, Blake2_128Concat, T::AccountId,
        SlashAppealRecord<T>, OptionQuery
    >;

    /// Active voting delegations: agent → DelegationRecord.
    /// Governance tooling reads this to route votes.
    #[pallet::storage]
    pub type VotingDelegations<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, DelegationRecord<T>, OptionQuery>;

    /// Agent endpoint URI + display name for off-chain discovery.
    #[pallet::storage]
    pub type AgentMetadata<T: Config> =
        StorageMap<_, Blake2_128Concat, T::AccountId, AgentMeta<T>, OptionQuery>;

    /// Active capability IDs per agent.
    /// BoundedBTreeSet ensures sorted dedup and bounded storage.
    #[pallet::storage]
    pub type AgentCapabilities<T: Config> = StorageMap<
        _, Blake2_128Concat, T::AccountId,
        BoundedVec<u32, T::MaxCapabilitiesPerAgent>, ValueQuery,
    >;

    // ─── StorageVersion ──────────────────────────────────────────────────────
    const STORAGE_VERSION: StorageVersion = StorageVersion::new(1);

    #[pallet::pallet]
    #[pallet::storage_version(STORAGE_VERSION)]
    pub struct Pallet<T>(_);

    // ─── Genesis ─────────────────────────────────────────────────────────────
    #[pallet::genesis_config]
    #[derive(frame_support::DefaultNoBound)]
    pub struct GenesisConfig<T: Config> {
        /// (account, stake, is_genesis_agent)
        pub agents: Vec<(T::AccountId, BalanceOf<T>, bool)>,
    }

    #[pallet::genesis_build]
    impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
        fn build(&self) {
            for (account, stake, _is_genesis) in &self.agents {
                T::Currency::set_lock(AGENT_LOCK_ID, account, *stake, WithdrawReasons::all());
                AgentStake::<T>::insert(account, stake);
                StakeRegisteredAt::<T>::insert(account, BlockNumberFor::<T>::zero());
                // Induct into ranked-collective at Rank 0; emissions initialises debt separately
                let _ = T::AgentCollective::induct(account);
                // If stake >= FullFloorStake, immediately promote to Rank 2
                if *stake >= T::FullFloorStake::get() {
                    // Rank 0 → 1 → 2
                    let _ = T::AgentCollective::promote(account);
                    let _ = T::AgentCollective::promote(account);
                } else if *stake >= T::MinStake::get() {
                    // Rank 0 → 1 (has stake, qualifies as Basic)
                    let _ = T::AgentCollective::promote(account);
                }
            }
        }
    }

    // ─── Hooks ───────────────────────────────────────────────────────────────
    #[pallet::hooks]
    impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
        fn on_initialize(_n: BlockNumberFor<T>) -> Weight {
            RegistrationsThisBlock::<T>::put(0u32);
            T::DbWeight::get().writes(1)
        }

        fn on_runtime_upgrade() -> Weight {
            // Placeholder — add migration arms here when STORAGE_VERSION increments.
            Weight::zero()
        }
    }

    // ─── Events ──────────────────────────────────────────────────────────────
    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        AgentRegistered    { who: T::AccountId, stake: BalanceOf<T>, fee: BalanceOf<T> },
        StakeAdded         { who: T::AccountId, added: BalanceOf<T>, total: BalanceOf<T> },
        UnstakeRequested   { who: T::AccountId, unstake_at: BlockNumberFor<T> },
        UnstakeCompleted   { who: T::AccountId, released: BalanceOf<T> },
        HeartbeatSent      { who: T::AccountId },
        EraMapsCleared     { era: u32, ring_snap: u32, active_snap: u32 },
        GovVoteRecorded    { who: T::AccountId, total_era_votes: u32 },
        EraVolumeAdded     { who: T::AccountId, amount: BalanceOf<T>, era_total: BalanceOf<T> },
        MetadataUpdated    { who: T::AccountId },
        CapabilitySet      { who: T::AccountId, capability_id: u32, active: bool },
        VotingDelegated    { who: T::AccountId, to: T::AccountId, until: BlockNumberFor<T> },
        VotingDelegationRemoved  { who: T::AccountId },
        SlashAppealed            { who: T::AccountId, slash_era: u32, reason_hash: [u8; 32] },
        SlashAppealWithdrawn     { who: T::AccountId },
        /// V4: F-07 — emitted when a slash is executed and CMN actually removed.
        SlashExecuted            { who: T::AccountId, amount: BalanceOf<T>, burn: BalanceOf<T>, treasury: BalanceOf<T> },
    }

    // ─── Errors ──────────────────────────────────────────────────────────────
    #[pallet::error]
    pub enum Error<T> {
        AlreadyRegistered,
        NotRegistered,
        StakeTooLow,
        StakeTooHigh,
        MaxAgentsReached,
        RegistrationRateLimitExceeded,
        HasActiveAgreements,
        NoUnstakeRequest,
        UnstakeAlreadyPending,
        UnstakeCooldownNotElapsed,
        Unauthorized,
        /// Agent must have a pallet-identity record before registering capabilities.
        IdentityRequired,
        /// Capability list is full (MaxCapabilitiesPerAgent reached).
        TooManyCapabilities,
        DelegationExpired,
        DelegationPeriodTooLong,
        /// Appeal window has elapsed — slash is final.
        AppealWindowExpired,
        /// Agent already has a pending appeal.
        AppealAlreadyPending,
        /// V4: F-05 — agent has already voted MaxProposalsPerEra times this era.
        GovVoteCapReached,
        /// Agent called record_gov_vote() but has no active vote in conviction_voting.
        /// Prevents governance score spoofing: agents must actually be voting on a
        /// referendum to earn governance participation credit in the weight formula.
        NotActivelyVoting,
        /// V4: F-07 — slash amount must be > 0 bps and ≤ 10000 bps.
        InvalidSlashBps,
    }

    // ─── Calls ───────────────────────────────────────────────────────────────
    #[pallet::call]
    impl<T: Config> Pallet<T>
    where
        BalanceOf<T>: From<u32>,
    {
        /// Register as an agent. Burns a fee; locks stake; inducts into ranked-collective.
        #[pallet::call_index(0)]
        #[pallet::weight(T::DbWeight::get().reads_writes(7, 7)
            .saturating_add(Weight::from_parts(120_000_000, 0)))]
        pub fn register(
            origin: OriginFor<T>,
            #[pallet::compact] stake: BalanceOf<T>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;

            ensure!(!AgentStake::<T>::contains_key(&who), Error::<T>::AlreadyRegistered);
            ensure!(stake >= T::MinStake::get(),         Error::<T>::StakeTooLow);
            ensure!(stake <= T::MaxStakePerAgent::get(), Error::<T>::StakeTooHigh);
            ensure!(AgentStake::<T>::count() < T::MaxAgents::get(), Error::<T>::MaxAgentsReached);

            // Rate limit: checked before any state mutations
            let this_block = RegistrationsThisBlock::<T>::get();
            ensure!(this_block < T::MaxRegistrationsPerBlock::get(), Error::<T>::RegistrationRateLimitExceeded);

            let fee = T::BaseRegistrationFee::get();
            let min_balance = T::Currency::minimum_balance();
            ensure!(
                T::Currency::free_balance(&who) >= stake.saturating_add(fee).saturating_add(min_balance),
                Error::<T>::StakeTooLow
            );

            // Increment rate limiter only after all preconditions pass
            RegistrationsThisBlock::<T>::put(this_block + 1);

            // Burn fee
            let _ = T::Currency::withdraw(&who, fee, WithdrawReasons::FEE, ExistenceRequirement::KeepAlive)?;

            // Lock stake
            T::Currency::set_lock(AGENT_LOCK_ID, &who, stake, WithdrawReasons::all());
            AgentStake::<T>::insert(&who, stake);
            StakeRegisteredAt::<T>::insert(&who, frame_system::Pallet::<T>::block_number());

            // Induct into ranked-collective at Rank 0
            T::AgentCollective::induct(&who)?;
            // First completion will trigger Rank 0 → 1; stake threshold triggers 1 → 2

            // Initialise emission debt (prevents back-claiming)
            T::OnAgentRegistered::on_registered(&who);

            Self::deposit_event(Event::AgentRegistered { who, stake, fee });
            Ok(())
        }

        /// Add stake to existing registration. Does not reset the Rank 3 span gate.
        #[pallet::call_index(1)]
        #[pallet::weight(T::DbWeight::get().reads_writes(3, 3)
            .saturating_add(Weight::from_parts(70_000_000, 0)))]
        pub fn add_stake(
            origin: OriginFor<T>,
            #[pallet::compact] amount: BalanceOf<T>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(!amount.is_zero(), Error::<T>::StakeTooLow);
            let current_stake = AgentStake::<T>::get(&who).ok_or(Error::<T>::NotRegistered)?;
            ensure!(UnstakeAt::<T>::get(&who).is_none(), Error::<T>::UnstakeAlreadyPending);
            ensure!(
                T::Currency::free_balance(&who) >= amount,
                Error::<T>::StakeTooLow
            );
            let new_stake = current_stake.saturating_add(amount);
            ensure!(new_stake <= T::MaxStakePerAgent::get(), Error::<T>::StakeTooHigh);

            // Zero AgentWeightSnapshot before changing stake.
            // The MasterChef accumulator uses the LATEST snapshot weight to compute
            // all pending rewards including prior eras. If stake increases between
            // eras, using the new higher weight for old deltas would overclaim.
            // Zeroing the snapshot means unclaimed prior-era rewards are forfeited
            // — a conservative trade-off that closes the exploit.
            // The next settle_era will write the correct new-stake snapshot.
            T::OnStakeChanged::on_stake_changed(&who);

            T::Currency::set_lock(AGENT_LOCK_ID, &who, new_stake, WithdrawReasons::all());
            AgentStake::<T>::insert(&who, new_stake);

            // Check if stake crossed Full-tier threshold → promote to Rank 2
            let current_rank = T::AgentCollective::rank_of(&who).unwrap_or(0);
            if current_rank == 1 && new_stake >= T::FullFloorStake::get() {
                let _ = T::AgentCollective::promote(&who);
            }

            Self::deposit_event(Event::StakeAdded { who, added: amount, total: new_stake });
            Ok(())
        }

        /// Begin unstake cooldown. Blocked if any escrow agreements are open.
        #[pallet::call_index(2)]
        #[pallet::weight(T::DbWeight::get().reads_writes(3, 2)
            .saturating_add(Weight::from_parts(60_000_000, 0)))]
        pub fn request_unstake(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(AgentStake::<T>::contains_key(&who), Error::<T>::NotRegistered);
            ensure!(UnstakeAt::<T>::get(&who).is_none(), Error::<T>::UnstakeAlreadyPending);
            ensure!(ActiveEscrowCount::<T>::get(&who) == 0, Error::<T>::HasActiveAgreements);
            let now = frame_system::Pallet::<T>::block_number();
            let unstake_at = now.saturating_add(T::UnstakeCooldown::get());
            UnstakeAt::<T>::insert(&who, unstake_at);
            Self::deposit_event(Event::UnstakeRequested { who, unstake_at });
            Ok(())
        }

        /// Complete unstake after cooldown. Re-checks for active escrows.
        #[pallet::call_index(3)]
        #[pallet::weight(T::DbWeight::get().reads_writes(4, 4)
            .saturating_add(Weight::from_parts(80_000_000, 0)))]
        pub fn complete_unstake(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            let stake = AgentStake::<T>::get(&who).ok_or(Error::<T>::NotRegistered)?;
            let unstake_at = UnstakeAt::<T>::get(&who).ok_or(Error::<T>::NoUnstakeRequest)?;
            let now = frame_system::Pallet::<T>::block_number();
            ensure!(now >= unstake_at, Error::<T>::UnstakeCooldownNotElapsed);
            // Re-check: new escrow could have been created during cooldown
            ensure!(ActiveEscrowCount::<T>::get(&who) == 0, Error::<T>::HasActiveAgreements);

            T::Currency::remove_lock(AGENT_LOCK_ID, &who);
            T::AgentCollective::remove(&who); // remove from ranked-collective
            AgentStake::<T>::remove(&who);
            UnstakeAt::<T>::remove(&who);
            StakeRegisteredAt::<T>::remove(&who);
            CompletedAgreements::<T>::remove(&who);
            LastHeartbeat::<T>::remove(&who);
            AgentMetadata::<T>::remove(&who);
            AgentCapabilities::<T>::remove(&who);
            VotingDelegations::<T>::remove(&who);
            PendingSlashAppeals::<T>::remove(&who);

            // Clear offchain discovery index
            {
                let key = [b"sc:agent:", &who.encode()[..]].concat();
                sp_io::offchain_index::clear(&key);
            }

            Self::deposit_event(Event::UnstakeCompleted { who, released: stake });
            Ok(())
        }

        /// Send heartbeat. Updates LastHeartbeat for floor emission multiplier.
        /// Agents should send once per era. Missing heartbeats decay floor over time.
        #[pallet::call_index(4)]
        #[pallet::weight(T::DbWeight::get().reads_writes(2, 2)
            .saturating_add(Weight::from_parts(30_000_000, 0)))]
        pub fn heartbeat(origin: OriginFor<T>) -> DispatchResult {
            let who = ensure_signed(origin)?;
            // Single read: get() returns Option, serving both the existence check
            // and the value for the offchain discovery index update.
            let stake = AgentStake::<T>::get(&who).ok_or(Error::<T>::NotRegistered)?;
            let now = frame_system::Pallet::<T>::block_number();
            LastHeartbeat::<T>::insert(&who, now);
            // Update offchain discovery index
            {
                let rank = T::AgentCollective::rank_of(&who).unwrap_or(0);
                let key = [b"sc:agent:", &who.encode()[..]].concat();
                let value = (stake, rank, now).encode();
                sp_io::offchain_index::set(&key, &value);
            }
            Self::deposit_event(Event::HeartbeatSent { who });
            Ok(())
        }

        /// Record governance participation. Called by agent after voting on a referendum.
        /// Self-only: signer must equal agent.
        #[pallet::call_index(5)]
        #[pallet::weight(T::DbWeight::get().reads_writes(2, 1)
            .saturating_add(Weight::from_parts(35_000_000, 0)))]
        pub fn record_gov_vote(origin: OriginFor<T>, agent: T::AccountId) -> DispatchResult {
            let signer = ensure_signed(origin)?;
            ensure!(signer == agent, Error::<T>::Unauthorized);
            ensure!(AgentStake::<T>::contains_key(&agent), Error::<T>::NotRegistered);
            // Verify the agent is CURRENTLY casting a vote in pallet_conviction_voting.
            // Without this check, any agent can call record_gov_vote() 20×/era and claim
            // full gov_score (+4,000 bps activity) with only the minimum 1,000 CMN escrow
            // deal as the work gate. The GovVoteVerifier trait is implemented by the runtime
            // using pallet_conviction_voting::VotingFor storage; () passes all calls in tests.
            ensure!(
                T::GovVoteVerifier::is_actively_voting(&agent),
                Error::<T>::NotActivelyVoting
            );
            // V4: F-05 — cap at MaxProposalsPerEra to prevent gov_score farming by block producers
            ensure!(
                EraGovParticipation::<T>::get(&agent) < T::MaxProposalsPerEra::get(),
                Error::<T>::GovVoteCapReached
            );
            let total = EraGovParticipation::<T>::mutate(&agent, |v| {
                *v = v.saturating_add(1); *v
            });
            Self::deposit_event(Event::GovVoteRecorded { who: agent, total_era_votes: total });
            Ok(())
        }

        /// Update agent service endpoint URI and display name.
        /// Both fields are optional (pass empty to clear). Metadata is not validated on-chain —
        /// it is a discovery hint for buyers, not a security primitive.
        #[pallet::call_index(6)]
        #[pallet::weight(T::DbWeight::get().reads_writes(2, 1)
            .saturating_add(Weight::from_parts(50_000_000, 0)))]
        pub fn update_metadata(
            origin: OriginFor<T>,
            uri:    BoundedVec<u8, T::MaxUriLen>,
            name:   BoundedVec<u8, T::MaxNameLen>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(AgentStake::<T>::contains_key(&who), Error::<T>::NotRegistered);

            let now = frame_system::Pallet::<T>::block_number();
            let meta = AgentMeta::<T> { uri, name, updated_at: now };
            AgentMetadata::<T>::insert(&who, meta);

            Self::deposit_event(Event::MetadataUpdated { who });
            Ok(())
        }

        /// Register or deregister an AI capability.
        /// Writes to pallet-identity additional fields so oracle can gate responses.
        /// Agent must have a pallet-identity record (created via identity::set_identity()).
        /// Setting active=false removes the capability from oracle gating.
        #[pallet::call_index(7)]
        #[pallet::weight(T::DbWeight::get().reads_writes(3, 2)
            .saturating_add(Weight::from_parts(60_000_000, 0)))]
        pub fn set_capability(
            origin:        OriginFor<T>,
            capability_id: u32,
            active:        bool,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(AgentStake::<T>::contains_key(&who), Error::<T>::NotRegistered);
            ensure!(T::IdentityHandler::has_identity(&who), Error::<T>::IdentityRequired);

            // Write to pallet-identity so oracle capability gate can read it
            T::IdentityHandler::set_capability(&who, capability_id, active)?;

            // Maintain sorted local capability list for efficient query
            AgentCapabilities::<T>::try_mutate(&who, |caps| -> DispatchResult {
                if active {
                    // Insert if not present
                    if !caps.contains(&capability_id) {
                        caps.try_push(capability_id)
                            .map_err(|_| Error::<T>::TooManyCapabilities)?;
                        let mut v = caps.to_vec(); v.sort_unstable(); *caps = v.try_into().unwrap_or_default();
                    }
                } else {
                    // Remove if present
                    caps.retain(|&c| c != capability_id);
                }
                Ok(())
            })?;

            Self::deposit_event(Event::CapabilitySet { who, capability_id, active });
            Ok(())
        }

        /// Delegate conviction-voting weight to another account.
        ///
        /// An AI agent running autonomously can delegate its governance vote to a
        /// human operator account until a specified block. This allows governance
        /// participation without requiring the agent software to sign governance txs.
        ///
        /// The delegation is recorded locally and is read by governance integrations.
        /// Actual conviction-voting delegation uses pallet-conviction-voting::delegate()
        /// externally — this records the agent's *intent* for discovery and analytics.
        ///
        /// Self-only (signer == agent). Expires at `until` block.
        /// Pass until = 0 to remove delegation.
        #[pallet::call_index(8)]
        #[pallet::weight(T::DbWeight::get().reads_writes(2, 2)
            .saturating_add(Weight::from_parts(40_000_000, 0)))]
        pub fn delegate_voting(
            origin:    OriginFor<T>,
            to:        T::AccountId,
            until:     BlockNumberFor<T>,
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(AgentStake::<T>::contains_key(&who), Error::<T>::NotRegistered);
            let now = frame_system::Pallet::<T>::block_number();
            // Validate: if non-zero, must be future and within max period
            if until != BlockNumberFor::<T>::zero() {
                ensure!(until > now, Error::<T>::DelegationExpired);
                let max_until = now.saturating_add(T::MaxDelegationPeriod::get());
                ensure!(until <= max_until, Error::<T>::DelegationPeriodTooLong);
            }
            if until == BlockNumberFor::<T>::zero() {
                // Remove delegation only — do NOT touch PendingSlashAppeals here.
                // Slash appeals are independent of voting delegation.
                // Clearing appeals here would let slashed agents erase governance records.
                VotingDelegations::<T>::remove(&who);
                Self::deposit_event(Event::VotingDelegationRemoved { who });
            } else {
                let record = DelegationRecord::<T> {
                    delegate_to: to.clone(),
                    expires_at:  until,
                    created_at:  now,
                };
                VotingDelegations::<T>::insert(&who, record);
                Self::deposit_event(Event::VotingDelegated { who, to, until });
            }
            Ok(())
        }

        /// File a slash appeal with an off-chain justification document.
        ///
        /// The agent submits the IPFS CID (as [u8;32]) of a justification document
        /// explaining why the slash was unwarranted. A Track 0 governance referendum
        /// can then vote to reverse the slash within SlashAppealWindow blocks.
        ///
        /// Only one appeal can be pending at a time. Appeal fails if:
        /// - No slash record exists for this agent
        /// - The appeal window has already passed
        /// - A prior appeal is still pending
        ///
        /// # Note
        /// This extrinsic records intent — actual slash reversal requires a
        /// governance referendum that calls a privileged reversal extrinsic.
        #[pallet::call_index(9)]
        #[pallet::weight(T::DbWeight::get().reads_writes(3, 2)
            .saturating_add(Weight::from_parts(50_000_000, 0)))]
        pub fn slash_appeal(
            origin:      OriginFor<T>,
            slash_era:   u32,
            reason_hash: [u8; 32],
        ) -> DispatchResult {
            let who = ensure_signed(origin)?;
            ensure!(AgentStake::<T>::contains_key(&who), Error::<T>::NotRegistered);
            ensure!(
                !PendingSlashAppeals::<T>::contains_key(&who),
                Error::<T>::AppealAlreadyPending
            );

            let now = frame_system::Pallet::<T>::block_number();
            let era_now = EraNumber::<T>::get();
            // Appeal must be filed within SlashAppealWindow eras of the slash
            // Using blocks here: approximate 1 era = EraDuration blocks
            ensure!(
                era_now < slash_era.saturating_add(
                    T::SlashAppealWindow::get().min(BlockNumberFor::<T>::from(255u32))
                        .try_into().unwrap_or(0u32)
                ),
                Error::<T>::AppealWindowExpired
            );

            let record = SlashAppealRecord::<T> {
                slash_era,
                appealed_at: now,
                reason_hash,
            };
            PendingSlashAppeals::<T>::insert(&who, record);

            Self::deposit_event(Event::SlashAppealed { who, slash_era, reason_hash });
            Ok(())
        }

        /// V4: F-07 — Execute a governance-reviewed slash against an agent's locked stake.
        ///
        /// Agent stake is held via Currency::set_lock (LockableCurrency), NOT reserve.
        /// slash_reserved would return zero — wrong approach. Correct sequence:
        ///   1. Compute slash_amount = stake × bps / 10_000
        ///   2. Reduce the lock to (stake - slash_amount) so slash_amount becomes spendable
        ///   3. Withdraw slash_amount from the now-unlocked free balance → NegativeImbalance
        ///   4. Split 50/50: treasury half via SlashDestination::on_unbalanced, burn half by drop
        ///   5. Update AgentStake to the reduced amount
        ///
        /// Origin: Must be Root (governance Track 0 enactment).
        #[pallet::call_index(10)]
        #[pallet::weight(T::DbWeight::get().reads_writes(5, 5)
            .saturating_add(Weight::from_parts(100_000_000, 0)))]
        pub fn execute_slash(
            origin: OriginFor<T>,
            who:    T::AccountId,
            bps:    u32,   // basis points of stake to slash, 1–10000 (100 bps = 1%)
        ) -> DispatchResult {
            ensure_root(origin)?;
            ensure!(bps > 0 && bps <= 10_000, Error::<T>::InvalidSlashBps);

            let stake = AgentStake::<T>::get(&who)
                .ok_or(Error::<T>::NotRegistered)?;

            // slash_amount bounded: stake ≤ MaxStakePerAgent (1M CMN) × 10_000 / 10_000 = stake.
            // saturating_mul safe — no overflow at these magnitudes.
            let slash_amount: BalanceOf<T> = stake
                .saturating_mul(bps.into())
                / 10_000u32.into();

            ensure!(slash_amount > BalanceOf::<T>::zero(), Error::<T>::InvalidSlashBps);

            let new_stake = stake.saturating_sub(slash_amount);

            // Step 1: Reduce or remove the lock, freeing slash_amount in the free balance.
            // Reducing set_lock immediately frees the delta in the account's free balance.
            // We do NOT update AgentStake yet — only do so after withdraw succeeds.
            if new_stake >= T::MinStake::get() {
                T::Currency::set_lock(AGENT_LOCK_ID, &who, new_stake, WithdrawReasons::all());
            } else {
                T::Currency::remove_lock(AGENT_LOCK_ID, &who);
            }

            // Step 2: Withdraw the now-free slash_amount.
            // AllowDeath: if slash leaves dust below ExistentialDeposit, let account die.
            // The ? here: if withdraw errors (theoretically impossible after lock-reduce),
            // the function returns Err and the lock change is the only committed state.
            // The agent's lock is reduced but AgentStake not yet updated — acceptable
            // since governance can re-run if needed, and the lock IS reduced correctly.
            let imbalance = T::Currency::withdraw(
                &who,
                slash_amount,
                WithdrawReasons::TRANSFER,
                ExistenceRequirement::AllowDeath,
            )?;
            let actually_slashed = imbalance.peek();

            // Step 3: Commit the new stake only after successful withdraw.
            // If slash drops below MinStake, remove the entry entirely rather than
            // inserting 0 — a zero-stake record would pollute AgentStake::iter()
            // in settle_era, wasting one storage read per era for a dead agent.
            if new_stake >= T::MinStake::get() {
                AgentStake::<T>::insert(&who, new_stake);
            } else {
                AgentStake::<T>::remove(&who);
            }

            // Step 4: 50/50 split — treasury receives half, half burned on drop.
            let (treasury_imbalance, burn_imbalance) = imbalance.ration(50, 50);
            T::SlashDestination::on_unbalanced(treasury_imbalance);
            let burn     = burn_imbalance.peek();
            let treasury = actually_slashed.saturating_sub(burn);
            drop(burn_imbalance); // NegativeImbalance drop → total_issuance -= burn

            // Clear any pending appeal — slash executed, appeal moot.
            PendingSlashAppeals::<T>::remove(&who);

            // Notify emissions pallet to zero the weight snapshot.
            // This prevents the slashed agent from overclaiming using the stale
            // pre-slash weight in do_claim() before the next settle_era runs.
            T::OnAgentSlashed::on_slashed(&who);

            Self::deposit_event(Event::SlashExecuted {
                who,
                amount: actually_slashed,
                burn,
                treasury,
            });
            Ok(())
        }
    } // end #[pallet::call]

    // ─── Public cross-pallet helpers ─────────────────────────────────────────
    impl<T: Config> Pallet<T>
    where
        BalanceOf<T>: From<u32>,
    {
        /// Called by pallet-escrow when a new agreement is created.
        pub fn increment_active_escrow(provider: &T::AccountId) -> DispatchResult {
            ensure!(AgentStake::<T>::contains_key(provider), Error::<T>::NotRegistered);
            ActiveEscrowCount::<T>::mutate(provider, |c| *c = c.saturating_add(1));
            Ok(())
        }

        /// Called by pallet-escrow on every agreement settlement path.
        pub fn decrement_active_escrow(provider: &T::AccountId) {
            ActiveEscrowCount::<T>::mutate(provider, |c| *c = c.saturating_sub(1));
        }

        /// Returns true if the account is a registered agent.
        pub fn is_agent(who: &T::AccountId) -> bool {
            AgentStake::<T>::contains_key(who)
        }

        /// Called by pallet-escrow confirm_delivery.
        /// Accumulates era volume, tracks buyer diversity, increments completions,
        /// and triggers rank promotions if thresholds are met.
        pub fn add_era_escrow_volume(
            agent: &T::AccountId,
            buyer: &T::AccountId,
            amount: BalanceOf<T>,
        ) -> DispatchResult {
            let stake = AgentStake::<T>::get(agent).ok_or(Error::<T>::NotRegistered)?;

            // Accumulate era volume (single storage read via mutate)
            let era_total = EraEscrowVolume::<T>::mutate(agent, |v| {
                *v = v.saturating_add(amount); *v
            });

            // Buyer diversity via bloom filter
            let buyer_bytes = buyer.encode();
            let hash = sp_io::hashing::blake2_256(&buyer_bytes);
            let slot = u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]) % 65_536;
            if !EraSeenBuyerSlots::<T>::get(agent, slot) {
                EraSeenBuyerSlots::<T>::insert(agent, slot, true);
                // Stake-weighted diversity cap: diversity credit stops above stake × ratio
                let ratio = T::MaxVolToStakeRatio::get() as u128;
                let diversity_ok = ratio == 0 || {
                    let era_vol_u128: u128 = sp_runtime::traits::UniqueSaturatedInto::<u128>::unique_saturated_into(era_total);
                    let stake_u128:   u128 = sp_runtime::traits::UniqueSaturatedInto::<u128>::unique_saturated_into(stake);
                    era_vol_u128 <= stake_u128.saturating_mul(ratio)
                };
                if diversity_ok {
                    EraUniqueBuyers::<T>::mutate(agent, |c| *c = c.saturating_add(1));
                }
            }

            // Increment lifetime completions
            let completions = CompletedAgreements::<T>::mutate(agent, |c| {
                *c = c.saturating_add(1); *c
            });

            // Check rank promotions
            Self::maybe_promote(agent, completions, stake)?;

            // Credit orchestrator (if any) with this volume
            if let Some(orch) = T::OrchestratorLookup::get_orchestrator(agent) {
                T::OrchestratorLookup::add_orchestrator_volume(&orch, amount);
            }

            Self::deposit_event(Event::EraVolumeAdded {
                who: agent.clone(), amount, era_total,
            });
            Ok(())
        }

        /// Heartbeat floor multiplier for the emission formula.
        /// Returns 10–100 (percentage of floor to apply).
        pub fn heartbeat_multiplier(who: &T::AccountId) -> u128 {
            let last = LastHeartbeat::<T>::get(who);
            let now  = frame_system::Pallet::<T>::block_number();
            let since = now.saturating_sub(last);
            let grace  = T::HeartbeatGracePeriod::get();
            let decay  = T::HeartbeatDecayPeriod::get();

            if since <= grace {
                return 100;
            }
            let over: u128 = since.saturating_sub(grace)
                .min(decay)
                .try_into().unwrap_or(0);
            let decay_u128: u128 = decay.try_into().unwrap_or(1).max(1);
            let pct = 100u128.saturating_sub(90u128 * over / decay_u128);
            pct.max(10)
        }

        /// Called by emissions settle_era. Snapshots ring/active counts then clears
        /// all per-era storage and increments EraNumber.
        pub fn drain_era_maps(era: u32) {
            let mut ring_snap:   u32 = 0;
            let mut active_snap: u32 = 0;

            for (agent, vol) in EraEscrowVolume::<T>::iter() {
                if vol > Zero::zero() {
                    active_snap = active_snap.saturating_add(1);
                    // Ring signal: only flag established agents (> 1 lifetime completion).
                    // New agents naturally have unique_buyers=1 in their first era —
                    // excluding them prevents false positives at launch.
                    let completions = CompletedAgreements::<T>::get(&agent);
                    let is_established = completions > 1;
                    if is_established && EraUniqueBuyers::<T>::get(&agent) <= 1 {
                        ring_snap = ring_snap.saturating_add(1);
                    }
                }
            }

            EraRingSnapshot::<T>::put(ring_snap);
            EraActiveSnapshot::<T>::put(active_snap);

            // Clear all per-era maps with headroom for churn
            let registered = AgentStake::<T>::count();
            let bound = registered.saturating_add(registered / 5).max(100);
            let _ = EraEscrowVolume::<T>::clear(bound, None);
            let _ = EraUniqueBuyers::<T>::clear(bound, None);
            let _ = EraGovParticipation::<T>::clear(bound, None);
            let _ = EraSeenBuyerSlots::<T>::clear(bound.saturating_mul(128), None);

            EraNumber::<T>::mutate(|n| *n = n.saturating_add(1));
            Self::deposit_event(Event::EraMapsCleared { era, ring_snap, active_snap });
        }

        // ── Internal ─────────────────────────────────────────────────────────
        fn maybe_promote(
            who: &T::AccountId,
            completions: u32,
            stake: BalanceOf<T>,
        ) -> DispatchResult {
            let rank = T::AgentCollective::rank_of(who).unwrap_or(0);

            // Rank 0 → 1: first escrow completion proves agent is operational
            if rank == 0 && completions >= 1 {
                T::AgentCollective::promote(who)?;
                // rank_bps unchanged (0 and 1 both = 10000). No snapshot clear needed.
            }
            // Rank 1 → 2: crossed Full-tier stake threshold (+20% rank_bps)
            else if rank == 1 && stake >= T::FullFloorStake::get() {
                T::AgentCollective::promote(who)?;
                // rank_bps increases 10000 → 12000. Zero snapshot to prevent
                // MasterChef overclaim: prior-era deltas would be multiplied
                // by the new higher weight if snapshot is not zeroed here.
                T::OnStakeChanged::on_stake_changed(who);
            }
            // Rank 2 → 3: completions + span gate + oracle score (+25% rank_bps)
            else if rank == 2
                && completions >= T::Rank3MinCompletions::get()
                && Self::span_gate_passed(who)
                && Self::oracle_gate_passed(who)
            {
                T::AgentCollective::promote(who)?;
                // rank_bps increases 12000 → 15000. Same MasterChef protection.
                T::OnStakeChanged::on_stake_changed(who);
            }
            Ok(())
        }

        fn span_gate_passed(who: &T::AccountId) -> bool {
            let registered_at = StakeRegisteredAt::<T>::get(who);
            let now = frame_system::Pallet::<T>::block_number();
            now.saturating_sub(registered_at) >= T::Rank3SpanGate::get()
        }

        fn oracle_gate_passed(who: &T::AccountId) -> bool {
            let min_score = T::MinRank3OracleScore::get();
            min_score == 0 || T::OracleScoreGate::best_score(who) >= min_score
        }
    }
}
