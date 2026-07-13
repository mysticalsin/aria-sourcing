---
project: MSourcing / ARIA
shift: 33
agent: codex-gpt-5
updated: 2026-07-12 23:59 EDT
status: local-main-ahead-source-green-release-and-live-no-go
---

# Handoff - enterprise documentation and first source boundaries complete

## Current state

- Continuation worktree:
  `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Current branch: `main`.
- Current local source tip before this Relay commit:
  `e7136a2e858ad4eee7578aae173b405802d6a2a9`.
- Remote `main`: `e782610baf25c91a936a336b3bff049a181febfa`.
- Local `main` is four commits ahead:
  - `269776b` records the red release-candidate handoff.
  - `f52813f` establishes the enterprise developer documentation layer.
  - `5a6beda` centralizes delivery outcome policy and removes the replay type cycle.
  - `e7136a2` moves live candidate mapping out of the mock module.
- These commits are local only. They were not pushed because Git HTTPS delegates
  to the compromised GitHub CLI credential and SSH authentication is unavailable.
- Previous candidate `c3e94b2` remains pushed on
  `codex/deploy-release-sync-20260713`, but it is now behind local `main` and
  is not the final source candidate.
- Source verdict for local `e7136a2`: GO.
- Release verdict: NO-GO.
- Production verdict: NO-GO.
- Full execution plan:
  `_relay/2026-07-12-enterprise-refinement-plan.md`.

## Done this shift

- Followed the repository navigation order:
  - Graphify query failed because `graphify-out/graph.json` was absent.
  - `graphify-out/wiki/index.md` was also absent.
  - Raw source inspection began only after both navigation surfaces were
    confirmed unavailable.
- Ran three independent read-only reviews:
  - Documentation/Project Manager audit.
  - Senior Full-Stack architecture audit.
  - Fable-style adversarial requirement-to-evidence audit.
- Built current developer entry points:
  - `docs/ARCHITECTURE.md`.
  - `docs/TESTING.md`.
  - `CONTRIBUTING.md`.
  - `SECURITY.md`.
  - `production-readiness/README.md`.
  - `docs/operations/FLY_SIZING.md`.
- Corrected documentation and configuration drift:
  - README test total now derives to 134 commands.
  - canonical runbook now includes migrations `0024` and `0025`;
  - Agent graph run-history drafts are distinguished from inbound named-review
    drafts;
  - Docker bootstrap no longer claims migrations stop at `0015`;
  - Compose app default now matches GoTrue and the Docker guide at port 3000;
  - Supabase live setup now starts empty and does not claim synthetic seed data;
  - Vercel documents are clearly marked separate or legacy;
  - root deployment file is a short authority map.
- Extended executable documentation contracts:
  - `tests/docs-truth.mts`: 35/35.
  - `tests/repository-hygiene.mts`: 11/11.
- Archived the obsolete 23 KB root relay body at
  `_relay/archive/2026-06-27-claude-relay-baton.md`; the root file is now a
  compatibility pointer.
- Removed tracked machine-specific Graphify interpreter state and ignored
  generated Graphify output.
- Validated 117 Markdown files with zero missing internal relative-link targets.
- Added one shared delivery retry-safety policy at
  `src/lib/delivery-outcome.ts`. API-key email, OAuth email, WhatsApp, and SMS
  adapters now share the same HTTP 408/5xx ambiguity rule.
- Moved replay model types to
  `src/components/sessions/replay-model.ts`, removing the audit-pack to
  decision-replay component cycle.
- Moved live GitHub, Apollo, Seamless, and web candidate normalization to
  `src/lib/sourcing/candidate-mappers.ts`. `mock-ai.ts` is synthetic-only
  apart from compatibility re-exports.
- Verification after source changes:
  - `npx tsc --noEmit`: passed.
  - `npm run lint`: passed.
  - `npm test`: all 134 chained commands passed.
  - `npm run build`: passed with 59/59 static pages.
  - email ambiguity suite: 71/71.
  - sourcing suite: 46/46.
  - provider, channel, dispatch, web-lead, mock, docs, and repository focused
    suites passed.
  - `docker compose config --quiet`: passed.
- A separate `npm run build:isolated` attempt stalled in its fresh `npm ci`
  for more than five minutes and was interrupted. Direct `npm run build`
  passed in this unsynced worktree. Do not report the fresh isolated execution
  as green.
- Archived shift 32 to
  `_relay/archive/2026-07-12-2359-codex-gpt-5.md`.

## Blockers

1. **Compromised GitHub CLI credential.** It must be revoked and rotated before
   authenticated GitHub or HTTPS Git work resumes.
2. **Previously exposed Fly credential.** It also requires rotation before any
   production Fly mutation.
3. **Local main is not pushed.** Four verified commits plus this Relay work
   remain local until fresh authentication exists.
4. **GitHub pre-runner cause is unknown.** Previous candidate CI run
   `29221158898` and CodeQL run `29221158901` failed in seconds. Capture the
   exact annotations; do not reuse the obsolete budget diagnosis without proof.
5. **Previous candidate is superseded.** `c3e94b2` does not include the four
   local main commits. Build a new candidate only after main is safely pushed.
6. **Fly DB exact-image recovery remains network-blocked.** Alpine package
   indexes timed out. Do not weaken the patch or restart gate.
7. **Owner-controlled release settings remain unverified.** Default branch,
   protected release branch, required checks, administrator bypass, independent
   Production review, secret scopes, and `ARIA_DEPLOY_BUNDLE` removal need
   current evidence.
8. **Production is behind.** Last public readiness proof reported build
   `d2040b...` and migration `0023`, not current source through `0025`.
9. **Enterprise behavior is not fully proven.** Two-user browser isolation,
   real-channel round trips, recovery, two restarts, first-admin login, and
   final campaign acceptance remain open.

## Next steps

1. Revoke and rotate the GitHub CLI credential. Review access history and record
   rotation metadata only.
2. Revoke and rotate the Fly credential. Do not expose the replacement.
3. With fresh GitHub authentication:
   - verify `origin/main` remains `e782610b...`;
   - review `origin/main..main`;
   - push local `main` normally;
   - verify local, tracking, and remote refs are equal.
4. Inspect the exact CI and CodeQL failure annotations. Fix only the proven
   external or workflow-start cause.
5. Create a new release candidate from the current remote release baseline plus
   the updated verified main. Run the complete local source, security, database,
   build, and release-contract gates for its exact SHA.
6. Push the new candidate branch and require exact-SHA CI and CodeQL green.
7. Continue local maintainability work from
   `_relay/2026-07-12-enterprise-refinement-plan.md`:
   - store contracts and action factories;
   - canonical outreach projection/resync;
   - AgentSeat versus AgentSpec memory vocabulary;
   - typed workspace-access helper;
   - two-user Playwright acceptance.
8. Verify owner-controlled GitHub branch/environment protection and Production
   secret names without reading values.
9. Rerun `npm run test:fly-db-volume` on a network that reaches Alpine.
10. Preserve and inspect a disposable DB-volume clone and generate the exact
    recovery receipt.
11. Advance the protected release branch only after every candidate gate passes.
12. Deploy the exact SHA, verify digests and migration through `0025`, restart
    DB/Auth twice, provision/login the first admin, and run the zero-send
    synthetic campaign.
13. Run controlled email and official WhatsApp round trips with synthetic test
    identities before enabling real candidate use.
14. Archive and rewrite this Baton at the next milestone.

## Decisions made (don't relitigate)

- Current developer architecture lives in `docs/ARCHITECTURE.md`; the
  superseded production-readiness architecture is historical evidence.
- Current release instructions start at
  `production-readiness/README.md` and `DEPLOYMENT_RUNBOOK.md`.
- Generated Graphify output is machine-local and ignored unless a real graph is
  intentionally regenerated.
- Agent graph drafts remain run-history-only with no delivery authority.
- Inbound candidate replies remain named-human-review work.
- HTTP 408 and server failures are ambiguous provider outcomes.
- Live candidate mappers belong to the neutral sourcing domain, not mock code.
- The browser workspace document is a projection, not delivery or integration
  authority.
- Previous candidate `c3e94b2` is evidence of the pre-runner problem, not the
  final release candidate.
- No exposed credential may be reused.
- No production deploy occurs before exact-SHA checks, recovery evidence,
  protected approval, and live acceptance are green.

## Watch out

- The original repository checkout is dirty and on
  `deploy/fly-github-actions`. Do not clean, reset, switch, or discard it.
- Work only in the integration worktree above unless a new isolated worktree is
  explicitly created.
- Do not put credentials into argv, process listings, logs, Relay, URLs, or
  test fixtures.
- The local main commits are verified but unpushed. Preserve them.
- Do not rerun `npm ci` loops blindly while the registry path is stalled.
- Do not move the 51 superseded audit files in the same commit as source work.
- Do not claim production ready from source tests or readiness on migration
  `0023`.
