---
project: MSourcing / ARIA
shift: 32
agent: codex-gpt-5
updated: 2026-07-12 23:19 EDT
status: candidate-pushed-local-green-remote-ci-red-production-not-reviewed-release
---

# Handoff - release candidate proven locally; remote CI and release controls remain closed

## Current state

- Clean continuation worktree: `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Current branch: `main`.
- Local `main` contains this Relay-only handoff commit and is ahead of remote `main` by one commit. It was not pushed because Git HTTPS authentication is delegated to the now-compromised GitHub CLI credential and SSH authentication is unavailable.
- Candidate SHA: `c3e94b2b5694825c613e127a69c811f7935a1dd8`.
- Candidate combines the remote production-workflow baseline `128b03678fc4619fdf4572e0579b1a80994e2493` with verified `main` at `e782610baf25c91a936a336b3bff049a181febfa`.
- Remote candidate ref equals local HEAD at `c3e94b2`.
- Remote protected-release ref `deploy/fly-github-actions` is still `128b036`; it was not advanced.
- Remote `main` is `e782610`.
- GitHub default branch is still `vercel-demo` at `14f76f1`, not `main`. That tip does not contain the production deploy workflow.
- Source verdict: GO locally for the candidate.
- Production verdict: NO-GO. Exact-SHA CI and CodeQL are red, the protected release ref is not the candidate, production is on an older build and migration ledger, recovery evidence is incomplete, and owner-controlled controls are not reverified.

## Done this shift

- Created `codex/deploy-release-sync-20260713` from the clean remote release baseline and merged verified `main` without touching the dirty root checkout.
- Pushed the candidate branch normally. Local HEAD and the remote candidate ref were reverified equal.
- Ran the full local candidate gate:
  - `npx tsc --noEmit`: passed.
  - `npm run lint`: passed.
  - `npm run test:security`: passed, including agent-memory authority 56/56 and Hermes cloud authority 40/40.
  - `npm test`: passed, including all infrastructure pretests, application suites, and isolated build 6/6.
  - `npm run test:db-cross-channel-cap`: `concurrent_claims=1 active_claims=1 ambiguous=blocked deadlock=none privileges=service-only`.
  - `npm run test:db-agent-memory`: `authority=pass isolation=pass quarantine=hash-only receipts=content-free concurrency=pass idempotence=pass`.
  - `npm run test:db-privileges`: `postgres=restricted-direct supabase_admin=direct cross_owner=denied rotation=pass idempotence=pass empty_preflight=read-only legacy_preflight=read-only complete_preflight=read-only legacy_baseline=approved ledger=filename-sha secret_leak=none`.
  - Full-history Gitleaks scan: 265 commits, no findings.
  - `git diff --check`: passed.
- A fresh `npm audit` registry query hung on the intermittent network and was interrupted. The lockfile is unchanged from the prior zero-vulnerability result; do not claim a fresh audit pass.
- Re-ran `npm run test:fly-db-volume` twice. Both runs failed before recovery assertions at `docker/db/Dockerfile.fly:12`: Alpine 3.23 main and community APK index requests timed out, then APK exited 99 with stale/unavailable repositories. No mirror pin, patch bypass, or `--force-missing-repositories` was accepted.
- Verified exact-SHA GitHub results for `c3e94b2`:
  - CI run `29221158898`: failure, created 2026-07-13 03:11:59 UTC, completed 03:12:07 UTC.
  - CodeQL run `29221158901`: failure, created 2026-07-13 03:11:59 UTC, completed 03:12:03 UTC.
  - The 4 to 8 second duration is consistent with failure before meaningful test execution. The exact annotation is unknown because the job and check-run endpoints timed out. Do not relabel this as the obsolete Actions-budget diagnosis without the actual annotation.
- Verified the candidate cannot be deployed from its current ref. The workflow requires `refs/heads/deploy/fly-github-actions`, a protected ref, workflow SHA equal to the requested release SHA, exact-SHA CI and CodeQL, independent Production approval, recovery-receipt evidence, exact image promotion, and terminal acceptance evidence.
- Ran three live public probe cycles:
  - Application root returned HTTP 307 in all three cycles.
  - `/api/ready` returned HTTP 200 in all three cycles.
  - The readiness body reported build `d2040b534177f5bd2abb28f22de19af57b58dc3a`, migration `0023_conversation_identity.sql`, and database/auth/queue/migration/releaseIdentity all true.
  - Unauthenticated Kong Auth and REST requests returned HTTP 401 in all three cycles, proving the gateway rejected missing API authority rather than returning the previous 503.
  - Kong root returned HTTP 404 once and hit workstation connect timeouts twice. Root is not an application health contract.
- Confirmed production is not the reviewed candidate. The candidate contains migrations `0024_cross_channel_claim_serialization.sql` and `0025_agent_memory_authority.sql`; live readiness reports only `0023`.
- Tried an independent browser path for GitHub evidence. The signed-out browser could not access the private repository, and no signed-in browser connection was available.
- Security incident: a diagnostic helper placed the GitHub CLI credential in a process argument, making it visible to local process inspection. Matching processes were terminated, authenticated GitHub access was stopped, and the credential value is not stored here. Treat it as compromised and rotate it before any further release action.
- Archived the previous Baton to `_relay/archive/2026-07-12-2319-codex-gpt-5.md`.
- Returned the integration worktree to `main` and reran the mandatory `npx tsc --noEmit && npm test` gate. It passed, including every infrastructure pretest, application suite, and isolated build 6/6.
- Committed the Relay archive, fresh Baton, audit findings, and project learning locally. Push was deliberately withheld until GitHub credential rotation; do not use the exposed credential to publish it.

## Blockers

1. **GitHub credential rotation is now mandatory.** Revoke the exposed GitHub CLI credential, issue a replacement with least privilege, review account/repository access logs, and record rotation metadata only.
2. **Exact-SHA GitHub checks are red.** CI run `29221158898` and CodeQL run `29221158901` both failed. The exact pre-runner annotation must be captured and fixed before rerun.
3. **Workflow discovery and protected release posture are wrong or unknown.** Default remains `vercel-demo`, where the deploy workflow is absent. Current release-branch protection, required checks, administrator bypass, Production reviewers, and deploy-branch restriction require owner re-verification.
4. **Fly DB volume recovery gate is network-blocked.** The exact DB image cannot build while Alpine indexes are unreachable. Do not weaken the CVE patch layer or recovery assertions.
5. **Secret and recovery gates are incomplete.** Rotate the previously exposed Fly token, remove repository-level `ARIA_DEPLOY_BUNDLE`, verify split Production secret names without reading values, preserve and inspect a disposable `aria_db_data` clone, and produce the exact release-bound recovery receipt.
6. **Production is behind the candidate.** Live readiness is healthy for build `d2040b...` at migration `0023`, not candidate `c3e94b2` with migrations `0024` and `0025`.
7. **Full live acceptance is not complete.** Two controlled DB/Auth restarts, exact running digests, first-admin provisioning and login, and the authenticated synthetic zero-send campaign remain unproven for the candidate.

## Next steps

1. Revoke and rotate the compromised GitHub CLI credential. Inspect GitHub security and audit history for use after 2026-07-13 03:11 UTC. Store no credential value in Relay.
2. With the fresh credential, verify local `main` is exactly one Relay-only commit ahead of `origin/main`, review the diff, and push it normally. Do not amend production source into this handoff commit.
3. Open CI run `29221158898` and CodeQL run `29221158901` in GitHub. Capture the exact top-level and job annotations. Repair only that account, policy, workflow-start, or action-resolution cause.
4. Rerun CI and CodeQL for exact `c3e94b2`. Require Quality, Dependency audit, Secret scan, Database security, Production image supply chain, aggregate Release gate, CodeQL, and zero open high/critical code-scanning alerts.
5. Set the intended default-branch posture so the production workflow is discoverable. Verify `deploy/fly-github-actions` protection, required exact-SHA checks, PR/review rules, no administrator bypass, independent Production reviewer, and deploy-branch restriction.
6. Verify repository-level `ARIA_DEPLOY_BUNDLE` is absent and all split credentials exist only at Production scope. Inspect names and authority only, never values.
7. Rerun `npm run test:fly-db-volume` from a network that can fetch Alpine indexes. Require the exact image, existing-data detection, legacy-root fail-closed behavior, and two-restart persistence proof.
8. Preserve and inspect a disposable clone of `aria_db_data`. Generate the recovery receipt bound to exact release `c3e94b2`, its approved recovery target, and receipt digest.
9. Only after steps 1 through 8 are green, fast-forward `deploy/fly-github-actions` to `c3e94b2`, allow the required checks to pass on that protected ref, and dispatch the protected workflow for the exact SHA.
10. Verify registry and running image digests, SBOM and provenance attestations, immutable evidence artifacts, deployed build identity, and full migration ledger through `0025`.
11. Run live acceptance: stable application/login/health/readiness, authenticated Kong REST and Auth health, DB/Auth inventory, two controlled restarts, first-admin provisioning/login, then the synthetic zero-send campaign.
12. Confirm the campaign stores owner-bound run/event/memory receipts, retains drafts only in run history, and creates zero provider outbox rows or sends.
13. Archive this Baton and rewrite it with exact outputs. Mark production ready only after every gate above is proven.

## Decisions made (don't relitigate)

- `main` is the integration branch requested by Tony. Production deploy authority remains isolated on the protected release branch.
- The candidate-first sequence is mandatory: exact-SHA checks on `c3e94b2`, then protected release fast-forward, then protected dispatch.
- Red pre-runner checks are release failures even when all local gates pass.
- Live build `d2040b...` is not evidence for candidate `c3e94b2`.
- HTTP 401 from unauthenticated Kong routes is not a backend health proof. Use authenticated workflow acceptance and `/api/ready`.
- No source workaround is accepted for external package-network failure.
- Do not use any exposed GitHub, Fly, or provider credential. Rotate first.
- Do not decode or use `ARIA_DEPLOY_BUNDLE`; replace it with split Production-scoped secrets.
- No deploy occurs until exact-SHA checks, recovery evidence, owner-controlled gates, and live acceptance are green.

## Watch out

- The original repository checkout is dirty and on `deploy/fly-github-actions`. Do not clean, reset, switch, or discard anything there.
- Return the integration worktree to `main` after committing this handoff. Keep main clean.
- OneDrive can distort builds; continue using the isolated build gate.
- Do not infer a CI root cause from a short failed duration. Capture the exact GitHub annotation.
- Do not put credentials into command arguments, process listings, Relay, logs, or issue text.
- A successful `/api/ready` on migration `0023` does not close the candidate deployment gate.
- Do not weaken Alpine package installation or recovery checks to manufacture a green result.
