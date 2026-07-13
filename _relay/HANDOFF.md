---
project: MSourcing / ARIA
shift: 30
agent: codex-gpt-5
updated: 2026-07-12 20:57 EDT
status: source-integration-green-fly-volume-build-blocked-by-alpine-network-live-release-not-proven
---

# Handoff - source integration green; production release still gated

## Current state

- Integration branch: `codex/aria-campaign-integration-20260712`.
- Current local integration tip includes `main` merged in cleanly, so Tony's local `main` commits for login branding, Supabase browser retry, Fly VM sizing, and docs are present.
- Remote truth checked on 2026-07-12: `origin/HEAD` points to `vercel-demo`, not `main`. Remote `main` is `ed002dc43217c94349edf210edc6a05503b80666`; local `main` is `128b03678fc4619fdf4572e0579b1a80994e2493`; integration branch is ahead of both after the local `main` merge.
- Source-level campaign blockers fixed locally: queue-only reply drafting, SMS containment, cross-channel daily-cap serialization, agent memory authority, recovery schema allowlists, repo hygiene, workspace degraded-state fail-closed behavior, and page-level unavailable/error states.
- Production is not declared done. The protected deploy, live DB/Auth restart survival, `/api/ready`, admin provisioning, and synthetic zero-send campaign acceptance are not proven on the pushed release SHA.

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

1. **Fly DB volume gate is blocked by local outbound access to Alpine repositories.** This is not a schema assertion failure. The test cannot complete while Docker cannot fetch Alpine indexes during the DB image build.
2. **Live production acceptance is not proven.** Do not call the app fully production-ready until the exact pushed release SHA has passed the protected deploy and live acceptance checklist.
3. **Owner-controlled secret and release gates remain mandatory:**
   - Revoke the exposed Fly token and prove rejection/review.
   - Delete repository-level `ARIA_DEPLOY_BUNDLE`; use individual Production-environment secrets.
   - Put the protected workflow on the default branch or change the default branch intentionally; require exact-SHA CI/CodeQL/security gates; block self-review.
   - Preserve and inspect a disposable clone of `aria_db_data`; produce the release-bound recovery receipt.
   - Dispatch the protected workflow using the exact release SHA plus receipt hash.
   - Verify DB/Auth/REST/Kong/readiness, two DB restarts, digests, admin login, and a synthetic zero-send campaign.

## Next steps

1. Commit the Baton/findings update with the already-green source integration.
2. Merge the verified integration branch into local `main` only after checking `git status` is clean except intended Baton/finding files.
3. Run at least: `npx tsc --noEmit`, `npm run lint`, `npm run test:security`, `npm test`, `npm audit --audit-level=high`, `gitleaks git . --redact=100 --no-banner --config .gitleaks.toml --log-opts='--all'`, and `git diff --check` from `main`.
4. Retry `npm run test:fly-db-volume` only when Alpine repository access is reachable from Docker. Do not use `--force-missing-repositories`; that would weaken the CVE patch gate.
5. Push `main` only after the local `main` test gate is green and the Fly-volume blocker is either green or explicitly accepted as an external network retry blocker by Tony.
6. After push, verify remote CI for the exact commit. If GitHub Actions or CodeQL fail, fix the failing gate before any deploy.
7. Do not deploy until the owner-controlled secret, protection, recovery-receipt, and approval gates are closed.

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
