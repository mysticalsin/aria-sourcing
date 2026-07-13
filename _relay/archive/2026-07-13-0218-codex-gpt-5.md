---
project: MSourcing / ARIA
shift: 35
agent: codex-gpt-5
updated: 2026-07-13 01:02 EDT
status: store-wave-1b-campaign-green-local-main-release-and-live-no-go
---

# Handoff - campaign action boundary complete, sourcing factory next

## Current state

- Continuation worktree:
  `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Branch: `main`.
- Current verified source commit:
  `1450f858d50e0f53cdd323a730ec6b058b152899`.
- Local `origin/main` tracking ref:
  `bc4633663c9a7ba3b3b4d52b7f3654384e471cb6`.
- The verified source commit is three local commits ahead of that tracking ref:
  `316aecb`, `8775096`, and `1450f85`. This shift's Relay documentation
  commit follows the source commit; run `git rev-parse HEAD` for the branch tip.
- The tracking ref advanced to `bc46336` through a push recorded in the local
  reflog at 2026-07-13 00:24:17 EDT. This Codex shift did not run that push.
  The actor and credential used remain unknown.
- Source verdict for `1450f85`: GO.
- Release verdict: NO-GO.
- Production verdict: NO-GO.
- Detailed cross-agent execution plan:
  `_relay/2026-07-12-enterprise-refinement-plan.md`.
- Codex audit record:
  `_relay/codex-findings.md`.

## Done this shift

- Resumed shift 34 and followed the mandatory navigation order. Graphify and
  the generated wiki remained unavailable, so targeted raw source inspection
  continued from the already documented fallback.
- Completed Workstream 1 Wave 1B campaign/intake in `1450f85`:
  - added React-free `src/lib/store/campaign-actions.ts` for
    `setActiveCampaign`, `createCampaignFromAnalysis`, `updateCampaign`, and
    `regenerateQueries`;
  - added pure `src/lib/store/campaign-launch.ts` for complete, partial, and
    failed multi-role launch decisions;
  - kept all 124 public action names explicit and preserved the store
    compatibility entry point;
  - reduced `src/lib/store.ts` from 6,608 to 6,525 lines;
  - hoisted pure activity and metric helpers outside the provider render cycle;
  - made the shared commit boundary return a synchronous applied/rejected
    result while preserving ordered state-ref updates.
- Closed pre-existing campaign integrity and authorization defects:
  - live viewers are denied campaign mutations using the authoritative role
    ref, while demo role preview remains local;
  - create returns `null`, and update/query return `false`, when authority,
    workspace state, campaign identity, validation, or commit application
    fails;
  - campaign updates accept only status, previous status, JD, and scoring
    weights;
  - runtime projection rejects undefined fields, invalid enums, malformed
    warnings, invalid weights, immutable fields, and unknown campaign fields;
  - JD projection strips unknown top-level and nested warning fields before
    shared-state persistence;
  - status changes now produce a bounded campaign activity record.
- Closed caller false-success paths:
  - intake does not source or navigate after rejected creation;
  - campaign controls do not show success after rejected update/query work;
  - multi-role launch stops each failed sourcing wave;
  - aggregate success requires every requested role to be created and sourced;
  - partial creation and sourcing failures are reported separately.
- Added `tests/store-campaign-actions.mts` with 22 focused cases covering:
  explicit dependencies, stable memoization, caller rejection paths, commit
  rejection, authoritative viewer denial, exact field projection, malformed
  and sentinel inputs, re-scoring, query fallbacks, unrelated-campaign
  isolation, and the complete launch decision table.
- Updated the documented test chain to 136 commands: 18 pretest plus 118 test
  commands.
- Independent closure reviews on the exact final snapshot:
  - Senior Full-Stack Developer: GO after partial-launch aggregation fix.
  - QA Lead: GO after undefined-field, caller, commit-rejection, and failed-wave
    coverage.
  - Cybersecurity Analyst and Director: GO after canonical JD projection and
    sentinel stripping.
- Exact final verification for the committed source snapshot:
  - `npx tsc --noEmit && npm test`: passed.
  - `npm test`: all 136 chained commands passed.
  - `tests/store-campaign-actions.mts`: 22/22 passed.
  - `tests/store-contracts.mts`: 10/10 passed.
  - `npm run lint`: passed with zero warnings.
  - `npm run build`: passed with 59/59 static pages.
  - `tests/docs-truth.mts`: 35/35 passed after final documentation edits.
  - `tests/repository-hygiene.mts`: 11/11 passed after final documentation
    edits.
  - `git diff --check`: passed before the source commit and Relay update.
- Added Codex findings for broad campaign patch trust and false-success flows.
- Added the campaign-boundary lesson to `_agent_state/codex/memory.json`.
- Archived shift 34 to
  `_relay/archive/2026-07-13-0102-codex-gpt-5.md`.

## Blockers

1. **GitHub credential rotation is still unproven.** A prior GitHub CLI
   credential was exposed through process arguments. Revoke it, review access
   history, and issue a fresh least-privilege credential before authenticated
   GitHub work resumes.
2. **The 00:24 push actor is unknown.** The local tracking ref moved to
   `bc46336`, but this does not prove who pushed or which credential was used.
3. **Current source is not on the tracking ref.** `1450f85` and its two local
   ancestors after `bc46336` remain unpushed in this worktree.
4. **Fly credential rotation is still unproven.** Do not run production Fly
   mutations with the previously exposed credential.
5. **GitHub pre-runner cause is unknown.** Candidate CI run `29221158898` and
   CodeQL run `29221158901` failed within seconds. Exact annotations still need
   fresh authenticated inspection.
6. **Previous release candidate is superseded.** `c3e94b2` does not include
   `316aecb` or `1450f85`.
7. **Fly DB exact-image recovery remains network-blocked.** Alpine package
   indexes timed out. Do not weaken the patch layer or restart test.
8. **Owner-controlled release settings remain unverified.** Branch protection,
   environment review, administrator bypass, secret scopes, and bundle-secret
   removal need current evidence.
9. **Production is behind reviewed source.** Last public readiness proof
   reported build `d2040b...` and migration `0023`, not current migrations
   through `0025` or current source.
10. **Enterprise behavior is not fully proven.** Two-user browser isolation,
    real email and official WhatsApp round trips, recovery, two restarts, first
    admin login, and final campaign acceptance remain open.

## Next steps

1. Start the next Wave 1B domain with sourcing and enrichment:
   - run Graphify first and record the fallback if the graph remains absent;
   - characterize `sourceNextBatch` and the smallest synchronous candidate-add
     actions before moving code;
   - define explicit dependencies and authority/effect boundaries;
   - write the focused red test before the factory;
   - keep provider/network actions separate from pure state transitions;
   - require senior full-stack, QA, and security closure before commit.
2. Continue one action domain per source commit: outreach/compliance,
   fleet/integrations, then chat/sessions/shared UI memory.
3. After action factories, build the tested workspace persistence adapter and
   canonical outreach projection resync path.
4. Revoke and rotate GitHub and Fly credentials. Record metadata only.
5. With fresh GitHub authentication:
   - verify actual remote `main` equals the expected baseline;
   - review `origin/main..main` and the unknown push event;
   - push `main` normally;
   - verify local, tracking, and remote refs match.
6. Capture exact CI and CodeQL annotations and repair only the proven cause.
7. Build a new release candidate containing current `main`.
8. Complete exact-SHA CI, CodeQL, recovery, protected approval, live migration,
   restart, first-admin, and zero-send acceptance gates.
9. Run deployed two-user Playwright isolation and controlled real-channel
   acceptance before any real candidate use.
10. Archive and rewrite this Baton at the next milestone.

## Decisions made (don't relitigate)

- `src/lib/store/contracts.ts` owns the React-free public store action and
  context contracts.
- `src/lib/store.ts` remains the compatibility import for existing callers.
- `src/lib/store/campaign-actions.ts` owns the four campaign/intake actions.
- `src/lib/store/campaign-launch.ts` owns pure multi-role launch aggregation.
- Every action factory receives explicit dependencies and imports no React
  context.
- Campaign mutations use the authoritative live role, not shared-state role
  data, and return an explicit application result.
- Campaign update inputs are runtime projected even when TypeScript has already
  narrowed the caller.
- Multi-role launch success means every requested role was created and fully
  sourced; partial completion is never success.
- Static type cycles and runtime/dynamic cycles remain separate enforced graphs.
- Contract and action tests must not serialize `HermesState` on failure.
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
- Do not run `git push` until fresh credentials and remote identity are proven.
- Do not weaken runtime projection because callers are typed; browser state is
  untrusted at the persistence boundary.
- Do not make a factory both provider-effectful and a pure state reducer.
- Do not move the historical audit archive in the same commit as source work.
- Do not claim production readiness from local source gates or migration
  `0023`.
