---
project: MSourcing / ARIA
shift: 47
agent: codex-gpt-5
updated: 2026-07-26 05:21 EDT
status: legacy rollback bypass fixed and fully green locally; 0067 RED-first plan approved; production blocked
---

# Handoff - MSourcing / ARIA

## Current state

- Work only from /Users/tony/msourcing-heyreach-foundation-20260725. The OneDrive checkout is not the execution lane.
- Active branch: codex/candidate-lists-phase1-20260725.
- Remote branch is verified at `caafcc3761a6848f0d1ba8c343b34d6806792ac8`. Local head is `a489065ac1da702323dd917977edc874ce6acd83` and is not yet pushed. The local rollback-repair chain is `c6342dd` RED, `7629f15` partial-apply probes, and `a489065` source fix.
- The 0066 RED harness SHA is f02dc12245e9e67e31d6acae8ba7cda42d8f204105b9a1f25a6611b242e67a85; database manifest count is 34 and its contract remains 11/11 green.
- Source commit `6bf97a667ca91a1dae9f5080fdb6c8e9e2e08427` implements and accepts 0066 and is pushed. Accepted artifact hashes are: migration `f1db1fcdf0c10216f34799dc40c868c859ad06929d959641f44dc833f31240e4`; refusing rollback `ec686a4661e429093f920346404288c2ae3a20ec424610e7130452a9da13f723`; expanded focused harness `7e2363bc658aec26e2a04ffb06a9e6a8fa483ea9041ecbf5e703ea548244427e`.
- GitHub has no PR for this exact head. Current push runs CI 30195226817 and CodeQL 30195226798 target remote SHA `caafcc3`; all seven jobs have zero steps. The exact annotation remains `The job was not started because an Actions budget is preventing further use.` No code ran on a GitHub runner.
- GitHub still reports `vercel-demo` as the default branch. A separate `main` ref exists at bc46336, while `vercel-demo` is 14f76f1; neither is this execution head. The final protected-main topology and merge path must be reconciled explicitly, not inferred.
- RED-first 0064 commits 3ee2e80 and f92f2ae, implementation be7278d, and Relay closeout d82e2c0 are pushed.
- Migration 0064 adds four private, forced-RLS tables: candidate_lists, candidate_contact_attestations, candidate_list_members, and candidate_list_operation_receipts.
- Authenticated members and admins can create a list and add one provenance-bound member. Viewers, members, and admins can read bounded keyset pages through the RPC. Browser candidate JSON is not authority.
- Candidate add and governed erasure share the canonical candidate identity advisory lock. Erasure deletes list membership, attestation rows, and candidate-linkable add receipts. Both transaction orders are covered.
- The canonical schema inventory now has one static, sorted 125-table set. It contains the three 0063 outreach tables that were previously missing plus the four 0064 tables.
- Canonical legacy public-schema digest after 0065: 3db4336e99b868e9e5f2b17ed6e1261db0d25428407cc3dbc846087d37b5e2df.
- 0064 is a database foundation only. No route or recruiter UI uses it yet. No set operations, eligibility engine, shared quota, or export exists yet.
- Migration 0065 lets exact completed GitHub receipts, unexpired Tavily evidence, and governed manual attestations authorize new list membership without relying on the best-effort public.candidates mirror. Every fresh admission still requires exactly one canonical workspace-state candidate so governed erasure remains reachable.
- Accepted 0065 artifact hashes: forward migration cd07aa6e530d9298b4755ceb6e7843ac80355339e1a671f59b754a236d85cbf4; guarded rollback c51858403e4e22f59c2a6e386e8d99a6dfc18d78e2418cf7b89d9ce419489cb7; focused harness 8c860f5ea95d7a12b02439194c3b04fe70c4b54d4515007a4b6e84e7b26471e6. Source commit: 4fd02dc.
- The canonical-state guard now rejects direct workspace-state deletion while list authority exists, rejects workspace-id tenant hops, and preserves enclosing workspace teardown. The matching rollback drops both guard triggers before dropping the shared function.
- A review patch initially placed a trigger-only branch in the preflight DO block. Codex moved it before accepting QA. A later independent audit found a receipt/list lock inversion; the final migration acquires the receipt lock before list locks, and the focused suite now reproduces the prior interleaving with real PostgreSQL sessions and proves no deadlock.
- Security review requires exact canonical workspace-state presence for all new admission, erasure-compatible campaign IDs, completed provider receipt binding, append-only manual lifecycle, workspace-before-identity locks, and deletion of every candidate-linkable receipt.
- Gmail API and Microsoft Graph already have real OAuth/send primitives, encrypted `email_connections`, the shared durable outbound claim path, and read-only mailbox polling. They are not production-accepted: authenticated admins retain direct DML on credential-bearing rows, reconnect can erase an existing refresh token, Microsoft refresh-token rotation is not persisted, provider/tenant/mailbox-to-seat binding is incomplete, native provider subscription/cursor recovery is absent, and hard delivery outcomes do not persistently pause database dispatch authority.
- Fly currently exposes none of the required Google, Microsoft, email webhook/subscription, or HeyReach secret names. The protected deploy preflight rejects unmanaged secret names, so workflow inputs, the allowlist, and the exact desired set must be extended together before any connector secret can pass release.
- HeyReach has no source implementation. Its exact public API authentication, idempotency, webhook-signature, retry, and receipt contract is not verified. Execution remains disabled until written entitlement, official contract or sandbox evidence, and vendor security/privacy approval exist.
- The external master plan now separates first-party Gmail/Microsoft 365 activation (Phase 5A) from conditional LinkedIn/HeyReach activation (Phase 5B), with OAuth binding repair, native inbox durability, dual control, and explicitly authorized synthetic-recipient canaries.
- The executable 0066 design is in `_relay/plans/06-candidate-global-legal-hold-authority.md`. Independent security review requires a distinct candidate-legal-hold advisory namespace: prelocking only the old candidate identity key would invert the retained erasure routine's sorted multi-identity locks. Request takes workspace_state FOR UPDATE first; other legal-hold paths take FOR SHARE before the dedicated lock.
- 0066 is forward-only. Its checked-in rollback must refuse unconditionally with SQLSTATE 55000 because downgrade restores a known destructive bypass. The 0059 and 0060 rollback guards must also refuse before mutation when the production ledger contains 0066 or later; disposable replay tests explicitly restore 0066 afterward.
- 0066 now makes legal-hold scope candidate-global inside one workspace, removes all inherited non-owner predecessor ACLs, revalidates expiry after lock waits, prevents transient unblocking during replacement, and gives erasure-list and retention paths one bounded total candidate lock order. Independent security and concurrency review report no P0/P1.
- The 0064 and 0065 legacy rollbacks now refuse before mutation beneath ledgered or ledgerless later authority, including the first 0065 foreign-key removal and the first 0066 index/function rename. Absent-table-safe checks preserve 0064 idempotent rollback.
- The detailed 0067 contract is `_relay/plans/07-candidate-list-set-preview-authority.md`. It adds only revision-bound, read-only union/intersection/difference/exclusion previews. Removal, materialization, eligibility, quota, export, routes, UI, and contact authority are deliberately outside this slice.
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
- Used Claude Sonnet for the bounded 0065 RED edit. Its broad first run was stopped with no edits; the narrowed run changed only the three allowed test files and Codex independently verified them.
- Committed the 0065 RED-only contract as 4c74b52.
- Attempted the bounded Sonnet 0065 forward/rollback draft after the RED proof. The Claude CLI exited before writing files with `Not logged in - Please run /login`; Codex and three bounded review/build lanes continued without treating the failed run as implementation evidence.
- Implemented the current 0065 candidate-evidence authority draft, including exact completed GitHub/Tavily receipt resolution, bounded Tavily expiry, governed manual verify/revoke chains, immutable member snapshots, canonical-state admission, campaign-grammar preflight, and erasure cleanup.
- Corrected review findings so exact idempotent replays occur after tombstone checks but before mutable canonical-state validation, transient evidence denials create no receipts, preflight validation is indexed and transaction-locked, and erasure counts an entire cascading manual chain before deletion.
- Preserved the append-only production migration ledger: a ledgered 0065 rollback now refuses with SQLSTATE 55000 and requires a new forward reversal migration; direct rollback/reapply remains limited to ledgerless disposable verification.
- Bound nested candidate-evidence deletion to the exact governed erasure request instead of trusting trigger depth alone, preserved later independent foreign keys and checks on forward retry, added uppercase UUID provider compatibility, and made risk-lowering manual revocation independent of aged display provenance.
- Repaired the receipt/list migration lock inversion and added a deterministic pg_locks/FIFO regression proving the actual 0065 migration waits without taking a list lock that can deadlock a concurrent 0064 add.
- Re-ran the final migration through the 78-case candidate-evidence suite, 51-case candidate-list suite, 78-case sourcing-batch suite, and 58-case autonomous-web suite; all are green. Recovery allowlists (15/15), manifest (11/11), privilege checks, harness syntax, and diff hygiene are also green.
- Committed the accepted 0065 source slice as 4fd02dc after an independent exact-hash audit returned PASS with no remaining P0/P1 inside the bounded migration.
- Audited the real email/LinkedIn connector surfaces and expanded `/Users/tony/.codex/plans/msourcing-linkedin-campaign-control-20260725.md` with separate Gmail/Microsoft and conditional HeyReach implementation and live-acceptance gates.
- Added the detailed Relay execution plan for 0066 and completed an independent adversarial audit covering cross-campaign bypass, multiple-hold release/expiry, destructive trigger gaps, verified provider evidence, lock upgrade/inversion, ACLs, rollback, and autonomous-web evidence plus linked staged-PII retention.
- Captured and committed the test-only 0066 contract as aa4d33c. On the accepted 0065 foundation it reproduced the real defect: campaign-B erasure returned `completed` while campaign-A's hold remained active. No production SQL was added.
- Implemented the reviewed forward-only 0066 authority and unconditional-refusal rollback, hardened legacy 0059/0060 rollback guards, registered all eight owner-only functions, updated the exact bootstrap digest, and committed the bounded source slice as `6bf97a6`.
- Closed four adversarial 0066 findings: inherited custom-role predecessor ACLs, replacement-hold transient unblocking, expiry during an advisory-lock wait, and list-versus-retention multi-candidate lock inversion.
- Reproduced the legacy rollback downgrade, added exact ledgerless partial-apply probes, fixed PostgreSQL 17 nondeterministic dump fingerprints, restored production-shaped Auth/extension fixtures in cloned databases, and closed the 0064 idempotence regression.
- Committed the rollback RED/probe/source chain as `c6342dd`, `7629f15`, and `a489065`. Independent database security and QA returned PASS with no remaining finding.
- Replanned P1.2 as read-only revision-bound previews. Contact export is deferred to P3.6 after eligibility and shared quota.

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
- bash -n tests/candidate-list-evidence-db.sh: exit 0.
- npm run test:manifest after registration: 11 passed, 0 failed; database group is frozen at 33 entries.
- bash tests/candidate-list-evidence-db.sh on the accepted migration: 78 assertions, 0 failed; includes the real receipt/list deadlock interleaving, stale-clock contention, later-named trigger mutation attempts, no-op update rejection, uppercase provider UUIDs, erasure, ledger refusal, and ledgerless rollback/reapply.
- bash tests/sourcing-batch-db.sh: 78 assertions, PASS.
- bash tests/autonomous-web-sourcing-db.sh: 58 assertions, PASS.
- scripts/test-db-privileges.sh: exit 0 after updating the exact schema digest and correcting the reviewed `SECURITY DEFINER` expectation for the private-table canonical guard.
- npm run typecheck and npm run typecheck:tests: exit 0.
- npm test: complete pretest, application, and posttest lifecycle exit 0 on the exact deadlock-fixed tree.
- npm run lint, npm run audit:dependencies, npm run build:isolated, and Gitleaks: exit 0; the isolated Next.js production build compiled and generated all 66 static pages.
- bash -n tests/candidate-global-legal-hold-db.sh: exit 0.
- npm run test:manifest after 0066 RED registration: 11 passed, 0 failed; database group is frozen at 34 entries.
- bash tests/candidate-global-legal-hold-db.sh before 0066 exists: intentional exit 1 with exact terminal evidence `0065 returned completed for campaign-B erasure while the campaign-A hold remained active`; this is the accepted RED proof, not a green implementation claim.
- bash tests/candidate-global-legal-hold-db.sh after 0066: 35 assertions, 0 failed.
- bash tests/candidate-erasure-db.sh: PASS. bash tests/sourcing-result-durability-db.sh: PASS with 8 rows. bash tests/autonomous-web-sourcing-db.sh: 58/58. bash tests/candidate-list-evidence-db.sh: 78/78. bash tests/candidate-lists-db.sh: 51/51. bash tests/sourcing-batch-db.sh: 78/78.
- npx tsx tests/function-privileges-contract.mts: 22/22. npm run test:db-privileges: PASS. npx tsx tests/recovery-schema-allowlists.mts: 15/15. npm run test:manifest: 11/11.
- gitleaks dir . --redact --no-banner --exit-code 1: no leaks across 22.97 MB. git diff --check: exit 0.
- `npm run typecheck && npm run typecheck:tests && npm test`: complete repository gate exit 0 on source commit `6bf97a6`.
- Independent final concurrency review: PASS, no P0/P1, exact focused artifact hashes matched, focused harness 35/35, and diff hygiene passed.
- bash tests/candidate-global-legal-hold-db.sh after the rollback repair: 36 assertions, 0 failed.
- bash tests/candidate-lists-db.sh: 51/51. bash tests/candidate-list-evidence-db.sh: 78/78. bash tests/candidate-erasure-db.sh: PASS. npm run test:manifest: 11/11.
- `npm run typecheck && npm run typecheck:tests && npm test`: complete pretest, application, and posttest lifecycle exited 0 on local source head `a489065`.
- Independent final rollback review: no findings; guard ordering, ledger and partial markers, deterministic fingerprints, bash syntax, diff hygiene, 36/36 and 51/51 all passed.

## Blockers

1. The local Claude CLI is not authenticated, so Sonnet cannot currently provide the requested execution lane. Exact error: `Not logged in - Please run /login`. This does not block local Codex implementation or independent review, but Sonnet execution proof remains unavailable.
2. Phase 1 still lacks revision-bound list previews, complete eligibility reasons, recent-contact and suppression gates, shared quota, authenticated API routes, accessible UI, browser E2E, and production-shaped performance evidence. Contact export remains deferred to P3.6.
3. Gmail/Microsoft connector activation is blocked by direct authenticated credential-table DML, OAuth/token-binding defects, missing native inbound subscription/cursor authority, absent protected secret names, missing database-enforced sender auto-pause, missing two-admin sender activation, and no authorized synthetic recipient.
4. HeyReach activation is blocked by missing written action entitlement, vendor security/privacy decision, official machine-readable API and webhook contract, sandbox proof, and any source implementation.
5. Parent PR 5 and stacked PR 7 remain unmerged. Exact-head CI run 30193073115 and CodeQL run 30193073101 had zero steps; all seven annotations say the Actions budget prevented startup.
6. The repository default is `vercel-demo`, not `main`; the requested protected-main release topology is unresolved and neither existing base ref contains this exact execution head.
7. Protected production deployment remains blocked by missing GitHub environment proof, purpose-bound secrets, two active tenant administrators, live model and Tavily bindings, Flowise image acceptance, telemetry, restore/failover, and accepted load evidence.
8. Fly still represents an older release. A health 200 or the old app shell is not proof for this branch.

## Next steps

1. Commit this Relay/plan milestone, push the local rollback-repair chain, then verify the exact remote SHA and fresh GitHub run annotations with `gh`.
2. Commit the RED-only 0067 contract, prove it fails for the exact missing revision/RPC boundary, then implement the additive read-only preview migration and guarded disposable rollback.
3. Continue Phase 1 in order: eligibility and suppression; shared quota; authenticated API; accessible recruiter UI; browser E2E and performance proof. Keep contact export in P3.6.
4. Complete campaigns and sender authority, then repair Gmail/Microsoft OAuth/token binding and implement native durable inbound adapters before provisioning connector secrets or authorizing a canary.
5. Treat HeyReach as dark capability only until the official contract and entitlement gates are met; never infer endpoints, webhook trust, or delivery evidence from marketing documentation.
6. Use four independent QA lanes across database/concurrency, security/privacy, API/UI/accessibility, and release/performance. After the whole implementation plan is complete, use Terra as the final independent validator.
7. Merge and deploy only through protected main after exact-SHA CI, CodeQL, independent approval, environment controls, migration readback, release identity, authorized sourcing/email canaries, telemetry, restore/failover, and capacity receipts are accepted.

## Decisions made (do not relitigate)

- Build an original ARIA workflow. Do not copy competitor code, assets, brands, private contracts, or deceptive UI.
- LinkedIn remains assisted-manual unless written platform entitlement or an approved contracted provider grants each exact automated action.
- Never capture LinkedIn passwords, PINs, cookies, li_at, browser sessions, fingerprints, proxies, captcha tooling, or stealth automation.
- ARIA owns tenancy, RBAC, approvals, lawful basis, suppression, erasure, budgets, claims, audit, and every egress decision. Framework agents may propose work but cannot own authority.
- Provider and manual evidence must be exact, tenant-bound, durable, and replay-safe. A best-effort mirror is display data, not authority.
- Existing list membership stores an immutable evidence snapshot. Later source expiry or revocation blocks new admission but does not silently rewrite history.
- Candidate-bearing mutations must take the canonical erasure identity lock before secrets, HMACs, receipts, evidence, or durable candidate data are written.
- Source-green, protected-CI-green, merged, deployed, canary-green, restore-green, and capacity-green are separate proof states.
- A privacy-authority repair that closes a known destructive bypass is reversed only by a new reviewed forward migration; 0066 has no enabled downgrade path.
- P1.2 returns identity-only, read-only set previews bound to exact list revisions. It creates no list, export, eligibility, enrollment, quota, or contact authority.
- Contact-bearing export remains P3.6 and cannot precede P1.3 eligibility plus shared quota.
- Direct production secret mutation, direct main pushes, and branch-protection bypass remain prohibited.
- Gmail and Microsoft 365 may become first-party live email channels after their independent source, secret, dual-control, release, and canary gates. Their activation does not authorize LinkedIn automation.
- HeyReach is a contracted-provider possibility, not presumed authority. ARIA will never collect LinkedIn credentials, PINs, cookies, sessions, or proxy settings; adding leads and activating a provider campaign must remain separate approved operations.

## Watch out

- Do not modify the OneDrive checkout.
- Do not activate outreach release controls or production sourcing from this branch.
- Do not use public.candidates as the final 0065 provenance authority.
- Do not turn an expired Tavily observation into permanent admission authority; snapshot it only when currently valid.
- Do not delete existing list history merely because provider evidence later expires or is revoked; governed candidate erasure is separate.
- Do not report manual completion as provider-confirmed sent or delivered evidence.
- Do not treat browser-triggered top-N mailbox polling or generic degraded webhooks as a durable unified inbox.
- Do not provision connector secrets until the protected workflow allowlist and readiness preflight preserve the exact purpose-bound names.
- Do not interpret a zero-step GitHub failure as a code failure. Inspect current run annotations with gh.
- Do not claim production-ready, enterprise-ready, live-sourcing-ready, or 50,000-user-ready while any blocker above remains.
- Do not expose contact data, lawful-basis conclusions, evidence hashes, or provider pointers from the 0067 preview RPC.
- Never delete _relay/archive and never place secrets or candidate PII in Relay files.
