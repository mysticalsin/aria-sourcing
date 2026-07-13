---
project: MSourcing / ARIA
shift: 30
agent: codex-gpt-5
updated: 2026-07-12 21:24 EDT
status: main-pushed-local-gates-green-ci-prerunner-failure-and-fly-volume-network-blocker-remain
---

# Handoff - source integration green; production release still gated

## Current state

- Local branch: `main`.
- Pushed SHA: `52423e8f88b056c38c188c4066d6433f6a2c617d` (`merge aria campaign integration into main`).
- Remote truth checked on 2026-07-12 before push: `origin/HEAD` points to `vercel-demo`, not `main`. `main` was still pushed because Tony explicitly asked for main.
- Current local `main` includes the complete `codex/aria-campaign-integration-20260712` merge plus Tony's prior local `main` commits for login branding, Supabase browser retry, Fly VM sizing, and docs.
- Source-level campaign blockers fixed locally: queue-only reply drafting, SMS containment, cross-channel daily-cap serialization, agent memory authority, recovery schema allowlists, repo hygiene, workspace degraded-state fail-closed behavior, and page-level unavailable/error states.
- Production is not declared done. The protected deploy, live DB/Auth restart survival, `/api/ready`, admin provisioning, and synthetic zero-send campaign acceptance are not proven on pushed SHA `52423e8f88b056c38c188c4066d6433f6a2c617d`.

## Done this shift

- Merged local `main` into `codex/aria-campaign-integration-20260712` with no conflicts.
- Re-ran the post-merge release gates:
  - `npx tsc --noEmit` passed.
  - `npm run lint` passed.
  - `npm run test:security` passed, including agent memory, queue-only autopilot, MCP, Dust, Hermes, Vault, callback, RBAC, API, guardrail, web, browser, gate, and autopilot suites.
  - `npm test` passed end to end after the `main` merge. It includes 18 pretest contracts plus the full app chain through repository hygiene, workspace availability, docs truth, font/build-output, and isolated build.
  - `npm audit --audit-level=high` passed with `found 0 vulnerabilities`.
  - `gitleaks git . --redact=100 --no-banner --config .gitleaks.toml --log-opts='--all'` scanned 247 commits and found no leaks.
  - `npm run test:db-cross-channel-cap` passed: `concurrent_claims=1 active_claims=1 ambiguous=blocked deadlock=none privileges=service-only`.
  - `npm run test:db-agent-memory` passed: `authority=pass isolation=pass quarantine=hash-only receipts=content-free concurrency=pass idempotence=pass`.
  - `npm run test:db-privileges` passed: `postgres=restricted-direct supabase_admin=direct cross_owner=denied rotation=pass idempotence=pass empty_preflight=read-only legacy_preflight=read-only complete_preflight=read-only legacy_baseline=approved ledger=filename-sha secret_leak=none`.
  - `git diff --check` passed and the integration worktree was clean before Baton edits.
- Merged the verified integration branch into local `main`, then re-ran the main-branch gates:
  - `npx tsc --noEmit` passed.
  - `npm run lint` passed.
  - `npm run test:security` passed.
  - `npm test` passed end to end.
  - `npm audit --audit-level=high --fetch-timeout=30000 --fetch-retries=1` passed with `found 0 vulnerabilities`.
  - `gitleaks git . --redact=100 --no-banner --config .gitleaks.toml --log-opts='--all'` scanned 248 commits and found no leaks.
  - `npm run test:db-cross-channel-cap` passed: `concurrent_claims=1 active_claims=1 ambiguous=blocked deadlock=none privileges=service-only`.
  - `npm run test:db-agent-memory` passed: `authority=pass isolation=pass quarantine=hash-only receipts=content-free concurrency=pass idempotence=pass`.
  - `npm run test:db-privileges` passed: `postgres=restricted-direct supabase_admin=direct cross_owner=denied rotation=pass idempotence=pass empty_preflight=read-only legacy_preflight=read-only complete_preflight=read-only legacy_baseline=approved ledger=filename-sha secret_leak=none`.
  - `git diff --check` passed and local `main` was clean before push.
- Pushed `main` to origin: `128b036..52423e8`.
- Remote check status for exact SHA `52423e8f88b056c38c188c4066d6433f6a2c617d` showed Vercel pending, then GitHub check-runs failed. Log retrieval repeatedly timed out from this network. One direct job metadata probe succeeded for CodeQL job `86713908848`: `runner_name=""`, `runner_group_name=""`, `steps_len=0`, started `2026-07-13T01:06:13Z`, completed `2026-07-13T01:06:17Z`, conclusion `failure`. Treat this as a pre-runner/platform failure until logs prove otherwise, not a source-test failure.
- Re-ran the Fly DB volume recovery gate. It did not reach the app assertions because the Docker build failed at Alpine package index fetch:
  - command: `npm run test:fly-db-volume`
  - failing layer: `RUN apk upgrade --no-cache && apk add --no-cache su-exec && rm -f /usr/local/bin/gosu`
  - exact error: `WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.23/main/aarch64/APKINDEX.tar.gz: Operation timed out`
  - exact error: `WARNING: fetching https://dl-cdn.alpinelinux.org/alpine/v3.23/community/aarch64/APKINDEX.tar.gz: Operation timed out`
  - terminal error: `ERROR: Not continuing due to stale/unavailable repositories. Use --force-missing-repositories to continue.`
  - exit: Docker build exit code 99.
- Tried mirror overrides during diagnosis and rejected them because `dl-2.alpinelinux.org`, `mirrors.edge.kernel.org`, and `mirror.leaseweb.com` were also unreachable from this machine. The Dockerfile mirror override was removed before this Baton was written.
- Archived previous Baton to `_relay/archive/2026-07-12-2057-codex-gpt-5.md`.

## Blockers

1. **Remote CI is red for pushed SHA `52423e8f88b056c38c188c4066d6433f6a2c617d`.** Retrieved job metadata for CodeQL shows a pre-runner failure (`steps_len=0`, empty runner fields, 4-second duration). Full logs could not be retrieved because GitHub/Azure log endpoints timed out from this network. Do not deploy from this SHA until CI is re-run green or the platform failure is resolved and documented.
2. **Fly DB volume gate is blocked by local outbound access to Alpine repositories.** This is not a schema assertion failure. The test cannot complete while Docker cannot fetch Alpine indexes during the DB image build.
3. **Live production acceptance is not proven.** Do not call the app fully production-ready until the exact pushed release SHA has passed the protected deploy and live acceptance checklist.
4. **Owner-controlled secret and release gates remain mandatory:**
   - Revoke the exposed Fly token and prove rejection/review.
   - Delete repository-level `ARIA_DEPLOY_BUNDLE`; use individual Production-environment secrets.
   - Put the protected workflow on the default branch or change the default branch intentionally; require exact-SHA CI/CodeQL/security gates; block self-review.
   - Preserve and inspect a disposable clone of `aria_db_data`; produce the release-bound recovery receipt.
   - Dispatch the protected workflow using the exact release SHA plus receipt hash.
   - Verify DB/Auth/REST/Kong/readiness, two DB restarts, digests, admin login, and a synthetic zero-send campaign.

## Next steps

1. Retrieve the failed GitHub job logs for SHA `52423e8f88b056c38c188c4066d6433f6a2c617d` once GitHub/Azure log endpoints are reachable. Start with CodeQL job `86713908848` and CI run `29216702413`.
2. If logs confirm account/runner/platform failure, re-run the workflows after the platform/budget/runner issue is cleared. If logs show a real workflow or source failure, fix that exact failing step and push a new `main` SHA.
3. Retry `npm run test:fly-db-volume` only when Alpine repository access is reachable from Docker. Do not use `--force-missing-repositories`; that would weaken the CVE patch gate.
4. Do not deploy until remote CI/CodeQL are green for an exact SHA and the owner-controlled secret, protection, recovery-receipt, and approval gates are closed.
5. After protected deploy, complete live acceptance: DB/Auth/REST/Kong/readiness, two DB restarts, digests, admin login, and a synthetic zero-send campaign.

## Decisions made - do not relitigate

- Queue-only reply drafting is the release authority. No channel has autonomous provider delivery authority in this release.
- Unknown provider outcomes stay non-retryable or require operator reconciliation. Never free capacity or retry after an ambiguous transport outcome.
- Cross-channel daily caps use one serialized per-seat authority and count ambiguous outcomes against the safety budget.
- Agent memory is owner/spec scoped, bounded, approved, content-hash auditable, and loaded only after durable receipt authority.
- Live backend failure must render unavailable/degraded state, not synthetic demo data or empty success.
- Do not ship mirror overrides for Alpine unless the chosen mirror is reachable and the Fly-volume test completes.
- Do not use the exposed Fly token. Do not commit `_relay/incidents`.

## Watch out

- `origin/HEAD` is `vercel-demo`. If Tony says "main", verify whether he means GitHub default branch, local `main`, or production deploy branch before changing branch protection or workflows.
- The integration branch now includes local `main`, but remote `main` is behind. Pushes can change the public branch materially.
- Keep `_relay/` committed, but do not include incident files or raw secrets.
- The Fly DB volume test failure is at dependency fetch time. If it fails later after Alpine becomes reachable, treat that later failure as a new source blocker and diagnose from scratch.
- The public production URL may answer basic probes while still being behind the local source migration set. Live acceptance must prove the exact release SHA, schema, restart survival, admin provisioning, and zero-send campaign behavior.
