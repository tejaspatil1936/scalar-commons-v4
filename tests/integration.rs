//! # Scalar Commons Integration Tests
//!
//! These tests run the full runtime (all 33 pallets) in a test environment.
//! Unlike unit tests which test one pallet in isolation, these tests validate
//! cross-pallet flows that are impossible to test in isolation.
//!
//! ## Running
//! ```bash
//! cargo test --test integration
//! ```
//!
//! ## Key flows tested
//! 1. `era_cycle_full` — register agents → work → era drain → claim
//! 2. `dispute_oracle_settlement` — escrow dispute → oracle vote → settlement
//! 3. `ring_detection_auto_response` — ring farming → auto-param fee increase
//! 4. `rank_promotion_chain` — full rank progression 0→1→2→3
//! 5. `supply_cap_enforcement` — emissions stop exactly at 100B CMN
//! 6. `orchestrator_aggregation` — sub-agents → orchestrator volume → claim

#![cfg(test)]

mod common;
mod era_cycle;
mod dispute_flow;
mod ring_detection;
mod rank_promotion;
mod supply_cap;
mod orchestrator_flow;
