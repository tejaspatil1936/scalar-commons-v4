// The descriptive claims the site makes about the runtime, each pinned to the
// line of source that backs it — the old ledger's rows first, then the older
// rows the docs still cite. The plain home page (SITE-REDESIGN.md §5.1) no
// longer prints this list; its sentences ("emissions reward verified work",
// "stake does not earn by itself", "no vote can lift the limits") rest on it,
// and test/claims.test.mjs keeps every row true against the tree.
//
// Numbers on the page are covered by chain-facts.json: they come out of live
// metadata and `npm run verify:chain` re-checks them. Sentences like "stake
// counts sub-linearly" have no metadata equivalent, so they are pinned here
// instead: the test suite asserts every `snippet` (and every `also` snippet)
// below is still present, verbatim and contiguous, in its `file`. If someone
// changes the mechanism, the claim on the page breaks the build instead of
// quietly becoming a lie. `line` is the line in the checkout the row was
// verified against; the test asserts the snippet sits on that line, so a tree
// that moves fails the build until the line, never the claim, is corrected.
export const sourceClaims = [
  {
    ledger: 1,
    claim: 'The supply cap is 100 B CMN; the mainnet genesis allocation is 18 B (the testnet’s genesis differs: read it from the chain)',
    file: 'runtime/src/lib.rs',
    line: 83,
    snippet: 'pub const SUPPLY_CAP: Balance = 100_000_000_000 * CMN;',
    also: [{ file: 'runtime/src/lib.rs', line: 84, snippet: 'pub const GENESIS_MINT: Balance = 18_000_000_000 * CMN;' }],
  },
  {
    ledger: 2,
    claim: 'An era is 3,600 blocks, about six hours',
    file: 'runtime/src/lib.rs',
    line: 102,
    snippet: 'pub const ERA_BLOCKS: BlockNumber = HOURS * 6;',
    also: [{ file: 'runtime/src/lib.rs', line: 1347, snippet: 'pub const EmissionsEraDuration:      BlockNumber = ERA_BLOCKS;' }],
  },
  { ledger: 3, claim: 'Validators are not paid', file: 'runtime/src/lib.rs', line: 952, snippet: 'type EraPayout = ();' },
  { ledger: 4, claim: 'An agent stakes at least 1,000 CMN', file: 'runtime/src/lib.rs', line: 1232, snippet: 'pub const AgentsMinStake:             Balance = 1_000 * CMN;' },
  { ledger: 5, claim: 'Unstaking takes 7 days', file: 'runtime/src/lib.rs', line: 1235, snippet: 'pub const AgentsUnstakeCooldown:      BlockNumber = 7 * DAYS;' },
  { ledger: 6, claim: 'Registering costs 50 CMN', file: 'runtime/src/lib.rs', line: 1236, snippet: 'pub const AgentsBaseRegistrationFee:  Balance = 50 * CMN;' },
  {
    ledger: 7,
    claim: 'A heartbeat is good for 18 h; then weight decays over 90 days to a 10 % floor',
    file: 'runtime/src/lib.rs',
    line: 1243,
    snippet: 'pub const AgentsHeartbeatGrace:       BlockNumber = HOURS * 18;',
    also: [
      { file: 'runtime/src/lib.rs', line: 1244, snippet: 'pub const AgentsHeartbeatDecay:       BlockNumber = DAYS * 90;' },
      { file: 'pallets/agents/src/lib.rs', line: 1987, snippet: 'pub fn heartbeat_multiplier(' },
      { file: 'pallets/agents/src/lib.rs', line: 2003, snippet: 'let pct = 100u128.saturating_sub(90u128 * over / decay_u128);' },
      { file: 'pallets/agents/src/lib.rs', line: 2004, snippet: 'pct.max(10)' },
    ],
  },
  {
    ledger: 8,
    claim: 'An orchestrator takes at most 5 % and cannot link to itself',
    file: 'runtime/src/lib.rs',
    line: 1250,
    snippet: 'pub const OrchestratorMaxFeeBps:       u32 = 500;',
    also: [{ file: 'pallets/orchestrator/src/lib.rs', line: 392, snippet: 'ensure!(orchestrator != sub_agent, Error::<T>::SelfLink);' }],
  },
  { ledger: 9, claim: 'An agreement escrows at least 10 CMN', file: 'runtime/src/lib.rs', line: 1292, snippet: 'pub const EscrowMinAmount:         Balance = 10 * CMN;' },
  {
    ledger: 10,
    claim: 'A correct dispute earns 2 % of the escrow, at least 1 CMN; nothing is burned',
    file: 'runtime/src/lib.rs',
    line: 1297,
    snippet: 'pub const EscrowDisputeBountyBps:  u32 = 200;',
    also: [
      { file: 'runtime/src/lib.rs', line: 1298, snippet: 'pub const EscrowMinDisputeBounty:  Balance = CMN;' },
      { file: 'runtime/src/lib.rs', line: 1299, snippet: 'pub const EscrowDisputeBurnBps:    u32 = 0;' },
    ],
  },
  {
    ledger: 11,
    claim: 'The oracle bonus is 20 % on paper and inert in practice',
    file: 'runtime/src/lib.rs',
    line: 1348,
    snippet: 'pub const EmissionsOracleBonusBps:   u32 = 2_000;',
    also: [{ file: 'runtime/src/lib.rs', line: 1382, snippet: 'type OracleScoreProvider = ();' }],
  },
  {
    ledger: 12,
    claim: 'Under 50 CMN of settled volume in an era earns nothing; the velocity bonus is 30 %',
    file: 'runtime/src/lib.rs',
    line: 1356,
    snippet: 'EmissionsMinQualifyingVol: Balance = 50 * CMN;',
    also: [{ file: 'runtime/src/lib.rs', line: 1362, snippet: 'EmissionsVelocityBonusBps: u32 = 3_000;' }],
  },
  {
    ledger: 13,
    claim: 'A message costs 0.02 CMN plus 0.0001 CMN per byte; four per block',
    file: 'runtime/src/lib.rs',
    line: 1403,
    snippet: 'pub const MessagesBaseFee:    Balance = CMN / 50;',
    also: [
      { file: 'runtime/src/lib.rs', line: 1407, snippet: 'MessagesPerByteFee: Balance = CMN / 10_000;' },
      { file: 'runtime/src/lib.rs', line: 1410, snippet: 'MessagesMaxPerBlock: u32 = 4;' },
    ],
  },
  {
    ledger: 14,
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
    ledger: 15,
    claim: 'Weight is √stake × rank × log₂ volume × buyer diversity; governance counts only with work; the first ten completions carry a boost',
    file: 'pallets/emissions/src/lib.rs',
    line: 673,
    snippet: 'let sqrt_stake = integer_sqrt(stake_u128);',
    also: [
      { file: 'pallets/emissions/src/lib.rs', line: 676, snippet: 'let rank_bps' },
      { file: 'pallets/emissions/src/lib.rs', line: 677, snippet: '0 | 1 => 10_000' },
      { file: 'pallets/emissions/src/lib.rs', line: 678, snippet: '2 => 12_000' },
      { file: 'pallets/emissions/src/lib.rs', line: 679, snippet: '_ => 15_000' },
      { file: 'pallets/emissions/src/lib.rs', line: 688, snippet: 'let raw_vol = log2_scaled(vol_u128, unit_u128);' },
      { file: 'pallets/emissions/src/lib.rs', line: 691, snippet: 'let work_score = if raw_vol == 0 || diversity_bps == 0 {' },
      { file: 'pallets/emissions/src/lib.rs', line: 723, snippet: 'let gov_contribution = if work_score > 0 {' },
      { file: 'pallets/emissions/src/lib.rs', line: 802, snippet: 'fn diversity_score_bps' },
      { file: 'pallets/emissions/src/lib.rs', line: 805, snippet: '1_000' },
      { file: 'pallets/emissions/src/lib.rs', line: 806, snippet: '3_000' },
      { file: 'pallets/emissions/src/lib.rs', line: 807, snippet: '6_000' },
      { file: 'pallets/emissions/src/lib.rs', line: 808, snippet: '8_000' },
      { file: 'pallets/emissions/src/lib.rs', line: 336, snippet: 'let onboarding_boost: u128 = if completions < 10 {' },
    ],
  },
  {
    ledger: 16,
    claim: 'An era can never mint past the cap; genesis is accounted to the token',
    file: 'pallets/emissions/src/lib.rs',
    line: 635,
    snippet: 'let mintable = supply_cap.saturating_sub(total_issued).min(pending_u128);',
    also: [{ file: 'node/src/chain_spec.rs', line: 41, snippet: 'FOUNDERS_ALLOC + RESEARCHERS_ALLOC + TREASURY_ALLOC + BOOTSTRAP_ALLOC == 18_000_000_000 * CMN,' }],
  },

  // ── the older rows: still true, still pinned, cited by the docs ────────────
  {
    claim: 'Volume is multiplied by a buyer-diversity score, so one repeat counterparty is worth less.',
    file: 'pallets/emissions/src/lib.rs',
    snippet: 'let diversity_bps = diversity_score_bps(unique_buyers);',
  },
  {
    claim: 'A missing heartbeat decays an agent’s weight.',
    file: 'pallets/emissions/src/lib.rs',
    snippet: 'agents_pallet::Pallet::<T>::heartbeat_multiplier(who)',
  },
  {
    claim: 'An era cannot mint more than alpha times the qualifying escrow volume it settled.',
    file: 'pallets/emissions/src/lib.rs',
    snippet: 'let alpha_bps = T::AutoParams::emission_volume_alpha_bps() as u128;',
  },
  {
    claim: 'Volume from a ring-flagged provider does not count toward what an era may mint.',
    file: 'pallets/agents/src/lib.rs',
    snippet: 'if is_established && EraUniqueBuyers::<T>::get(agent) <= 1 {',
  },
  {
    claim: 'Escrow between two accounts that traded in both directions in one era does not qualify.',
    file: 'pallets/agents/src/lib.rs',
    snippet: 'if rev_era == this_era && rev_vol > Zero::zero() {',
  },
  {
    claim: 'Volume that can size an era’s emission is capped by the provider’s own locked stake.',
    file: 'pallets/agents/src/lib.rs',
    snippet: 'total.min(stake_ceiling)',
  },
  {
    claim: 'Registering as an agent starts the heartbeat clock.',
    file: 'pallets/agents/src/lib.rs',
    snippet: 'LastHeartbeat::<T>::insert(&who, now);',
  },
  {
    claim: 'The minimum qualifying volume gates the activity floor.',
    file: 'pallets/emissions/src/lib.rs',
    snippet: 'let qualifies_for_floor = is_active && (min_qual == 0 || vol_u128 >= min_qual);',
  },
  {
    claim: 'The devnet faucet only moves funds that already exist — it transfers, and has no mint path.',
    file: 'faucet/src/chain.ts',
    snippet: 'transferKeepAlive(dest, amountPlancks)',
  },
];

/** The brief's ledger, in its order. */
export const ledgerRows = sourceClaims.filter((row) => row.ledger).sort((a, b) => a.ledger - b.ledger);
