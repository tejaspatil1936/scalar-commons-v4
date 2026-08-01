//! CLI dispatch — maps subcommands onto the service.
//!
//! Ported from `substrate/bin/node/cli/src/command.rs` at tag
//! `polkadot-stable2503`.
//!
//! `load_spec` is where the node meets `chain_spec.rs`. That file predates this
//! round and defines four genesis configurations; all four are reachable here:
//!
//! | `--chain` | function |
//! |---|---|
//! | `dev` | `development_config` |
//! | `local` | `local_testnet_config` |
//! | `staging` | `staging_testnet_config` |
//! | `sc-e1` | `sc_e1_fast_era_config` (fast-era, λ = 10) |
//!
//! `mainnet_genesis_config` is the fifth builder in that file. It is
//! intentionally NOT wired to a `--chain` id: it takes five arguments
//! (validator keys, founder allocations, two multisigs, a root key) that have
//! no defaults and must not be invented. It is called by whoever builds the
//! real mainnet spec.

use crate::{
    chain_spec,
    service::{self, new_partial, FullClient},
    Cli, Subcommand,
};
use sc_cli::{Result, SubstrateCli};
use sc_service::PartialComponents;
use scalar_commons_runtime::opaque::Block;
use std::sync::Arc;

impl SubstrateCli for Cli {
    fn impl_name() -> String {
        "Scalar Commons Node".into()
    }

    fn impl_version() -> String {
        env!("SUBSTRATE_CLI_IMPL_VERSION").into()
    }

    fn description() -> String {
        env!("CARGO_PKG_DESCRIPTION").into()
    }

    fn author() -> String {
        env!("CARGO_PKG_AUTHORS").into()
    }

    fn support_url() -> String {
        "https://github.com/scalar-commons/scalar-commons/issues/new".into()
    }

    fn copyright_start_year() -> i32 {
        2025
    }

    fn load_spec(&self, id: &str) -> std::result::Result<Box<dyn sc_service::ChainSpec>, String> {
        let spec = match id {
            "" =>
                return Err(
                    "Please specify which chain you want to run, e.g. --dev or --chain=local".into()
                ),
            "dev" => Box::new(chain_spec::development_config()),
            "local" => Box::new(chain_spec::local_testnet_config()),
            "staging" => Box::new(chain_spec::staging_testnet_config()),
            "sc-e1" => Box::new(chain_spec::sc_e1_fast_era_config()?),
            path =>
                Box::new(chain_spec::ChainSpec::from_json_file(std::path::PathBuf::from(path))?),
        };
        Ok(spec)
    }
}

/// Parse command line arguments into service configuration.
pub fn run() -> Result<()> {
    let cli = Cli::from_args();

    match &cli.subcommand {
        None => {
            let runner = cli.create_runner(&cli.run)?;
            runner.run_node_until_exit(|config| async move {
                service::new_full(config, cli).map_err(sc_cli::Error::Service)
            })
        },
        Some(Subcommand::Key(cmd)) => cmd.run(&cli),
        Some(Subcommand::Sign(cmd)) => cmd.run(),
        Some(Subcommand::Verify(cmd)) => cmd.run(),
        Some(Subcommand::Vanity(cmd)) => cmd.run(),
        Some(Subcommand::BuildSpec(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.sync_run(|config| cmd.run(config.chain_spec, config.network))
        },
        Some(Subcommand::CheckBlock(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, import_queue, .. } =
                    new_partial(&config)?;
                Ok((cmd.run(client, import_queue), task_manager))
            })
        },
        Some(Subcommand::ExportBlocks(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, .. } = new_partial(&config)?;
                Ok((cmd.run(client, config.database), task_manager))
            })
        },
        Some(Subcommand::ExportState(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, .. } = new_partial(&config)?;
                Ok((cmd.run(client, config.chain_spec), task_manager))
            })
        },
        Some(Subcommand::ImportBlocks(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, import_queue, .. } =
                    new_partial(&config)?;
                Ok((cmd.run(client, import_queue), task_manager))
            })
        },
        Some(Subcommand::PurgeChain(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.sync_run(|config| cmd.run(config.database))
        },
        Some(Subcommand::Revert(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.async_run(|config| {
                let PartialComponents { client, task_manager, backend, .. } = new_partial(&config)?;
                let aux_revert = Box::new(|client: Arc<FullClient>, backend, blocks| {
                    sc_consensus_babe::revert(client.clone(), backend, blocks)?;
                    sc_consensus_grandpa::revert(client, blocks)?;
                    Ok(())
                });
                Ok((cmd.run(client, backend, Some(aux_revert)), task_manager))
            })
        },
        Some(Subcommand::ChainInfo(cmd)) => {
            let runner = cli.create_runner(cmd)?;
            runner.sync_run(|config| cmd.run::<Block>(&config))
        },
    }
}
