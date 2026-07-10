---
project: MSourcing / ARIA
shift: 15
agent: codex
updated: 2026-07-10 10:06
status: wave2-rock-w3-exec-dashboard-tsc-clean
---

# Handoff - Wave 2 Rock W3 Exec Dashboard

## Current state
- Wave 2 Rock W3 is implemented in source:
  - `/exec` exists at `src/app/exec/page.tsx`.
  - `src/lib/exec-dashboard.ts` is the shared pure derivation used by the page and focused test.
  - The page is read-only and does not call store actions.
  - KPI tiles consume canonical W1 metrics through `globalKpis` and `realFunnelFacts`.
  - Per-platform and per-campaign funnels are derived through `realFunnelFacts`; campaign rows also pass canonical facts into `computeCampaignMetrics`.
  - Trend sparklines use `TrendSpark` and real candidate/outreach/reply/booking timestamps.
  - Wins feed reads `state.wins`; viewer sees first-name + role, admin sees full name.
  - Open rate renders `Not tracked yet` with the note that no email-open events exist.
  - Demo mode shows the banner `Demo data - synthetic`.
  - Admin-only export is gated through `execCanExport(role)` -> `can(role, "manage_settings")`.
- Navigation includes `/exec` in the Analyze section.

## Done this shift
- Required navigation:
  - `graphify query "MSourcing Wave-2 W3 exec dashboard canonical metrics"` failed because `graphify-out/graph.json` is absent.
  - `graphify-out/wiki/index.md` is absent.
  - Read `_relay/HANDOFF.md`, `.rocket-fuel/PLAN-wave2.md`, `.rocket-fuel/ROCKS-wave2.md`, `src/lib/metrics.ts`, `src/lib/store.ts`, RBAC/nav/page patterns, and focused test style before edits.
- Added `src/lib/exec-dashboard.ts`.
- Added `src/app/exec/page.tsx`.
- Added `/exec` nav entry in `src/components/app/nav.ts`.
- Added `tests/exec-dashboard.mts` covering:
  - canonical metrics agreement,
  - synthetic/dry-run/approved-unsent exclusion from live contact facts,
  - no `Math.random` and no hardcoded KPI literal assignments,
  - open-rate honesty text,
  - viewer/admin export and win-label behavior.
- Archived previous baton to `_relay/archive/2026-07-10-1006-codex.md`.
- Added project-local Codex learning in `_agent_state/codex/memory.json`.

## Blockers
- `npx tsx tests/exec-dashboard.mts` is blocked in this sandbox by IPC pipe permission:
  - `Error: listen EPERM: operation not permitted ... /T/tsx-501/...pipe`
- Workaround proof command succeeded with `node --import tsx tests/exec-dashboard.mts`.

## Verification
- `node --import tsx tests/exec-dashboard.mts` passed:
  - `RESULT exec-dashboard: 28 passed, 0 failed`
- `npx tsc --noEmit` passed with exit 0.
- `git diff --check -- src/lib/exec-dashboard.ts src/app/exec/page.tsx src/components/app/nav.ts tests/exec-dashboard.mts` passed with exit 0.

## Next steps
1. Visionary can run `npx tsx tests/exec-dashboard.mts` outside the sandbox if they want the exact proof command from the Wave-2 plan.
2. Rock W5 owns wiring all new focused tests into the full `npm test` chain and running `npx tsc --noEmit && npm test` plus lint.
3. Review and commit W3 separately from the existing W1/W2/W4 and `.rocket-fuel` dirty working-tree files if desired.

## Decisions made (don't relitigate)
- `metrics.ts` semantics were not changed for W3.
- `/exec` uses a shared pure derivation module so tests and UI cannot fork live KPI filters.
- Open rate remains a tracked gap, never a numeric metric.
- Admin export uses `manage_settings` as the existing admin-only permission boundary.
- The timing tile uses canonical `timeToFirstInterviewHours`; no separate time-to-source formula was invented because W1 exposes no canonical time-to-source metric.

## Watch out
- The working tree already had substantial pre-existing W1/W2/W4 and `.rocket-fuel` changes before this shift.
- `src/components/app/nav.ts` already included W2 Winlog work in the dirty tree; this shift only added `/exec` beside it.
- `tests/exec-dashboard.mts` is focused and not yet wired into `npm test`; Rock W5 owns test-chain wiring.
