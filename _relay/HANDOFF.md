---
project: MSourcing / ARIA
shift: 469
agent: cursor-cloud
updated: 2026-11-21
status: console-feature-modules
---

# Handoff - Shift 469

## Current state

- Branch `cursor/console-feature-modules-271e` cut from `twa-odoo` at `e3fa3f59`. Michael's branches were not touched.
- `src/lib/store.ts` is 5516 lines (was 5941). It still owns hydration, the 118-action object, and the approval/send bodies that source-scan tests pin in this file.
- Console features live under `src/features/{pipeline,outreach,approvals,odoo-sync,reports,settings}` plus `src/features/api` (workspace-backed `ConsoleClient`).
- Gate green on this shift: `npm run typecheck`, `npm run typecheck:tests`, `npm run lint` (2 pre-existing warnings, 0 errors), `npm test` exit 0.
- Synthetic data only. No Go client is wired. `createWorkspaceConsoleClient` reads the current workspace snapshot.

## Done this shift

- Characterization suite `tests/console-feature-modules.mts` (registered in `tests/test-manifest.mjs`) locks read models, UI state machines, and the moved action factories. It was red before the modules existed.
- Pipeline candidate mutations and settings mutations moved to React-free factories: `src/features/pipeline/actions.ts`, `src/features/settings/actions.ts`. The store wires them and still lists every action by name.
- Pages now drive explicit reducers: candidates list, outreach queue, approval batch, reports selection, settings tab/accordion, exec period. Funnel reads `usePipelineBoard`.
- Settings accordion chrome moved to `src/features/settings/section.tsx`. Section `n=".."` markers stay in `src/app/settings/page.tsx`. `useDeliverApprovedLinkedIn(` stays in `src/app/outreach/page.tsx`.
- Odoo sync is a local preview plus an idle → preview → queued → recorded machine. The terminal phase is a local record of the preview. It does not call Odoo. An explicit `intake` selects LinkedIn Recruiter CSV, RSC/ATS, Job application, or Candidate-supplied. Unsanctioned sources and blank emails stay blocked.
- Feature hooks read through `createWorkspaceConsoleClient`. The reports page shows the preview counts and states that no record is written.
- `src/lib/store.ts` no longer imports the metrics and types the split left unused.

## Blockers

- None.

## Next steps

1. When `services/` aria-api is available, add a `ConsoleClient` with `backend: "go-api"` and keep these hooks on the interface. Do not switch the default off `workspace` until that client passes the same characterization tests.
2. Leave `approveOutreach`, `sendApprovedOutreach`, `rejectOutreach`, and `confirmManualSend` in `src/lib/store.ts` until the ledger PR says otherwise. Tests still slice those bodies out of this file.
3. Do not mount an Odoo sync screen. `useOdooSyncPreview` and the reports line are a read model only. The phase name is `recorded`, not a completed Odoo write.
4. Do not edit `extensions/linkedin-bridge`, autopilot, `src/lib/outreach-approval.ts`, or `src/lib/dispatch-outbound.ts` from this split.

## Decisions made (don't relitigate)

- Owner 2026-11-12 (shift 466): the presentation shows the "POC live". Pages that need an integration this install does not run are left out of the navigation, not deleted: `OUT_OF_POC_SCOPE` in `src/components/app/nav.ts`.
- Shift 466: a LinkedIn message recorded as sent (bridge or confirmed manual copy) is a real send (`dryRun: false`); the dry-run switch is email only.
- Owner 2026-11-09 (shift 463/464), ADR 0002: campaign autopilot may queue LinkedIn invitations from the owner's paired account under a standing approval. This shift did not change that code.
- Owner 2026-11-06: Apify stays retired. No stealth scraping.
- Owner 2026-11-03: no "hermes" in the code. Product is Aria. Vercel is dropped. Kong is replaced by Caddy. No local LLM.
- Tony 2026-11-20: this console split is behaviour-preserving. Current data stays behind `ConsoleClient`. LinkedIn/autopilot files and the approval ledger / dispatch modules are owned by other PRs. Where pages already import them, those imports stay.
- Ranking stays a suggestion. The Odoo preview does not reject a candidate in the workspace; it only marks the sync record blocked.

## Watch out

- `tests/store-contracts.mts` still parses the `actions` object inside `src/lib/store.ts` and expects 118 named members. Do not spread feature actions into that object.
- `tests/workspace-effectful-actions.mts`, `tests/outreach-guardrails.mts`, `tests/candidate-privacy.mts`, `tests/live-role-authority.mts`, and `tests/manual-suppression-sync.mts` still read action bodies from `src/lib/store.ts`.
- `tests/linkedin-bridge.mts` requires `useDeliverApprovedLinkedIn(` in `src/app/outreach/page.tsx`.
- `tests/tutorial-curriculum.mts` requires `n=".."` on `src/app/settings/page.tsx`.
- `tests/module-boundaries.mts` rejects import cycles, including type-only ones. Feature hooks may import the store. The store may import feature action factories. Do not import hooks from the store.
- A `useSlice` selector must return a stable reference. Feature hooks derive with `useMemo` on the slice.
- Store action count pin remains 118.
- Synthetic emails in the new Odoo examples use `@people.example.test`.
