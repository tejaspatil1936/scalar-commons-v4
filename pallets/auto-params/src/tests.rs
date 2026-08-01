//! pallet-auto-params unit tests.
//!
//! `lib.rs` has always declared `#[cfg(test)] mod tests;`, but no backing file
//! ever existed in this repo's history — so `cargo test` failed to resolve the
//! module (E0583) before the workspace test build could even start. This file
//! satisfies that declaration without editing the pallet source.
//!
//! **There is no coverage here yet, and that gap is real.** The pallet's three
//! era-settlement rules (fee-bps adaptation, alpha/beta weighting, and the
//! eligibility floor) are currently exercised only indirectly, through the
//! emissions mock's `AutoParamsProvider`. Direct unit tests belong here; the
//! empty module is a marker for that work, not a substitute for it.

#![cfg(test)]
