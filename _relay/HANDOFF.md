---
project: MSourcing / ARIA
shift: 31
agent: codex-gpt-5
updated: 2026-07-12 22:52 EDT
status: main-pushed-local-gates-green-production-acceptance-pending
---

# Handoff - runtime authority repaired; production release still gated

## Current state

- Worktree for continuation: `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Branch: `main`.
- Verified source merge: `01721dcbe041b5a9c7d71a37a2ff90bd212139f6` (`merge agent spec runtime authority hardening`).
- Local `main` includes explicit revert `7e6d1aa` of unsafe reviewer push `b205293`, then the independently reviewed replacement through `35d17ed`.
- GitHub connectivity recovered at 22:48 EDT. `git ls-remote` proved remote `main` was still `b205293`, then a normal non-force push advanced it through the explicit revert, reviewed replacement, and Relay commits to `352de32cc444aec38450e4cfe2f65fe06bdb511b`.
- The final Relay-only descendant was pushed normally and `HEAD`, `origin/main`, and `git ls-remote` were reverified equal with a clean worktree. Obtain the exact tip with those commands; it is intentionally not embedded in its own Baton.
- Source/runtime verdict: GO locally. Production verdict: NO-GO until remote, protected-release, recovery, and live acceptance gates below pass.
- Default GitHub branch was last verified as `vercel-demo`, not `main`. The protected production workflow must exist on the default branch before manual dispatch can work.

## Done this shift

- Diagnosed the stored AgentSpec execution gap and captured RED tests before implementation.
- Rejected and explicitly reverted reviewer commit `b205293`, which failed open from unsupported channels to Email and wrote first-touch drafts into the reply outbox with the wrong semantic type.
- Implemented the replacement in isolated branch `codex/agent-spec-runtime-authority-20260712`:
  - requires exact active owner-bound `specId` for live graph runs;
  - validates the stored role brief, exact Email-only channel, strict known guardrails, and unknown authority fields before run receipt, memory, vault, or model access;
  - stores the exact execution policy before memory decryption or provider egress;
  - records `draftStorage=run_history` and `deliveryAuthority=none`; it creates no approval queue and never writes `messages_outbound`;
  - rechecks active owner-bound spec status before every graph step;
  - makes create, patch, list eligibility, Studio, and run behavior agree;
  - marks paused, other-owner, legacy-invalid, and unsupported specs as blocked with a reason;
  - limits new Studio specs to the one channel this graph truthfully supports: Email drafts retained in run history.
- Independent adversarial QA iterated through NO-GO findings until exact commit `35d17ed6d22bfda35ad6eeb595d305bade65aa5a` received GO.
- Merged the reviewed branch into local `main` at `01721dcbe041b5a9c7d71a37a2ff90bd212139f6`.
- Post-merge local gates passed:
  - `npx tsc --noEmit`.
  - `npm run lint`.
  - `npm run test:security`, including agent-memory authority 56/56 and Hermes cloud authority 40/40.
  - `npm test`, including all infrastructure pretests, application suites, repository hygiene, workspace failure contracts, and isolated build 6/6.
  - `npm run test:db-cross-channel-cap`: `concurrent_claims=1 active_claims=1 ambiguous=blocked deadlock=none privileges=service-only`.
  - `npm run test:db-agent-memory`: `authority=pass isolation=pass quarantine=hash-only receipts=content-free concurrency=pass idempotence=pass`.
  - `npm run test:db-privileges`: `postgres=restricted-direct supabase_admin=direct cross_owner=denied rotation=pass idempotence=pass empty_preflight=read-only legacy_preflight=read-only complete_preflight=read-only legacy_baseline=approved ledger=filename-sha secret_leak=none`.
  - Full-history Gitleaks scan passed with no leaks before the merge; no secret-bearing source entered the merge.
  - `git diff --check` passed.
- `npm audit --audit-level=high` had already passed on the unchanged lockfile with zero vulnerabilities. The latest registry re-query hung because outbound network access failed; no dependency files changed in this repair.
- Final outbound diagnosis at 22:46 EDT:
  - DNS resolved `github.com` to `140.82.114.4`, but both forced IPv4 and forced IPv6 TLS connections timed out on port 443 after five seconds.
  - `git ls-remote origin refs/heads/main` hung and was interrupted without a ref, so no push was attempted after that failed verification.
  - Forced-IPv4 probes to `/`, `/login`, `/api/health`, `/api/ready`, `/rest/v1/`, and `/auth/v1/health` on `aria-mantu-app.fly.dev` all returned curl exit 28 / HTTP `000` after five-second connect timeouts.
- GitHub connectivity recovered at 22:48 EDT. Verified remote `main=b205293`, pushed `b205293..352de32` normally, then verified local and remote both equaled `352de32cc444aec38450e4cfe2f65fe06bdb511b` with a clean worktree.
- Pushed the Relay-only descendant and reverified `HEAD == origin/main == git ls-remote`. Exact-SHA CI and Actions API queries then timed out again against `api.github.com`, so no remote-check conclusion is claimed.
- A final Fly probe remained inconsistent: `/api/ready` returned HTTP 200 once in 0.21 seconds while `/`, `/rest/v1/`, and `/auth/v1/health` timed out at connect with curl exit 28. This is not acceptable live evidence.
- Archived the prior Baton to `_relay/archive/2026-07-12-2244-codex-gpt-5.md`.
- Updated `_relay/codex-findings.md` with fixed source findings, the reviewer-integrity incident, and current remote blockers.

## Blockers

1. **Exact-SHA GitHub CI and CodeQL are not green.** Earlier runs failed before runner steps. The final pushed tip must pass all required checks before deployment.
2. **Fly DB volume recovery gate remains network-blocked.** `npm run test:fly-db-volume` cannot fetch Alpine 3.23 APK indexes from this network. Do not use `--force-missing-repositories`, disable the patch layer, or pin an unreviewed mirror.
3. **Owner-controlled release gates remain open:**
   - revoke the exposed Fly token and record only rotation evidence;
   - remove repository-level `ARIA_DEPLOY_BUNDLE` and install split Production-environment secrets;
   - protect the default/release branches and Production environment, require independent review, block self-review and administrator bypass;
   - preserve and inspect a disposable clone of `aria_db_data`, then produce the release-bound recovery receipt.
4. **Protected production deploy is not proven for the final SHA.** The workflow must run from the default branch and deploy the exact reviewed artifact digest.
5. **Live acceptance is not proven:** stable app/login/health/readiness; DB/Auth/REST/Kong; two DB/Auth restarts; admin provisioning/login; and a synthetic zero-send campaign with durable run history and no delivery authority.

## Next steps

1. Run `git rev-parse HEAD origin/main` plus `git ls-remote origin refs/heads/main`; all three were equal at handoff and must remain equal. Record that exact SHA as the release candidate.
2. Require CI, CodeQL, dependency audit, secret scan, database security, image supply-chain, and aggregate quality checks for that exact release-candidate SHA.
3. Retry `npm run test:fly-db-volume` only where Alpine repositories are reachable. Require the exact image, existing-data detection, and two-restart persistence assertions to pass.
4. Complete the owner-controlled token, secret, branch/environment protection, and recovery-receipt gates. Do not store secret values in Relay.
5. Dispatch the protected production workflow for the exact approved SHA and verify the running image digest matches release evidence.
6. Run live acceptance in order: `/`, `/login`, `/api/health`, `/api/ready`, Kong `/rest/v1/`, GoTrue `/auth/v1/health`, DB/Auth machine inventory, two controlled restarts, first-admin provisioning/login, then the synthetic zero-send campaign.
7. Confirm the campaign creates owner-bound run/event/memory receipts, retains drafts only in run history, and creates zero provider outbox rows or sends.
8. Update this Baton and `_relay/codex-findings.md` with exact command outputs. Mark production ready only after every gate above is proven.

## Decisions made (don't relitigate)

- `main` is the requested integration branch, but the deploy workflow must also be reachable from the repository default branch.
- The graph runtime supports exactly one current capability: Email drafts retained in run history with no delivery authority.
- Unsupported or unknown stored authority fails closed; it is never normalized to Email.
- The graph route does not create an approval queue and must not write first-touch drafts into the reply outbox.
- No source workaround is accepted for the common outbound network failure.
- No deploy occurs until exact-SHA checks, recovery evidence, owner-controlled gates, and live acceptance are green.
- Reviewer agents work only in detached worktrees and never push.

## Watch out

- The repository root checkout is on `deploy/fly-github-actions`; use the integration worktree above for `main`.
- OneDrive can distort builds; keep using the repository's isolated build gate.
- Always compare `HEAD`, `origin/main`, and `git ls-remote`; a local tracking ref alone is not remote proof.
- A hung push has an ambiguous outcome. Verify the remote ref before retrying.
- Do not expose or reuse the compromised Fly token.
- Do not weaken the Alpine patch/recovery gate to make a network failure look green.
- Live Fly probes from this workstation have been intermittent and cannot substitute for stable multi-pass acceptance evidence.
