//! Referenda track configuration for Scalar Commons V4.
//!
//! Track 0: Agents (fast) — 24h decision, ranked-collective electorate
//! Track 1: Network       — 7-day decision, majority stake
//! Track 2: Root          — 20-day decision, super-majority
//!
//! Support floors use absolute Permill parts to be reachable at launch:
//!   Track 0: 2 ppm  = 0.0002% = ~36K CMN  (founders + validators from day 1)
//!   Track 1: 100 ppm = 0.01%  = ~1.8M CMN  (validators accumulate in ~2 days)
//!   Track 2: 1000 ppm = 0.1%  = ~18M CMN   (validators accumulate in ~15 days)
//!
//! This ensures governance is operational before sudo is removed on day 14.

use pallet_referenda::{Curve, TrackInfo};
use sp_arithmetic::Permill;
use sp_runtime::str_array as s;

const ERA_BLOCKS: u32 = 3_600; // 6-hour era

pub struct TracksInfo;

impl pallet_referenda::TracksInfo<crate::RuntimeCall, crate::BlockNumber> for TracksInfo {
    type Id = u16;
    type RuntimeOrigin = <crate::Runtime as frame_system::Config>::RuntimeOrigin;

    fn tracks() -> &'static [(Self::Id, TrackInfo<crate::Balance, crate::BlockNumber>)] {
        static TRACKS: [(u16, TrackInfo<crate::Balance, crate::BlockNumber>); 3] = [
            // ── Track 0: Agents (fast parameter changes via ranked-collective) ──
            (
                0,
                TrackInfo {
                    name: s!("agents"),
                    max_deciding:         10,
                    decision_deposit:     500 * crate::CMN,
                    prepare_period:       ERA_BLOCKS,        // 6h
                    decision_period:      4 * ERA_BLOCKS,    // 24h
                    confirm_period:       ERA_BLOCKS,        // 6h confirmation
                    min_enactment_period: ERA_BLOCKS,        // 6h minimum
                    min_approval: Curve::LinearDecreasing {
                        length: Permill::from_percent(100),
                        floor:  Permill::from_percent(50),
                        ceil:   Permill::from_percent(80),
                    },
                    // 2 ppm = ~36K CMN. Reachable if any founder participates.
                    min_support: Curve::LinearDecreasing {
                        length: Permill::from_percent(100),
                        floor:  Permill::from_parts(2),      // ~36K CMN at genesis
                        ceil:   Permill::from_percent(10),
                    },
                },
            ),
            // ── Track 1: Network (general governance, parameters, treasury) ───
            (
                1,
                TrackInfo {
                    name: s!("network"),
                    max_deciding:         5,
                    decision_deposit:     5_000 * crate::CMN,
                    prepare_period:       2 * ERA_BLOCKS,    // 12h
                    decision_period:      28 * ERA_BLOCKS,   // 7 days
                    confirm_period:       4 * ERA_BLOCKS,    // 24h
                    min_enactment_period: 4 * ERA_BLOCKS,    // 24h
                    min_approval: Curve::LinearDecreasing {
                        length: Permill::from_percent(100),
                        floor:  Permill::from_percent(50),
                        ceil:   Permill::from_percent(67),
                    },
                    // 100 ppm = ~1.8M CMN. Validators accumulate in ~2 days.
                    min_support: Curve::LinearDecreasing {
                        length: Permill::from_percent(100),
                        floor:  Permill::from_parts(100),    // ~1.8M CMN at genesis
                        ceil:   Permill::from_percent(25),
                    },
                },
            ),
            // ── Track 2: Root (runtime upgrades, sudo removal) ───────────────
            (
                2,
                TrackInfo {
                    name: s!("root"),
                    max_deciding:         2,
                    decision_deposit:     50_000 * crate::CMN,
                    prepare_period:       8 * ERA_BLOCKS,    // 2 days
                    decision_period:      80 * ERA_BLOCKS,   // 20 days
                    confirm_period:       8 * ERA_BLOCKS,    // 2 days
                    min_enactment_period: 8 * ERA_BLOCKS,    // 2 days
                    min_approval: Curve::LinearDecreasing {
                        length: Permill::from_percent(100),
                        floor:  Permill::from_percent(75),
                        ceil:   Permill::from_percent(100),
                    },
                    // 1000 ppm = ~18M CMN. Validators accumulate in ~15 days.
                    // Ensures sudo removal referendum (day 14) can pass with
                    // validator emissions + any founder participation.
                    min_support: Curve::LinearDecreasing {
                        length: Permill::from_percent(100),
                        floor:  Permill::from_parts(1_000),  // ~18M CMN at genesis
                        ceil:   Permill::from_percent(50),
                    },
                },
            ),
        ];
        &TRACKS
    }

    fn track_for(id: &Self::Id) -> Option<&'static TrackInfo<crate::Balance, crate::BlockNumber>> {
        Self::tracks()
            .iter()
            .find_map(|(track_id, info)| if track_id == id { Some(info) } else { None })
    }
}
