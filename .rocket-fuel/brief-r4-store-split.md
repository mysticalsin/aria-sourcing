You are the Integrator building release Rock R4 in the MSourcing repo. workspace-write. Owner standard: enterprise-ready, senior-dev-clear, no slop. This is the PRECISE store.ts split a structure audit scoped — the payoff extraction (~1,300 lines of pure logic out, ZERO importer churn). Do NOT do more than specified; the 132 useCallbacks stay put (mechanical churn with regression risk, no comprehension gain).

Objective: lift the already-pure, already-test-targeted blocks out of the 6,925-line src/lib/store.ts into focused modules under src/lib/store/, with store.ts re-exporting everything so none of the 91 importers change.

Read first: (understand before editing)
- src/lib/store.ts — the monolith. Verified pure blocks to extract (audit line refs; confirm exact current ranges before cutting — R1/R2 may have shifted them by a few lines, so locate by SYMBOL not line number):
  * migrations: migrateToCurrentVersion / normalizeHermesState / loadState (~767-971) → src/lib/store/migrations.ts
  * winlog: deriveWinRecord + WinRecord helpers (~660-760) → src/lib/store/winlog-derive.ts
  * booking solver: defaultSlot / interviewerIsBusy / resolveBookingSlot (~6501-6587) → src/lib/store/booking-slot.ts
  * sourcing helpers: baseWebQuery / parseSillageIdentifier / mapSillageCandidates (~164-260) → src/lib/store/sourcing-helpers.ts
- Tests that import these directly (must keep passing WITHOUT changing their import path if it's from @/lib/store): tests/winlog.mts (deriveWinRecord), tests/memory-soul.mts + tests/audit-fixes.mts (migrateToCurrentVersion/normalizeHermesState). Confirm each test's import specifier.
- The HermesActions interface + selector hooks: audit suggested extracting the interface to store/contract.ts and hooks to store/hooks.ts. Do this ONLY IF it can be done with zero cycle risk and zero importer change; if there's any provider<->hooks cycle risk, SKIP the hooks/contract extraction and keep just the 4 pure-logic extractions (that is the safe, high-value core). State in your report which you did.

Build:
1. Create src/lib/store/ with the 4 pure modules above. Move the functions verbatim (adjust only their own imports). Each module: single responsibility, its own imports, no React.
2. src/lib/store.ts imports from the new modules AND re-exports every symbol it previously exported (so `import { deriveWinRecord } from "@/lib/store"` still works — verify each extracted symbol that any test/consumer imports from @/lib/store is re-exported). No consumer import path changes.
3. Do NOT touch the 132 useCallback actions, the HermesProvider body, or behavior. This is a pure move + re-export.

Constraints: (what must NOT change) zero behavior change; zero consumer import-path change (91 importers untouched); every existing test passes unchanged; no new deps. If any extraction risks a circular import, keep that block in store.ts and note it — correctness over completeness.

Proof: the whole existing gate is the proof — `npx tsc --noEmit` clean and `npm test` fully green (the tests that import the moved symbols from @/lib/store must pass unchanged, proving the re-exports work). Additionally: `wc -l src/lib/store.ts` is meaningfully smaller (report before/after). No new test needed — this is a refactor whose proof is the unchanged green gate. The Visionary runs the full gate outside the sandbox.

Stop when: the 4 pure modules exist under src/lib/store/, store.ts re-exports all moved symbols, tsc clean, and you have NOT changed behavior or consumer import paths. Do not delete, skip, weaken, or narrow tests to make the goal pass.

Report: give the tsc result + store.ts line count before/after + which extractions you did vs skipped-for-cycle-safety. SHIP = extracted + re-exported + tsc clean; REVISE = blocked (why).
End with EXACTLY one line, nothing after it: VERDICT: SHIP or VERDICT: REVISE
