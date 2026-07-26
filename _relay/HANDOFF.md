---
project: MSourcing / ARIA
shift: 48
agent: codex-gpt-5
updated: 2026-07-26 09:48 EDT
status: E1.1 pushed and locally green; GitHub jobs budget-blocked; production blocked
---

# Handoff - MSourcing / ARIA

## Current state

- Work only from /Users/tony/msourcing-heyreach-foundation-20260725. Do not modify the OneDrive checkout.
- Active branch: codex/candidate-lists-phase1-20260725.
- Source commit 252d304 and Relay closeout 38a51f8 are pushed on codex/candidate-lists-phase1-20260725. Remote readback matched 38a51f8f98ef4e743925b42283a8d84635265e08 before this snapshot.
- Stacked PR 8 is open against codex/heyreach-foundation-20260725: https://github.com/mysticalsin/aria-sourcing/pull/8. That base is the head of PR 7 and is an ancestor of this branch.
- Migration 0067 adds revision-bound, identity-only union, intersection, difference, and exclusion previews. It does not authorize contact export, eligibility, enrollment, provider egress, or outreach.
- Exact 0067 hashes: forward ae101d72145094b21e44694c3c00b37b3b0824c9ab1bb9780f65d9608ff1d4dd; rollback ef77b9aae9cb5252d3e09adc9ffa4937ba2ef40d8387388c1ad5f3d1bf2ccdc7; canonical public schema 57d3d93569234be40259aab0a98df602a0b654510c4c358ce537ac957c881a0b; revision helper MD5 9503b3155d4fe3331fc20a3f5892dcaa.
- The focused PostgreSQL 17 suite passes 131 assertions. It covers exact catalog and ACL shape, tenant disclosure, bounded traversal over 50,000 canonical candidates, rollback poison states, real RPC concurrency, erasure, legal hold, and deployment preflight.
- Final regression results: candidate lists 51/51; list evidence 78/78; candidate-global legal hold 36/36; candidate erasure exit 0; owner/recovery/privilege exit 0 on three accepted runs after the reviewed digest.
- The exact final command (npm run typecheck && npm run typecheck:tests && npm test) exited 0 with both compiler commands and the complete pretest, application, and posttest lifecycle in one preserved log.
- Additional final gates: lint exit 0; production dependency policy clean with one reviewed development advisory expiring 2026-08-08; isolated production build exit 0; Gitleaks scanned 23.30 MB with no leaks; git diff and shell syntax checks exit 0.
- Independent final security and QA reviews both returned PASS after two corrections: rollback now detects every retained-predecessor overload, and Fly preflight uses a bounded one-row existence probe instead of count(*).
- Gmail and Microsoft OAuth/send primitives and a durable email outbox exist, but live activation is unsafe. Direct authenticated credential DML, incomplete provider/mailbox/tenant binding, refresh-token loss/rotation defects, the synchronous send bypass, weak inbound recovery, and missing database sender-health pause remain open.
- HeyReach has no implementation. No endpoint, authentication, webhook, idempotency, or provider receipt is assumed.
- The reviewed 0068 design is an admin-attested, append-only eligibility evidence lifecycle plus a read-only eligibility snapshot. It must remain unable to export contact data, mutate sequences, enqueue messages, or call providers. Later egress integration must re-evaluate eligibility at activation, claim, and completion.
- The executable 0068 contract is now recorded in _relay/plans/08-candidate-outreach-eligibility-authority.md. It uses a revision-bound paginated evaluator, binds evidence to an immutable member generation and purpose-separated recipient HMAC, stores no recipient plaintext or ciphertext, and fails closed on unknown ledger states.
- The committed 0068 RED harness is historical one-stage evidence only and currently makes the canonical no-argument manifest mode red. Commit 474172e is not accepted R1 or R2 proof. The corrective harness must make no-argument mode green with a verified clean-stage skip and reserve intentional exit 1 for explicit --prove-red R1 or R2.
- PostgreSQL feasibility review reopened the 0068 design before production SQL. Canonical candidates are currently inside one unindexed workspace-state JSON array, so the plan cannot claim indexed canonical lookup for each page item. The self-FK also needs an explicit referenced unique key, and a trigger predecessor cannot be called as an ordinary wrapper function.
- The amended plan now reserves 0068 for five exact concurrent indexes under one session-locked Fly migration phase and moves eligibility authority to 0069. It adds a separate strict workspace-state identity projection, resumable backfill/readiness cutover, descending chain leaf, recipient-drift-safe revocation, privacy-safe evidence references, bounded unknown-ledger and suppression probes, independent erasure cleanup, and durable-receipt rollback refusal.
- Exact-hash review c609eb1899c045a120de8ab145d0e36b289447087a3cfc01466d624fe5e10b4f received adversarial PASS, but schema and RED-plan NO-GO. The two remaining defects were a T2 ledger lock mode that did not conflict with ordinary inserts and missing security-definer authority for the readiness bridge and both public RPCs.
- The exact replacement snapshot is 239781e8b828dfc6129f3ff8e6305a5027434f9da11d8dff12f4799a2a5003b1. It pins a separate SHARE ledger lock, PostgreSQL-owned security-definer execution modes, exact search paths, volatility, ACLs, and catalog/body postflight. Independent schema-feasibility, adversarial, and RED/release reviewers each returned PASS after reading the full exact snapshot. Production SQL remains absent.
- E1.1 now implements explicit --prove-red R1/R2 parsing, complete clean-R1 source/ledger/five-index absence checks, exact canonical 0068 filename and marker refusal, no-argument verified SKIP, and the pinned R1 intentional exit. Real disposable PostgreSQL 17 runs prove no-argument exit 0 and explicit R1 exit 1 on `candidate-outreach-eligibility-db RED: online index foundation is absent after exact 0067`.
- Final E1.1 harness SHA-256 is 2cd92ad0d9ec65265e29deb0bcef59cffba232d8250a0815e948a002bb675095. Three independent implementation reviewers returned PASS after exercising duplicate 0067 source, out-of-order later source, malformed/later ledger filenames, BOM, NUL, CRLF, missing LF, invalid CLI, premature R2, and the real PostgreSQL R1 modes.
- The exact final command `npm run typecheck && npm run typecheck:tests && npm test` exited 0 after the final harness byte was frozen. It ran both compilers and the complete pretest, application, and posttest manifest lifecycle. Shell syntax, diff hygiene, manifest 10 pass/1 expected skip, and bootstrap 62/62 also pass.
- Commit 4dfe1c3 records the reviewed plan, final E1.1 harness, findings, and Relay evidence. Commit 4baff0e closes the eight resolved findings. Both are pushed; remote readback and PR 8 head matched full SHA 4baff0ecfba476cfc32d609787e1473a32ff43f3.
- Exact-head push runs 30204759867 and 30204759888 and pull-request runs 30204761011 and 30204761003 completed with zero steps. Every CI and CodeQL check annotation says: `The job was not started because an Actions budget is preventing further use.` No workflow log exists because no step started.
- No production secret was changed, no provider was called, no candidate was contacted, and no Fly deployment occurred.

## Done this shift

- Implemented migration and guarded rollback 0067, exact schema inventory, privilege registration, public-schema digest, and Fly live-table preflight.
- Repaired the inherited first-secret add-member versus migration lock inversion with a workspace-state and receipt-table wrapper boundary.
- Repaired a real revision-trigger deadlock by using sorted FOR NO KEY UPDATE list locks, compatible with existing foreign-key and governed-writer FOR KEY SHARE locks.
- Added deterministic real-RPC and opposite-order concurrency proof.
- Corrected the EXPLAIN oracle so blocking nodes must consume bounded source limits and interleaved union can stop its right stream early without weakening row caps.
- Isolated erasure/hold proof in a clean accepted template and added canonical workspace state to every rollback data fingerprint.
- Added exact rollback poison coverage for reserved overloads, direct ACL drift, disabled and false-qualified triggers, function-body drift, missing artifacts, wrapper/predecessor partial states, and later/noncanonical ledgers.
- Replaced the unbounded deployment preflight count with EXISTS plus LIMIT 1 and a test that rejects count(*) in that authority block.
- Completed provider-auth and eligibility adversarial audits with exact implementation order and RED test requirements.
- Reconciled independent eligibility, schema, and RED-test reviews into the locked 0068 plan, including the exact no-egress boundary, 28-reason precedence, tenant member key, sorted multi-identity erasure lock order, rollback contract, and four-lane QA matrix.
- Added and locally verified the 0068 RED-only harness and exact manifest registration. No 0068 migration, rollback, or production SQL exists yet.
- Reconciled three new read-only architecture reviews into the 0068/0069 plan. `public.candidates` remains best effort; the new projection is owner-only and purpose-specific. No production object was created.
- Reconciled the second exact-hash review: corrected the migration-ledger lock conflict and pinned definer authority for readiness, attestation, and evaluation. Frozen replacement plan hash 239781e8b828dfc6129f3ff8e6305a5027434f9da11d8dff12f4799a2a5003b1 for third review.
- Received PASS from all three third-review lanes on the exact frozen plan hash. Implemented and locally exercised the E1.1 two-stage harness state machine without adding production SQL.
- Corrected four E1.1 false-green edges found during independent implementation review: later source, malformed/later ledger, duplicate 0067 source, and NUL-bearing first-line markers. All three final reviewers PASS exact harness hash 2cd92ad0.
- Committed the accepted E1.1 slice as 4dfe1c3 and reconciled its eight plan/test findings to that exact commit.
- Pushed E1.1 and Relay closeout through 4baff0e, verified exact remote SHA and PR 8 head, and inspected all four fresh GitHub runs, jobs, missing logs, and annotations with gh.
- Committed the source slice as 252d304.
- Archived the prior baton to _relay/archive/2026-07-26-0808-codex.md.

## Blockers

1. Exact-head CI run 30201518880 and CodeQL run 30201518890 completed without executing any step. All seven check annotations say: The job was not started because an Actions budget is preventing further use. This is an account-capacity blocker, not a code-failure diagnosis.
2. Exact-head protected CI and CodeQL are unproved because GitHub Actions budget prevented every job from starting. This is not a code-failure diagnosis; restore account capacity and rerun the exact head.
3. Phase 1.3 eligibility, shared quota, authenticated APIs, accessible recruiter UI, browser E2E, and performance acceptance remain unimplemented.
4. Gmail/Microsoft cannot be activated until credential DML is revoked, transactional OAuth binding and token rotation are repaired, all email goes through the durable queue, native inbound recovery exists, sender health pauses database dispatch, and authorized synthetic mailbox canaries pass.
5. HeyReach remains blocked by written action entitlement, official API/webhook contract or sandbox, vendor security/privacy approval, and a source adapter with reconciliation and dual control.
6. The local Claude CLI is unauthenticated. Exact error from the prior shift: Not logged in - Please run /login. No Sonnet or Fable execution claim is permitted.
7. Fresh exact-head GitHub runs on 46045db again contain zero steps. Every CI and CodeQL annotation says the job was not started because an Actions budget is preventing further use.
8. GitHub default branch was vercel-demo rather than main at the last verified read. Protected branch topology must be reconciled before merge.
9. Fly serves an older release. The live app remains unaccepted until exact release identity, migrations, readiness, provider canaries, telemetry, restore/failover, and capacity receipts pass.

## Next steps

1. Restore GitHub Actions budget, rerun CI and CodeQL on the current PR 8 head, inspect every job and annotation with gh, and require exact-SHA green before merge.
2. Implement and prove the 0068 session-locked concurrent-index foundation. Extend the harness with exact online catalog, crash/retry, receipt, reverse, and R2 behavior before committing 0068.
3. Implement 0069 strict projection, backfill/readiness gate, evidence lifecycle, evaluator, erasure, and rollback with no provider or send side effect.
4. Integrate 0063 campaign/version/task authority with eligibility checks at activation, claim, and completion. Make the durable outbox the only email send path.
5. Repair Gmail and Microsoft OAuth/token identity, protected secret inventory, native inbound recovery, pacing, reply stop, and sender-health authority. Run fake-provider fault tests before any authorized synthetic canary.
6. Keep HeyReach dark until the external entitlement and contract blockers are cleared. Then add a disabled adapter, exact receipt reconciliation, dual control, sandbox proof, and a separately authorized canary.
7. Run four independent QA lanes across database/concurrency, security/privacy, API/UI/accessibility, and release/performance. Use Terra only as the final independent validator after the full roadmap is implemented.
8. Merge and deploy only through the protected branch and environment workflow after exact-SHA CI, CodeQL, release identity, migration readback, authorized canaries, restore/failover, and capacity evidence pass.

## Decisions made (do not relitigate)

- Build an original ARIA workflow. Do not copy competitor code, assets, brands, private contracts, or deceptive UI.
- ARIA owns tenancy, RBAC, approvals, lawful basis, suppression, erasure, budgets, claims, audit, and every egress decision. Agent frameworks may propose work but cannot own authority.
- Source-green, protected-CI-green, merged, deployed, canary-green, restore-green, and capacity-green are separate proof states.
- Candidate-bearing mutations use the canonical erasure identity lock before candidate data, secrets, evidence, or receipts are written.
- P1.2 is a read-only identity preview only. Contact-bearing export remains deferred until eligibility and shared quota are accepted.
- Gmail and Microsoft may become first-party email channels only after exact source, secret, dual-control, release, and canary gates.
- LinkedIn remains assisted-manual unless written platform entitlement or an approved provider grants each exact automated action.
- HeyReach is a conditional contracted-provider path, not presumed authority. Never collect LinkedIn passwords, PINs, cookies, sessions, fingerprints, proxies, captcha tooling, or stealth automation.
- Direct production secret mutation, direct main pushes, and branch-protection bypass remain prohibited.

## Watch out

- Do not edit the OneDrive checkout.
- Do not activate production sourcing, email drain, LinkedIn automation, or HeyReach from this branch.
- Do not treat candidate list membership or revision as current contact eligibility.
- Do not use browser candidate JSON or the best-effort public.candidates mirror as legal/provenance authority.
- Do not expose recipient data, contact HMACs, evidence hashes, lawful-basis material, or provider pointers from preview or eligibility snapshots.
- Do not interpret a health 200, old app shell, local green gate, or zero-step CI run as a current production acceptance.
- Do not provision connector secrets until the protected workflow knows their exact purpose-bound names and readiness rules.
- Never delete _relay/archive and never write secrets or candidate PII into Relay files.
