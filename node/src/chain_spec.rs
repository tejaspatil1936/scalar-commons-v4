//! Scalar Commons chain specification.

// ImOnline removed from M1 runtime — session keys: Babe + Grandpa + AuthorityDiscovery only
// sp_authority_discovery::AuthorityId is the correct public type (pallet_authority_discovery::AuthorityId is private)
use sp_authority_discovery::AuthorityId as AuthorityDiscoveryId;
use sc_service::{ChainType, Properties};
use scalar_commons_runtime::{
    AccountId, Balance, RuntimeGenesisConfig,
    CMN, GENESIS_MINT,
    SessionKeys, BABE_GENESIS_EPOCH_CONFIG,
};
use sp_consensus_babe::AuthorityId as BabeId;
use sp_consensus_grandpa::AuthorityId as GrandpaId;
use sp_core::{sr25519, Pair, Public};
use sp_runtime::traits::{IdentifyAccount, Verify};

pub type ChainSpec = sc_service::GenericChainSpec;
type AccountPublic = <scalar_commons_runtime::Signature as Verify>::Signer;

// ─── Genesis allocation constants ────────────────────────────────────────────
pub const VALIDATOR_STASH_BOND:         Balance = 1_000_000 * CMN;
pub const VALIDATOR_CONTROLLER_BALANCE: Balance =    50_000 * CMN;
pub const GENESIS_AGENT_STAKE:          Balance =    10_000 * CMN;

pub const FOUNDERS_ALLOC:    Balance = 7_000_000_000 * CMN;
pub const RESEARCHERS_ALLOC: Balance = 3_000_000_000 * CMN;
pub const TREASURY_ALLOC:    Balance = 5_000_000_000 * CMN;
pub const BOOTSTRAP_ALLOC:   Balance = 3_000_000_000 * CMN;

const _: () = assert!(
    FOUNDERS_ALLOC + RESEARCHERS_ALLOC + TREASURY_ALLOC + BOOTSTRAP_ALLOC
    == 18_000_000_000 * CMN,
    "Genesis allocations must sum to GENESIS_MINT (18B CMN)"
);

// ─── Key generation helpers ──────────────────────────────────────────────────

fn get_from_seed<TPublic: Public>(seed: &str) -> <TPublic::Pair as Pair>::Public {
    TPublic::Pair::from_string(&format!("//{}", seed), None)
        .expect("static values are valid; qed")
        .public()
}

fn account_id_from_seed<TPublic: Public>(seed: &str) -> AccountId
where
    AccountPublic: From<<TPublic::Pair as Pair>::Public>,
{
    AccountPublic::from(get_from_seed::<TPublic>(seed)).into_account()
}

/// Generate session keys for a validator — 5-tuple (no ImOnline, removed M1).
/// Returns: (stash, controller, grandpa, babe, authority_discovery)
fn authority_keys_from_seed(seed: &str)
    -> (AccountId, AccountId, GrandpaId, BabeId, AuthorityDiscoveryId)
{
    (
        account_id_from_seed::<sr25519::Public>(&format!("{}//stash", seed)),
        account_id_from_seed::<sr25519::Public>(seed),
        get_from_seed::<GrandpaId>(seed),
        get_from_seed::<BabeId>(seed),
        get_from_seed::<AuthorityDiscoveryId>(seed),
    )
}

fn chain_properties() -> Properties {
    let mut p = Properties::new();
    p.insert("tokenSymbol".into(), "CMN".into());
    p.insert("tokenDecimals".into(), 12u32.into());
    p.insert("ss58Format".into(), 42u32.into()); // MAINNET BLOCKER: register unique SS58 prefix
    p
}

// ─── Development chain ────────────────────────────────────────────────────────

pub fn development_config() -> ChainSpec {
    ChainSpec::builder(
        scalar_commons_runtime::WASM_BINARY.expect("WASM binary not available"),
        Default::default(),
    )
    .with_name("Scalar Commons Development")
    .with_id("scalar-dev")
    .with_chain_type(ChainType::Development)
    .with_properties(chain_properties())
    .with_genesis_config_patch(dev_genesis(
        vec![
            authority_keys_from_seed("Alice"),
            authority_keys_from_seed("Bob"),
            authority_keys_from_seed("Charlie"),
        ],
        vec![
            account_id_from_seed::<sr25519::Public>("Alice"),
            account_id_from_seed::<sr25519::Public>("Bob"),
            account_id_from_seed::<sr25519::Public>("Charlie"),
        ],
        account_id_from_seed::<sr25519::Public>("Alice"),
    ))
    .build()
}

// ─── Local testnet chain ──────────────────────────────────────────────────────

pub fn local_testnet_config() -> ChainSpec {
    ChainSpec::builder(
        scalar_commons_runtime::WASM_BINARY.expect("WASM binary not available"),
        Default::default(),
    )
    .with_name("Scalar Commons Local Testnet")
    .with_id("scalar-local")
    .with_chain_type(ChainType::Local)
    .with_properties(chain_properties())
    .with_genesis_config_patch(dev_genesis(
        vec![
            authority_keys_from_seed("Alice"),
            authority_keys_from_seed("Bob"),
            authority_keys_from_seed("Charlie"),
        ],
        vec![
            account_id_from_seed::<sr25519::Public>("Alice"),
            account_id_from_seed::<sr25519::Public>("Bob"),
            account_id_from_seed::<sr25519::Public>("Charlie"),
            account_id_from_seed::<sr25519::Public>("Dave"),
            account_id_from_seed::<sr25519::Public>("Eve"),
            account_id_from_seed::<sr25519::Public>("Ferdie"),
        ],
        account_id_from_seed::<sr25519::Public>("Alice"),
    ))
    .build()
}

// ─── Staging testnet chain ────────────────────────────────────────────────────

pub fn staging_testnet_config() -> ChainSpec {
    ChainSpec::builder(
        scalar_commons_runtime::WASM_BINARY.expect("WASM binary not available"),
        Default::default(),
    )
    .with_name("Scalar Commons Staging")
    .with_id("scalar-staging")
    .with_chain_type(ChainType::Live)
    .with_properties(chain_properties())
    .with_genesis_config_patch(dev_genesis(
        vec![
            authority_keys_from_seed("Validator1"),
            authority_keys_from_seed("Validator2"),
            authority_keys_from_seed("Validator3"),
            authority_keys_from_seed("Validator4"),
            authority_keys_from_seed("Validator5"),
            authority_keys_from_seed("Validator6"),
            authority_keys_from_seed("Validator7"),
        ],
        (1..=10).map(|i| account_id_from_seed::<sr25519::Public>(&format!("User{i}")))
            .collect(),
        account_id_from_seed::<sr25519::Public>("SudoKey"),
    ))
    .build()
}

// ─── Genesis config builder ───────────────────────────────────────────────────

fn dev_genesis(
    initial_authorities: Vec<(AccountId, AccountId, GrandpaId, BabeId, AuthorityDiscoveryId)>,
    endowed_accounts: Vec<AccountId>,
    root_key: AccountId,
) -> serde_json::Value {
    let endowment: Balance = 1_000_000_000 * CMN;

    // V4: Genesis agents — 3 validators, each pre-registered with 10,000 CMN stake.
    // The onboarding_boost (10,000 bps for first 10 completions) is a runtime parameter,
    // not a genesis field — it activates automatically for any agent's first 10 completions.
    let genesis_agents: Vec<(AccountId, Balance, bool)> = endowed_accounts
        .iter()
        .take(3)
        .map(|a| (a.clone(), GENESIS_AGENT_STAKE, true))
        .collect();

    // V4: RankedCollective seeded with genesis validators at rank 1.
    // This forms the Technical Council from block 1.
    // Rank 1 = inducted into the collective; TC fast-track requires rank 3+
    // which is earned through completions + oracle accuracy over time.
    let ranked_members: Vec<serde_json::Value> = initial_authorities
        .iter()
        .take(3)
        .map(|(stash, ..)| serde_json::json!({ "who": stash, "rank": 1u32 }))
        .collect();

    let stakers: Vec<(AccountId, AccountId, Balance, pallet_staking::StakerStatus<AccountId>)> =
        initial_authorities.iter().map(|(stash, ctrl, ..)| {
            (stash.clone(), ctrl.clone(), VALIDATOR_STASH_BOND,
             pallet_staking::StakerStatus::Validator)
        }).collect();
