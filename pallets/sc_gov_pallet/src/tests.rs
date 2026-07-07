//! pallet-sc-gov unit tests
//! Run: cargo test -p pallet-sc-gov -- --nocapture

#![cfg(test)]

use crate::pallet::*;
use frame_support::{assert_noop, assert_ok, parameter_types, traits::ConstU32};
use sp_core::H256;
use sp_runtime::{
    traits::{BlakeTwo256, IdentityLookup},
    BuildStorage,
};

parameter_types! {
    pub const BlockHashCount: u64 = 250;
    pub const SS58Prefix: u16 = 42;
}

// ── Mock runtime ──────────────────────────────────────────────────────────────

type Block = frame_system::mocking::MockBlock<Test>;

frame_support::construct_runtime!(
    pub enum Test {
        System: frame_system,
        ScGov:  crate,
    }
);

impl frame_system::Config for Test {
    type BaseCallFilter = frame_support::traits::Everything;
    type BlockWeights = ();
    type BlockLength = ();
    type RuntimeOrigin = RuntimeOrigin;
    type RuntimeCall = RuntimeCall;
    type RuntimeTask = ();
    type Nonce = u64;
    type Hash = H256;
    type Hashing = BlakeTwo256;
    type AccountId = u64;
    type Lookup = IdentityLookup<Self::AccountId>;
    type Block = Block;
    type RuntimeEvent = RuntimeEvent;
    type BlockHashCount = BlockHashCount; // u64 — MockBlock uses u64 block numbers
    type DbWeight = ();
    type Version = ();
    type PalletInfo = PalletInfo;
    type AccountData = ();
    type OnNewAccount = ();
    type OnKilledAccount = ();
    type SystemWeightInfo = ();
    type SS58Prefix = SS58Prefix; // u16
    type OnSetCode = ();
    type MaxConsumers = ConstU32<16>;
    type ExtensionsWeightInfo = ();
    type SingleBlockMigrations = ();
    type MultiBlockMigrator = ();
    type PreInherents = ();
    type PostInherents = ();
    type PostTransactions = ();
}

impl crate::pallet::Config for Test {
    type RuntimeEvent = RuntimeEvent;
}

fn new_test_ext() -> sp_io::TestExternalities {
    frame_system::GenesisConfig::<Test>::default()
        .build_storage()
        .unwrap()
        .into()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn delegate_voting_stores_delegation_and_counts_vote() {
    new_test_ext().execute_with(|| {
        let delegator = 1u64;
        let delegate = 2u64;

        assert_ok!(ScGov::delegate_voting(
            RuntimeOrigin::signed(delegator),
            delegate
        ));

        assert_eq!(Delegations::<Test>::get(delegator), Some(delegate));
        assert_eq!(DelegateVoteCount::<Test>::get(delegate), 1);
    });
}

#[test]
fn delegate_voting_replaces_prior_and_rebalances_counts() {
    new_test_ext().execute_with(|| {
        let delegator = 1u64;
        let first = 2u64;
        let second = 3u64;

        assert_ok!(ScGov::delegate_voting(
            RuntimeOrigin::signed(delegator),
            first
        ));
        assert_eq!(DelegateVoteCount::<Test>::get(first), 1);

        assert_ok!(ScGov::delegate_voting(
            RuntimeOrigin::signed(delegator),
            second
        ));

        // old delegate loses the vote
        assert_eq!(DelegateVoteCount::<Test>::get(first), 0);
        // new delegate gains it
        assert_eq!(DelegateVoteCount::<Test>::get(second), 1);
        assert_eq!(Delegations::<Test>::get(delegator), Some(second));
    });
}

#[test]
fn multiple_delegators_to_same_delegate_accumulate() {
    new_test_ext().execute_with(|| {
        let delegate = 10u64;

        for delegator in [1u64, 2, 3] {
            assert_ok!(ScGov::delegate_voting(
                RuntimeOrigin::signed(delegator),
                delegate
            ));
        }

        assert_eq!(DelegateVoteCount::<Test>::get(delegate), 3);
    });
}

#[test]
fn remove_delegation_clears_storage_and_decrements_count() {
    new_test_ext().execute_with(|| {
        let delegator = 1u64;
        let delegate = 2u64;

        assert_ok!(ScGov::delegate_voting(
            RuntimeOrigin::signed(delegator),
            delegate
        ));
        assert_eq!(DelegateVoteCount::<Test>::get(delegate), 1);

        assert_ok!(ScGov::remove_delegation(RuntimeOrigin::signed(delegator)));

        assert_eq!(Delegations::<Test>::get(delegator), None);
        assert_eq!(DelegateVoteCount::<Test>::get(delegate), 0);
    });
}

#[test]
fn remove_delegation_noop_when_no_delegation_exists() {
    new_test_ext().execute_with(|| {
        // Should not panic or error when nothing to remove
        assert_ok!(ScGov::remove_delegation(RuntimeOrigin::signed(99)));
    });
}

#[test]
fn cannot_delegate_to_self() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            ScGov::delegate_voting(RuntimeOrigin::signed(1), 1),
            Error::<Test>::CannotDelegateToSelf
        );
    });
}

#[test]
fn delegation_count_helper_returns_correct_value() {
    new_test_ext().execute_with(|| {
        let delegate = 5u64;

        assert_eq!(ScGov::delegation_count(&delegate), 0);

        assert_ok!(ScGov::delegate_voting(RuntimeOrigin::signed(1), delegate));
        assert_ok!(ScGov::delegate_voting(RuntimeOrigin::signed(2), delegate));
        assert_eq!(ScGov::delegation_count(&delegate), 2);
    });
}
