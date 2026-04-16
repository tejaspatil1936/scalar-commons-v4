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
