---
project: MSourcing / ARIA
shift: 34
agent: codex-gpt-5
updated: 2026-07-13 00:26 EDT
status: store-wave-1a-green-local-main-one-commit-ahead-release-and-live-no-go
---

# Handoff - store contract boundary complete, action factories next

## Current state

- Continuation worktree:
  `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Branch: `main`.
- Current verified source commit:
  `316aecb3056a67ac908d0065070c0827560856e2`.
- Local `origin/main` tracking ref:
  `bc4633663c9a7ba3b3b4d52b7f3654384e471cb6`.
- The verified source commit is one source commit ahead of that tracking ref.
  This shift's Relay documentation commit follows it; run `git rev-parse HEAD`
  for the exact branch tip.
- The tracking ref advanced to `bc46336` through a push recorded in the local
  reflog at 2026-07-13 00:24:17 EDT. This Codex shift did not run that push.
  The actor and credential used are unknown. Do not treat the event as
  credential rotation or current remote verification.
- Source verdict for `316aecb`: GO.
- Release verdict: NO-GO.
- Production verdict: NO-GO.
- Detailed cross-agent execution plan:
  `_relay/2026-07-12-enterprise-refinement-plan.md`.
- Codex audit record:
  `_relay/codex-findings.md`.

## Done this shift

- Read the prior Relay Baton, vault rules, project learnings, and active plan.
- Followed the mandatory navigation order:
  - Graphify query could not run because `graphify-out/graph.json` is absent.
  - `graphify-out/wiki/index.md` is also absent.
  - Targeted raw source inspection began only after both surfaces were confirmed
    unavailable.
- Completed Workstream 1 Wave 1A in commit `316aecb`:
  - moved `HermesActions` and `HermesContextValue` from the 7,002-line
    coordinator into React-free `src/lib/store/contracts.ts`;
  - preserved `src/lib/store.ts` as the compatibility entry point;
  - preserved all 124 action signatures and all seven context fields;
  - reduced `src/lib/store.ts` to 6,608 lines without moving behavior;
  - removed the now-unused `ScoringWeights` import.
- Added `tests/store-contracts.mts`:
  - public type compatibility;
  - exact 124-name parity across contract, action object, and memo dependencies;
  - exact context shape;
  - real server-rendered `HermesProvider`, `useHermes`, `useActions`, and
    `useHydrated` behavior;
  - outside-provider failure behavior;
  - type-inclusive static import cycle graph;
  - value-only runtime cycle graph with literal dynamic imports;
  - positive two-node and self-cycle fixtures.
- Corrected both adversarial review findings before commit:
  - runtime and dynamic cycles are now distinct from type-only static cycles;
  - the hook negative assertion no longer risks printing full workspace state.
- Updated architecture and operational documentation to 135 chained commands:
  18 pretest plus 117 test commands.
- Independent review roles completed:
  - Senior Full-Stack Developer: GO.
  - Cybersecurity Analyst and Director: GO after closure fixes.
  - QA Lead and independent validator: GO.
  - Product and Project Manager with Fable-style challenge: GO.
- Exact final verification for the committed source snapshot:
  - `npx tsc --noEmit && npm test`: passed.
  - `npm test`: all 135 chained commands passed.
  - `tests/store-contracts.mts`: 10/10 passed.
  - `npm run lint`: passed.
  - `npm run build`: passed with 59/59 static pages.
  - `git diff --check`: passed before commit.
- Added audit findings for the old unguarded contract boundary and the
  failure-path state-log risk.
- Archived shift 33 to
  `_relay/archive/2026-07-13-0026-codex-gpt-5.md`.

## Blockers

1. **GitHub credential rotation is still unproven.** A prior GitHub CLI
   credential was exposed through process arguments. Revoke it, review access
   history, and issue a fresh least-privilege credential before authenticated
   GitHub work resumes.
2. **The 00:24 push actor is unknown.** The local tracking ref moved to
   `bc46336`, but this does not prove who pushed or which credential was used.
3. **Current source commit is not on the tracking ref.** `316aecb` remains one
   commit ahead of local `origin/main`.
4. **Fly credential rotation is still unproven.** Do not run production Fly
   mutations with the previously exposed credential.
5. **GitHub pre-runner cause is unknown.** Candidate CI run `29221158898` and
   CodeQL run `29221158901` failed within seconds. Exact annotations still
   need fresh authenticated inspection.
6. **Previous candidate is superseded.** `c3e94b2` does not include
   `316aecb`.
7. **Fly DB exact-image recovery remains network-blocked.** Alpine package
   indexes timed out. Do not weaken the patch layer or restart test.
8. **Owner-controlled release settings remain unverified.** Branch protection,
   environment review, administrator bypass, secret scopes, and bundle-secret
   removal need current evidence.
9. **Production is behind reviewed source.** Last public readiness proof reported
   build `d2040b...` and migration `0023`, not current migrations through
   `0025`.
10. **Enterprise behavior is not fully proven.** Two-user browser isolation,
    real email and official WhatsApp round trips, recovery, two restarts, first
    admin login, and final campaign acceptance remain open.

## Next steps

1. Commit this Relay, findings, plan, and learning update as a docs-only handoff.
2. Start Workstream 1 Wave 1B with the smallest action factory:
   - characterize campaign and intake actions first;
   - define explicit factory dependencies;
   - keep all public action names and hooks unchanged;
   - do not import React context from the factory;
   - run focused tests before the complete gate.
3. Continue Wave 1B one domain per commit:
   sourcing/enrichment, outreach/compliance, fleet/integrations, then
   chat/sessions/shared UI memory.
4. After action factories, build the tested workspace persistence adapter and
   canonical outreach projection resync path.
5. Revoke and rotate GitHub and Fly credentials. Record metadata only.
6. With fresh GitHub authentication:
   - verify actual remote `main` equals the expected tracking baseline;
   - inspect `origin/main..main`;
   - push `main` normally;
   - verify local, tracking, and remote refs match.
7. Capture exact CI and CodeQL annotations and repair only the proven cause.
8. Build a new release candidate containing current `main`.
9. Complete exact-SHA CI, CodeQL, recovery, protected approval, live migration,
   restart, first-admin, and zero-send acceptance gates.
10. Run deployed two-user Playwright isolation and controlled real-channel
    acceptance before any real candidate use.
11. Archive and rewrite this Baton at the next milestone.

## Decisions made (don't relitigate)

- `src/lib/store/contracts.ts` owns the React-free public store action and
  context contracts.
- `src/lib/store.ts` remains the compatibility import for existing callers.
- Wave 1A moved declarations and tests only; it intentionally moved no action
  behavior.
- Every action factory must receive explicit dependencies and must not import
  React context.
- Static type cycles and runtime/dynamic cycles are separate enforced graphs.
- Contract tests must not serialize `HermesState` on failure.
- Normalized outreach rows own delivery authority; `workspace_state` is a UI
  projection.
- Agent graph drafts remain run-history-only and have no delivery authority.
- Inbound candidate replies remain named-human-review work.
- No exposed credential may be reused.
- Source, release, and live evidence remain separate claims.

## Watch out

- The original OneDrive checkout is dirty and remains on
  `deploy/fly-github-actions`. Do not clean, reset, switch, or discard it.
- Work only in the integration worktree above unless a new isolated worktree is
  intentionally created.
- Do not put credentials into argv, process listings, logs, Relay, URLs, or
  fixtures.
- Do not infer that the 00:24 push makes authentication safe.
- Do not rerun stalled `npm ci` loops without first checking the registry path.
- Do not move the historical audit archive in the same commit as source work.
- Do not claim production readiness from local source gates or migration
  `0023`.
