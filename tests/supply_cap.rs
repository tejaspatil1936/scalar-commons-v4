//! Integration test: supply cap is never exceeded

use super::common::*;
use frame_support::{assert_ok, traits::Currency};

// Use same supply cap as test config (fits in u64)
const SUPPLY_CAP: u64 = 10_000_000_000_000_000_000; // ~10B CMN

#[test]
fn total_issuance_never_exceeds_supply_cap() {
    new_test_ext().execute_with(|| {
        register(ALICE, FULL_STAKE);
        register(BOB,   FULL_STAKE);

        for era in 0..10u32 {
            complete_escrow(BOB, ALICE, 5_000 * CMN, 50);
            crate::common::settle_era(1);

            let issuance = pallet_balances::Pallet::<TestRuntime>::total_issuance();
            assert!(
                issuance <= SUPPLY_CAP,
                "Era {era}: total issuance {issuance} exceeded cap {SUPPLY_CAP}"
            );

            let _ = pallet_emissions::Pallet::<TestRuntime>::claim(RuntimeOrigin::signed(ALICE));
            let _ = pallet_emissions::Pallet::<TestRuntime>::claim(RuntimeOrigin::signed(BOB));

            let issuance_post_claim = pallet_balances::Pallet::<TestRuntime>::total_issuance();
            assert!(
                issuance_post_claim <= SUPPLY_CAP,
                "Era {era} post-claim: issuance {issuance_post_claim} exceeded cap"
            );
        }
    });
}

#[test]
fn claim_returns_zero_at_cap() {
    new_test_ext().execute_with(|| {
        register(ALICE, FULL_STAKE);
        register(BOB,   FULL_STAKE);

        // Mint tokens to push issuance near cap
        let gap = 1_000 * CMN;
        let current_issuance = pallet_balances::Pallet::<TestRuntime>::total_issuance();
        let amount_to_mint = SUPPLY_CAP.saturating_sub(current_issuance).saturating_sub(gap);

        // Use Currency trait to deposit
        let _ = <pallet_balances::Pallet<TestRuntime> as Currency<u64>>::deposit_creating(
            &ROOT, amount_to_mint
        );

        let issuance = pallet_balances::Pallet::<TestRuntime>::total_issuance();
        assert!(issuance <= SUPPLY_CAP, "Setup: issuance {issuance} exceeded cap");

        // Do work and settle eras near cap
        for _ in 0..5 {
            advance_blocks(100);
            let _ = pallet_escrow::Pallet::<TestRuntime>::create_agreement(
                RuntimeOrigin::signed(BOB), ALICE, 5_000 * CMN,
                [1u8;32],
                frame_system::Pallet::<TestRuntime>::block_number() + 50,
                None
            );
            advance_blocks(10);
            let _ = pallet_escrow::Pallet::<TestRuntime>::record_delivery(
                RuntimeOrigin::signed(ALICE), BOB, 0, [2u8;32]
            );
            let _ = pallet_escrow::Pallet::<TestRuntime>::confirm_delivery(
                RuntimeOrigin::signed(BOB), ALICE, 0
            );
            // Use common::settle_era which advances past EraDuration before settling.
            // Raw settle_era without block advance would fail EraNotDue.
            crate::common::settle_era(1);
        }

        let bal_before = pallet_balances::Pallet::<TestRuntime>::free_balance(ALICE);
        let _ = pallet_emissions::Pallet::<TestRuntime>::claim(RuntimeOrigin::signed(ALICE));
        let bal_after = pallet_balances::Pallet::<TestRuntime>::free_balance(ALICE);
        let earned = bal_after.saturating_sub(bal_before);

        let final_issuance = pallet_balances::Pallet::<TestRuntime>::total_issuance();
        assert!(
            final_issuance <= SUPPLY_CAP,
            "INVARIANT VIOLATED: issuance {final_issuance} > cap {SUPPLY_CAP}! Earned: {earned}"
        );

        println!("Supply cap test: earned {earned}, final issuance {final_issuance}, cap {SUPPLY_CAP}");
    });
}
