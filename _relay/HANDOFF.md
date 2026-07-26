---
project: MSourcing / ARIA
shift: 47
agent: codex-gpt-5
updated: 2026-07-26 00:37 EDT
status: phase-1 candidate-list authority source-green; evidence bridge and product surface pending; production blocked
---

# Handoff - MSourcing / ARIA

## Current state

- Work only from /Users/tony/msourcing-heyreach-foundation-20260725. The OneDrive checkout is not the execution lane.
- Active branch: codex/candidate-lists-phase1-20260725.
- Local HEAD: be7278dc24b82ef4a92126db3d1eb1412d630755. This is the green 0064 candidate-list authority commit.
- Remote branch still ended at f92f2ae when this snapshot was written. Push be7278d plus this handoff commit before handing off.
- RED-first commits 3ee2e80 and f92f2ae are already pushed.
- Migration 0064 adds four private, forced-RLS tables: candidate_lists, candidate_contact_attestations, candidate_list_members, and candidate_list_operation_receipts.
- Authenticated members and admins can create a list and add one provenance-bound member. Viewers, members, and admins can read bounded keyset pages through the RPC. Browser candidate JSON is not authority.
- Candidate add and governed erasure share the canonical candidate identity advisory lock. Erasure deletes list membership, attestation rows, and candidate-linkable add receipts. Both transaction orders are covered.
- The canonical schema inventory now has one static, sorted 125-table set. It contains the three 0063 outreach tables that were previously missing plus the four 0064 tables.
- Canonical legacy public-schema digest: df3e7f3ea3155d6523bf284e18c811a3cca1444b5cb329afad9357619a1f057b.
- 0064 is a database foundation only. No route or recruiter UI uses it yet. No set operations, eligibility engine, shared quota, or export exists yet.
- Real GitHub and Tavily evidence cannot yet authorize list membership. The current 0064 path depends on the best-effort public.candidates mirror and owner-inserted manual attestations. Migration 0065 must close this before product wiring.
- No Fly deployment, production secret mutation, sourcing activation, LinkedIn automation, outbound contact, or candidate PII handling occurred in this shift.

## Done this shift

- Captured and pushed the RED-first candidate-list contract in commits 3ee2e80 and f92f2ae.
- Implemented 0064 with tenant-bound foreign keys, forced RLS, least-privilege RPC grants, request idempotency, immutable evidence, opaque member cursors, and guarded rollback.
- Fixed the no-secret erasure order so canonical erasure can create its secret after the request without breaking list cleanup.
- Fixed retained candidate-linkable receipt evidence and the post-erasure and concurrent add-versus-erasure reintroduction races.
- Added 51 disposable PostgreSQL 17 assertions covering identity, tenancy, ACLs, evidence, idempotency, pagination, erasure, concurrency, rollback, and reapply.
- Registered the database suite in the canonical manifest and function-privilege inventory.
- Repaired the recovery inventory defect that had silently omitted all three 0063 outreach authority tables.
- Independent database-security and database-QA re-audits both returned PASS with no open 0064 finding.
- Committed the source slice as be7278d.

## Verification evidence

- bash tests/candidate-lists-db.sh: 51 assertions, 0 failed.
- npx tsx tests/recovery-schema-allowlists.mts: 15 passed, 0 failed.
- scripts/test-db-privileges.sh: exit 0, including restricted migration owner, exact ledger, read-only preflights, schema capture, and no secret leakage.
- npm run typecheck: exit 0.
- npm run typecheck:tests: exit 0.
- npm test: complete pretest, application, and posttest lifecycle exited 0 on the final source tree.
- npm run test:manifest: 11 passed, 0 failed.
- gitleaks dir . --redact --no-banner --exit-code 1: no leaks across 22.44 MB.
- git diff --check: exit 0 before commit.
- Independent reviews: database security PASS; database QA PASS.

## Blockers

1. Migration 0065 is not implemented. It must remove list admission dependence on public.candidates and resolve exact GitHub, unexpired Tavily, and canonical manual evidence.
2. There is no authenticated manual provenance writer with supersession and revocation. The 0064 test fixture inserts an attestation as postgres.
3. Phase 1 still lacks list set operations, complete eligibility reasons, recent-contact and suppression gates, shared quota, bounded export, authenticated API routes, accessible UI, browser E2E, and production-shaped performance evidence.
4. Parent PR 5 and stacked PR 7 remain unmerged. GitHub Actions jobs were last observed with zero steps because the account Actions budget prevented execution. Recheck with gh before relying on this statement.
5. Protected production deployment remains blocked by missing GitHub environment proof, purpose-bound secrets, two active tenant administrators, live model and Tavily bindings, Flowise image acceptance, telemetry, restore/failover, and accepted load evidence.
6. Fly still represents an older release. A health 200 or the old app shell is not proof for this branch.

## Next steps

1. Commit this Relay and Codex-state snapshot, push the active branch, and verify the remote branch SHA.
2. Start migration 0065 RED-first in a separate commit. Cover GitHub evidence without a mirror row, Tavily evidence expiry, forged mirror rejection, canonical manual evidence without a mirror, tenant and ACL boundaries, idempotency, supersession, revocation, ambiguity, concurrency, shadow-row deletion, provider/manual collisions, governed erasure, rollback, and reapply.
3. Implement 0065 with one private evidence resolver. GitHub evidence is durable authority; Tavily evidence must be unexpired at admission; existing list membership remains an immutable snapshot after later expiry or revocation.
4. Add a narrow authenticated manual-attestation RPC for member/admin callers. Derive workspace and actor server-side, permit fixed lawful-basis codes only, bound observed time, and store no free-text PII.
5. Remove the 0064 candidate mirror foreign keys only after the resolver and erasure tests prove equivalent tenant and deletion safety.
6. Run both TypeScript checks, the focused database harnesses, canonical database manifest, complete npm test lifecycle, recovery schema checks, privilege checks, Gitleaks, and diff hygiene. Commit and push only on green.
7. Complete the remaining Phase 1 slices in order: set operations; eligibility and suppression; shared quota and export; authenticated API; accessible recruiter UI; browser E2E and performance proof.
8. Use four independent QA lanes across database/concurrency, security/privacy, API/UI/accessibility, and release/performance. After the whole implementation plan is complete, use Terra as the final independent validator.
9. Merge and deploy only through protected main after exact-SHA CI, CodeQL, independent approval, environment controls, migration readback, release identity, live no-contact sourcing canary, telemetry, restore/failover, and capacity receipts are accepted.

## Decisions made (do not relitigate)

- Build an original ARIA workflow. Do not copy competitor code, assets, brands, private contracts, or deceptive UI.
- LinkedIn remains assisted-manual unless written platform entitlement or an approved contracted provider grants each exact automated action.
- Never capture LinkedIn passwords, PINs, cookies, li_at, browser sessions, fingerprints, proxies, captcha tooling, or stealth automation.
- ARIA owns tenancy, RBAC, approvals, lawful basis, suppression, erasure, budgets, claims, audit, and every egress decision. Framework agents may propose work but cannot own authority.
- Provider and manual evidence must be exact, tenant-bound, durable, and replay-safe. A best-effort mirror is display data, not authority.
- Existing list membership stores an immutable evidence snapshot. Later source expiry or revocation blocks new admission but does not silently rewrite history.
- Candidate-bearing mutations must take the canonical erasure identity lock before secrets, HMACs, receipts, evidence, or durable candidate data are written.
- Source-green, protected-CI-green, merged, deployed, canary-green, restore-green, and capacity-green are separate proof states.
- Direct production secret mutation, direct main pushes, and branch-protection bypass remain prohibited.

## Watch out

- Do not modify the OneDrive checkout.
- Do not activate outreach release controls or production sourcing from this branch.
- Do not use public.candidates as the final 0065 provenance authority.
- Do not turn an expired Tavily observation into permanent admission authority; snapshot it only when currently valid.
- Do not delete existing list history merely because provider evidence later expires or is revoked; governed candidate erasure is separate.
- Do not report manual completion as provider-confirmed sent or delivered evidence.
- Do not interpret a zero-step GitHub failure as a code failure. Inspect current run annotations with gh.
- Do not claim production-ready, enterprise-ready, live-sourcing-ready, or 50,000-user-ready while any blocker above remains.
- Never delete _relay/archive and never place secrets or candidate PII in Relay files.
