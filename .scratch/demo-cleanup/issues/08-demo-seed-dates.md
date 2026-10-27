# Demo seed: inconsistent dates in two widgets

Status: done

The seed is dated on a fixed clock (`SEED_NOW`, 2026-06-26, `src/lib/utils.ts`) for
hydration stability, but bookings start relative to the wall clock so the calendar shows
upcoming interviews. Two visible side effects in demo mode:

- **Time to first interview** shows about 3,272 h on the Command Center and Exec KPI tiles
  (booking start minus campaign creation spans the gap between the two clocks).
- **Candidates → Last activity** renders "Jun 18, 2026 ago" (a date with a relative suffix).

Done when both read sensibly in demo mode and the gate stays green.

## Resolution (2026-10-27)

Seed booking start/end times now use SEED_NOW, matching campaign timestamps.
The demo calendar classifies those bookings against the same fixed clock; live
workspaces continue to use wall time. formatTimeAgo returns an absolute date
without a relative suffix once an activity is at least 30 days old.

Regression tests are in tests/scoring-metrics.mts. Existing browser-local demo
snapshots retain their saved bookings by design; Settings -> Reset demo reloads
the corrected seed. No live workspace dates or database records are rewritten.