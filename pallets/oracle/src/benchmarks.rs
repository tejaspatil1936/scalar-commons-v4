// Benchmarks scaffold for pallet-oracle — compile-only, replaced by real measurements pre-mainnet.
#![cfg(feature = "runtime-benchmarks")]

use frame_benchmarking::v2::*;

use crate::pallet::Pallet;

#[benchmarks]
mod benchmarks {
    use super::*;

    #[benchmark]
    fn create_oracle_request() {
        #[block]
        {}
    }

    #[benchmark]
    fn submit_response() {
        #[block]
        {}
    }

    #[benchmark]
    fn finalise_request() {
        #[block]
        {}
    }

    #[benchmark]
    fn expire_request() {
        #[block]
        {}
    }

    #[benchmark]
    fn batch_submit_response() {
        #[block]
        {}
    }

    impl_benchmark_test_suite!(Pallet, crate::tests::new_test_ext(), crate::tests::Test);
}
