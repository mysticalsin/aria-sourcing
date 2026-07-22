---
project: MSourcing / ARIA
shift: 45
agent: codex-gpt-5
updated: 2026-07-22 01:54 EDT
status: source-closed - PR 5 open; protected production acceptance blocked
---

# Handoff - MSourcing / ARIA

## Current state

- Canonical clone: `/Users/tony/msourcing-enterprise-go-20260721`. Do not modify the OneDrive checkout.
- Branch: `codex/enterprise-go-20260721`, now tracking `origin/codex/enterprise-go-20260721`.
- Tested source commit: `33b0aed47cd4850bd27689b5e8ffcb45210bfd27`.
- Protected-main PR: `https://github.com/mysticalsin/aria-sourcing/pull/5`. PR state is OPEN, `mergeStateStatus=BLOCKED`, `reviewDecision=REVIEW_REQUIRED`.
- This baton and the Relay/Codex-state closeout are the only changes after the tested source commit. When this file is read from Git, they are committed in the current branch HEAD.
- Schema now runs through migration 0062. Canonical public-schema digest: `8937fbb792900ac9f099058717f512562a644e68eebf7bf12e87fa9efa84eab4`.
- Production Fly still runs older application build `3ff485...` with migration 0046. Latest verified readback: `/api/health` 200; `/api/ready` 503 with database, auth, queue, migration, and release identity true and only `agentFrameworks=false`. This is not evidence for PR 5.
- No production deployment, secret mutation, sourcing activation, or candidate contact was performed from this branch.

## Done this shift

- Closed real need-to-candidate source authority:
  - bounded authenticated need ingress;
  - real approved-model requisition parsing with no synthetic fallback;
  - deterministic campaign creation;
  - bounded GitHub and Tavily provider execution;
  - exact source/evidence receipts and durable candidate persistence;
  - retry-safe result staging and acknowledgement;
  - human-reviewed Graphify lesson selection bound before egress;
  - zero outbound sends during sourcing.
- Added exact DeerFlow and Flowise framework source boundaries, private adapters, release-bundle verification, provenance policy, image pinning, and fail-closed readiness. Framework source exists, but Flowise remains deployment NO-GO because its current complete runtime scan is not acceptable.
- Added standard OpenTelemetry configuration, redacted critical-path events, operational readiness checks, activation controls, and a truthful capacity gate that refuses to claim 50,000-user readiness without accepted staging evidence.
- Added migration 0061 active-GoTrue identity enforcement. A token issued before ban, unconfirmation, or soft deletion is rejected by the database authority.
- Added migration 0062 and `docker/bootstrap/auth-owner-bridges.sql` so orphan-owner recovery crosses the real `supabase_auth_admin` ownership boundary through one restricted Auth-owner decision function.
- Fixed the 0058/0059 replay interaction:
  - 0058 rollback refuses while 0059 remains applied;
  - 0059 rollback restores the exact 0058 receipt allowlist;
  - 0058 rollback restores the exact pre-0058 allowlist;
  - forward reapply restores both exact lists;
  - a later 0058 replay preserves the byte-identical 0059 constraint.
- Fixed the requisition parser test fixture to use the canonical endpoint profile `anthropic_messages_2023_06_01`.
- Removed the obsolete DeerFlow fixture and archived the superseded first-draft agent-framework deployment packet under `_relay/archive/2026-07-22-agent-framework-first-draft/`.
- Reconstructed missing shift 43 from the committed baton and archived shift 44 at `_relay/archive/2026-07-22-0144-codex.md`.
- Committed and pushed the 294-file source slice as `33b0aed47cd4850bd27689b5e8ffcb45210bfd27`.
- Opened PR 5 directly to protected `main`.

## Verification evidence

All commands ran from the canonical clone.

- `npm run typecheck && npm run typecheck:tests && npm test`: exit 0.
- `npm run test:database`: exit 0 across the canonical 30-command database manifest.
- Pinned real-GoTrue line: `[gotrue-active-identity] PASS: pinned GoTrue, Auth-owner bridge ACL, workspace provisioning, and stale-token revocation`.
- Focused 0058 result: `RESULT sourcing-result-durability-db: behavior=pass concurrency=pass acl=pass rollback=guarded reapply=pass rows=8`.
- `npm run test:authority-regression`: exit 0.
- `npm run test:recovery`: exit 0.
- `npm run build:isolated`: exit 0; Next 16.2.10 compiled and generated all 66 static pages.
- `npm audit --audit-level=high`: zero vulnerabilities.
- `npm run lint`: exit 0.
- `git diff --check HEAD`: exit 0 before source commit.
- Staged Gitleaks scan: no leaks.
- `gitleaks git . --redact=100 --no-banner --config .gitleaks.toml --log-opts='--all'`: 325 commits, no leaks.
- Docker Compose and every Fly TOML parsed/validated locally.
- Final local contract counts include deploy 141/141, infrastructure release 145/145, capacity harness 11/11, readiness 31/31, and manifest 11/11.
- `npm run test:obscura` exited 0 but its live sidecar probe was SKIPPED because `OBSCURA_BIN_PATH` was not configured and no sidecar was reachable. Do not call this live Obscura proof.
- Earlier exact ARIA image proof remains green at zero HIGH/CRITICAL with the pinned unsuppressed Trivy gate. No later application/Docker change invalidated that image-content result.
- Flowise remains NO-GO: current canonical complete runtime 15 CRITICAL/116 HIGH; official 3.1.3 comparison 18 CRITICAL/167 HIGH.

## GitHub evidence

- PR run `29895093683` (CI) and `29895093710` (CodeQL) target exact source SHA `33b0aed47cd4850bd27689b5e8ffcb45210bfd27`.
- Every GitHub CI and CodeQL job has `steps: []`.
- `gh run view --log-failed` returns `log not found` because no runner step started.
- Check-run annotations for Quality and CodeQL both say exactly: `The job was not started because an Actions budget is preventing further use.`
- Required contexts remain failed only at the account budget gate: Quality, Dependency audit, Secret scan, Database security, Production image supply chain, Release gate, and Analyze (javascript-typescript).
- Vercel preview is pending and is not the protected Fly production release.
- Protected `main` still requires all required contexts, one independent approval, last-push approval, administrator enforcement, linear history, and no force push.

## Blockers

1. GitHub Actions budget prevents CI and CodeQL from executing. This is an account-owner action.
2. PR 5 needs independent review and last-push approval. Do not self-approve or bypass protection.
3. `Deploy Aria Mantu (Fly)` workflow ID 311052846 remains manually disabled.
4. GitHub `Production` has no required reviewers, no environment secrets, and a stale custom branch policy for `deploy/fly-github-actions`; the workflow accepts only protected `main`.
5. Required environments `Production-Need-Ingress-Throttle-Proof` and `Production-Sourcing-Activation` do not exist.
6. Repository secrets expose only stale `ARIA_DEPLOY_BUNDLE`. The hardened workflow deliberately does not consume it.
7. Purpose-bound secret names still needing authorized provisioning are defined by the workflows. Current exact set:
   `ANTHROPIC_API_KEY`, `ARIA_DATA_KEY_RING_RETIREMENT_APPROVAL`, `ARIA_FIRST_ADMIN_EMAIL`, `ARIA_FIRST_ADMIN_PASSWORD`, `ARIA_FIRST_DEPLOY_APPROVAL`, `ARIA_GITHUB_SOURCE_TOKEN`, `ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_HMAC_KEY`, `ARIA_NEED_INGRESS_THROTTLE_EVIDENCE_JSON`, `ARIA_SOURCING_CANARY_EMAIL`, `ARIA_SOURCING_CANARY_NEED_KEY`, `ARIA_SOURCING_CANARY_PASSWORD`, `ARIA_VOLUME_RECOVERY_RECEIPT_JSON`, `ARIA_VOLUME_RESTORE_CREATE_REQUEST_JSON`, `ARIA_VOLUME_RESTORE_CREATE_RESPONSE_JSON`, `FLY_AGENT_FRAMEWORK_CAPABILITY_SECRET`, `FLY_AGENT_FRAMEWORK_REGISTRY_TOKEN`, `FLY_API_TOKEN`, `FLY_AUTH_DB_PASSWORD`, `FLY_CRON_SECRET`, `FLY_DATA_ENCRYPTION_KEY`, `FLY_DATA_ENCRYPTION_PREVIOUS_KEYS`, `FLY_DEERFLOW_ADAPTER_TOKEN`, `FLY_FLOWISE_ADAPTER_TOKEN`, `FLY_JWT_SECRET`, `FLY_OTEL_EXPORTER_OTLP_ENDPOINT`, `FLY_OTEL_EXPORTER_OTLP_HEADERS`, `FLY_PG_PASSWORD`, `FLY_RECOVERY_AUDIT_TOKEN`, `FLY_RECOVERY_CLEANUP_TOKEN`, `FLY_REGISTRY_TOKEN`, `FLY_REQUISITION_PARSE_SECRET`, `FLY_REST_DB_PASSWORD`, `FLY_SOURCING_EXECUTION_SECRET`, `FLY_SUPABASE_ADMIN_CURRENT_PASSWORD`, `FLY_SUPABASE_ADMIN_TARGET_PASSWORD`, `FLY_SUPABASE_ANON_KEY`, `FLY_SUPABASE_SERVICE_KEY`, `KIMI_API_KEY`, `KIMI_BASE_URL`, and `TAVILY_API_KEY`. Never print or copy values into Relay.
8. Flowise has no scan-acceptable complete production image and therefore cannot be promoted, signed, or activated.
9. Production has only one proven active administrator. Runtime binding activation requires two distinct active administrators.
10. Last recorded Kimi probe returned HTTP 402. A funded exact model binding has not been proven.
11. No live workspace-bound Tavily binding, shared multi-Machine need-ingress throttle, external OTLP collector/alerts/on-call, restore/failover drill, second database failure domain, or accepted 50,000-user staging receipt is proven.
12. No authenticated exact-release zero-send need-to-candidate canary has run.
13. Fable 5 remains quota-exhausted: `You've reached your Fable 5 limit. Run /usage-credits to continue or switch models with /model.`

## Next steps

1. Verify PR 5 head matches the current remote branch before any rerun; if it differs, inspect the intervening diff and rerun the relevant gates.
2. Owner restores GitHub Actions budget.
3. Configure `Production`, `Production-Need-Ingress-Throttle-Proof`, and `Production-Sourcing-Activation` with protected-main branch policy, independent reviewers, and the exact purpose-bound secrets/variables from both deploy workflows. Do not restore the legacy bundle path.
4. Re-enable the production workflow only after environment review.
5. Rerun CI and CodeQL for the exact PR head. Inspect each run and annotation with `gh`; do not infer a source failure from the current zero-step budget failures.
6. Obtain independent and last-push approval, then merge PR 5 to protected `main`. Do not push directly to `main`.
7. Build all seven agent-framework component images from the merged SHA. Require complete runtime startup, zero HIGH/CRITICAL Trivy results, SPDX SBOM, max-provenance, keyless signature, immutable digest, and accepted release bundle. Flowise must stay dark until this passes.
8. Dispatch the protected Fly workflow from merged `main`. Require the ledger-aware migration job through 0062, exact image/release readback, one healthy loop Machine with the canonical four-handler digest, and all readiness probes.
9. Provision a second real administrator. Verify the exact cloud model and Tavily credentials through their approved non-billable checks, then activate one two-person runtime binding.
10. Prove the shared need-ingress throttle on at least two application Machines.
11. Run the protected no-contact canary with a synthetic need: ingress -> model parse -> campaign -> real provider sourcing -> persisted source-backed candidates. Verify zero outbound messages.
12. Capture external OTLP receipt/alert routing, database restore/failover, restart, and production-shaped load/stress/soak receipts. Only then consider the 50,000-user and production-ready acceptance gates satisfied.

## Decisions made (do not relitigate)

- `main` is the only production release target; direct main pushes and protection bypass are prohibited.
- ARIA owns tenant, budget, approval, persistence, audit, and egress authority. DeerFlow and Flowise are bounded execution frameworks, not authority owners.
- Production never invents needs, candidate identities, skills, experience, consent, or provider evidence.
- Graphify lessons require human promotion, exact role/workspace/version/expiry binding, and immutable claim-time snapshots.
- Human approval remains default for outreach. Disabling human-in-the-loop requires a separately reviewed production control; sourcing itself sends nothing.
- Public ingress and autonomous sourcing activate only after exact-release proof and can be re-darkened independently.
- The obsolete `ARIA_DEPLOY_BUNDLE` must not be unpacked or reintroduced.
- Flowise remains disabled until a complete production runtime meets the zero-HIGH/CRITICAL policy.
- Source-green, protected-CI-green, deployed, live-canary-green, restore-green, and capacity-green are separate proof states.

## Watch out

- Do not use the OneDrive checkout. It is not the canonical release tree.
- Do not deploy PR 5 or mutate Fly secrets directly; the protected workflow and owner gates are intentional.
- Do not treat Vercel preview, `/api/health` 200, the older Fly build, or a local fixture as production acceptance.
- Do not mark the overall goal complete while any production blocker above remains.
- Do not remove or rewrite Relay archives.
