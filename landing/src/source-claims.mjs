// The descriptive claims the home page makes, each pinned to the line of
// runtime source that backs it.
//
// Numbers on the page are covered by chain-facts.json: they come out of live
// metadata and `npm run verify:chain` re-checks them. Sentences like "the
// emissions module pays for verified work, not for stake" have no metadata
// equivalent, so they are pinned here instead: every sentence in
// src/content.mjs that describes a mechanism names the rows that back it in
// `sources`, and test/claims.test.mjs asserts every `snippet` (and every
// `also` snippet) below is still present, verbatim, in its `file`, on its
// `line`. If someone changes the mechanism, the claim on the page breaks the
// build instead of quietly becoming a lie; if a tree moves, the line, never
// the claim, is corrected.
export const sourceClaims = [
  {
    key: 'min-stake',
    claim: 'An agent stakes at least the minimum stake to register',
    file: 'runtime/src/lib.rs',
    line: 1232,
    snippet: 'pub const AgentsMinStake:             Balance = 1_000 * CMN;',
    also: [{ file: 'runtime/src/lib.rs', line: 1257, snippet: 'type MinStake = AgentsMinStake;' }],
  },
  {
    key: 'registration-fee',
    claim: 'Registering costs a fee',
    file: 'runtime/src/lib.rs',
    line: 1236,
    snippet: 'pub const AgentsBaseRegistrationFee:  Balance = 50 * CMN;',
  },
  {
    key: 'heartbeat-clock',
    claim: 'Registering starts the heartbeat clock; a heartbeat resets it',
    file: 'pallets/agents/src/lib.rs',
    line: 1005,
    snippet: 'LastHeartbeat::<T>::insert(&who, now);',
    also: [
      { file: 'pallets/agents/src/lib.rs', line: 1174, snippet: 'pub fn heartbeat(origin: OriginFor<T>) -> DispatchResult {' },
      { file: 'pallets/agents/src/lib.rs', line: 1180, snippet: 'LastHeartbeat::<T>::insert(&who, now);' },
    ],
  },
  {
    key: 'heartbeat-decay',
    claim: 'A heartbeat is good for the grace period; then the agent’s weight decays to a floor',
    file: 'runtime/src/lib.rs',
    line: 1243,
    snippet: 'pub const AgentsHeartbeatGrace:       BlockNumber = HOURS * 18;',
    also: [
      { file: 'runtime/src/lib.rs', line: 1244, snippet: 'pub const AgentsHeartbeatDecay:       BlockNumber = DAYS * 90;' },
      { file: 'pallets/agents/src/lib.rs', line: 1987, snippet: 'pub fn heartbeat_multiplier(' },
      { file: 'pallets/agents/src/lib.rs', line: 2003, snippet: 'let pct = 100u128.saturating_sub(90u128 * over / decay_u128);' },
      { file: 'pallets/agents/src/lib.rs', line: 2004, snippet: 'pct.max(10)' },
      { file: 'pallets/emissions/src/lib.rs', line: 682, snippet: 'let hb = agents_pallet::Pallet::<T>::heartbeat_multiplier(who);' },
    ],
  },
  {
    key: 'min-agreement',
    claim: 'An agreement escrows at least the minimum amount',
    file: 'runtime/src/lib.rs',
    line: 1292,
    snippet: 'pub const EscrowMinAmount:         Balance = 10 * CMN;',
    also: [{ file: 'runtime/src/lib.rs', line: 1306, snippet: 'type MinAgreementAmount = EscrowMinAmount;' }],
  },
  {
    key: 'dispute-to-oracle',
    claim: 'A disputed delivery becomes an oracle question',
    file: 'pallets/escrow/src/lib.rs',
    line: 598,
    snippet: 'let request_id = T::DisputeOracle::post_dispute_question(',
  },
  {
    key: 'era-length',
    claim: 'An era is a fixed number of blocks, about six hours',
    file: 'runtime/src/lib.rs',
    line: 102,
    snippet: 'pub const ERA_BLOCKS: BlockNumber = HOURS * 6;',
    also: [{ file: 'runtime/src/lib.rs', line: 1347, snippet: 'pub const EmissionsEraDuration:      BlockNumber = ERA_BLOCKS;' }],
  },
  {
    key: 'settle-era',
    claim: 'Anyone may settle an era, once, when it is due',
    file: 'pallets/emissions/src/lib.rs',
    line: 246,
    snippet: 'pub fn settle_era(origin: OriginFor<T>) -> DispatchResult {',
    also: [
      { file: 'pallets/emissions/src/lib.rs', line: 250, snippet: 'ensure_signed(origin)?;' },
      { file: 'pallets/emissions/src/lib.rs', line: 260, snippet: 'Error::<T>::EraNotDue' },
      { file: 'pallets/emissions/src/lib.rs', line: 266, snippet: 'Error::<T>::EraAlreadySettled' },
    ],
  },
  {
    key: 'work-not-stake',
    claim: 'Emissions pay for verified work; stake enters as a square root and earns nothing without work this era',
    file: 'pallets/emissions/src/lib.rs',
    line: 702,
    snippet: 'let did_work_this_era = vol_u128 > 0;',
    also: [
      { file: 'pallets/emissions/src/lib.rs', line: 673, snippet: 'let sqrt_stake = integer_sqrt(stake_u128);' },
      { file: 'pallets/emissions/src/lib.rs', line: 711, snippet: 'let qualifies_for_floor = is_active && (min_qual == 0 || vol_u128 >= min_qual);' },
      { file: 'pallets/emissions/src/lib.rs', line: 723, snippet: 'let gov_contribution = if work_score > 0 {' },
    ],
  },
  {
    key: 'oracle-bounty',
    claim: 'An oracle question carries a bounty of at least the minimum',
    file: 'runtime/src/lib.rs',
    line: 1322,
    snippet: 'pub const OracleMinBounty:          Balance = CMN;',
    also: [{ file: 'runtime/src/lib.rs', line: 1332, snippet: 'type MinOracleBounty = OracleMinBounty;' }],
  },
  {
    key: 'orchestrator-fee',
    claim: 'An orchestrator keeps at most the fee cap, hires a bounded number of sub-agents and cannot link to itself',
    file: 'runtime/src/lib.rs',
    line: 1250,
    snippet: 'pub const OrchestratorMaxFeeBps:       u32 = 500;',
    also: [
      { file: 'runtime/src/lib.rs', line: 1392, snippet: 'type MaxSubAgentsPerOrchestrator = ConstU32<50>;' },
      { file: 'pallets/orchestrator/src/lib.rs', line: 392, snippet: 'ensure!(orchestrator != sub_agent, Error::<T>::SelfLink);' },
    ],
  },
  {
    key: 'supply-cap',
    claim: 'An era can never mint past the supply cap',
    file: 'runtime/src/lib.rs',
    line: 83,
    snippet: 'pub const SUPPLY_CAP: Balance = 100_000_000_000 * CMN;',
    also: [{ file: 'pallets/emissions/src/lib.rs', line: 635, snippet: 'let mintable = supply_cap.saturating_sub(total_issued).min(pending_u128);' }],
  },
  {
    key: 'message-fee',
    claim: 'A message costs a base fee plus a per-byte fee; a sender gets a bounded number per block',
    file: 'runtime/src/lib.rs',
    line: 1403,
    snippet: 'pub const MessagesBaseFee:    Balance = CMN / 50;',
    also: [
      { file: 'runtime/src/lib.rs', line: 1407, snippet: 'MessagesPerByteFee: Balance = CMN / 10_000;' },
      { file: 'runtime/src/lib.rs', line: 1410, snippet: 'MessagesMaxPerBlock: u32 = 4;' },
    ],
  },
  {
    key: 'constitution-floor',
    claim: 'The constitution fixes the supply cap and a minimum unstake cooldown that self-tuning parameters cannot cross',
    file: 'runtime/src/lib.rs',
    line: 798,
    snippet: 'pub const ConstitutionMinCooldown: BlockNumber = 7 * DAYS;',
    also: [
      { file: 'runtime/src/lib.rs', line: 808, snippet: 'type MinUnstakeCooldown = ConstitutionMinCooldown;' },
      { file: 'pallets/constitution/src/lib.rs', line: 181, snippet: 'proposed >= T::MinUnstakeCooldown::get(),' },
    ],
  },
  {
    key: 'oracle-bonus-inert',
    claim: 'The oracle bonus exists on paper and is inert: no score provider is wired',
    file: 'runtime/src/lib.rs',
    line: 1348,
    snippet: 'pub const EmissionsOracleBonusBps:   u32 = 2_000;',
    also: [{ file: 'runtime/src/lib.rs', line: 1382, snippet: 'type OracleScoreProvider = ();' }],
  },
  {
    key: 'volume-bound',
    claim: 'An era cannot mint more than alpha times the qualifying escrow volume it settled',
    file: 'pallets/emissions/src/lib.rs',
    line: 415,
    snippet: 'let alpha_bps = T::AutoParams::emission_volume_alpha_bps() as u128;',
  },
];

/** The rows by key, for the sentences that cite them. */
export const sourceClaimsByKey = Object.fromEntries(sourceClaims.map((row) => [row.key, row]));
