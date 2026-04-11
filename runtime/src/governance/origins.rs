//! Custom governance origins for Scalar Commons v3.
//!
//! Track 0: AgentsCollective — Rank 2+ agents propose/vote on bounded params
//! Track 1: GeneralAdmin    — majority stake governs network policy  
//! Track 2: Root            — structural changes, runtime upgrades

use crate::Runtime;
use frame_support::traits::{EitherOf, EnsureOrigin};
use frame_system::EnsureRoot;

/// Origin for Track 0: Ranked-collective members (Rank 2+).
/// Bounded parameter changes only.
pub type AgentsCollectiveOrigin =
    pallet_ranked_collective::EnsureRanked<Runtime, (), 2>;

/// Origin for Track 1: Standard staking-based governance.
pub type GeneralAdminOrigin = EnsureRoot<crate::AccountId>;

/// Either ranked-collective OR root — used for Track 0 proposals
/// so that sudo (pre day-90) can also execute urgent changes.
pub type AgentsOrRoot = EitherOf<AgentsCollectiveOrigin, EnsureRoot<crate::AccountId>>;
