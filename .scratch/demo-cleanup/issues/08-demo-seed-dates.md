# Demo seed: inconsistent dates in two widgets

Status: ready-for-agent

The seed is dated on a fixed clock (`SEED_NOW`, 2026-06-26, `src/lib/utils.ts`) for
hydration stability, but bookings start relative to the wall clock so the calendar shows
upcoming interviews. Two visible side effects in demo mode:

- **Time to first interview** shows about 3,272 h on the Command Center and Exec KPI tiles
  (booking start minus campaign creation spans the gap between the two clocks).
- **Candidates → Last activity** renders "Jun 18, 2026 ago" (a date with a relative suffix).

Done when both read sensibly in demo mode and the gate stays green.
