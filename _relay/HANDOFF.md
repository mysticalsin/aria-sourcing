---
project: MSourcing / ARIA
shift: 37
agent: codex-gpt-5
updated: 2026-07-13 14:00 EDT
status: apollo-authority-source-green-protected-release-and-live-no-go
---

# Handoff - Apollo paid authority complete, protected production release blocked

## Current state

- Continue only in:
  `/Users/tony/.codex/worktrees/msourcing-campaign-integration`.
- Branch: `main`.
- Apollo authority source commit:
  `ced2a58aa3c06530e46a712ddb2e0e155104a62e`.
- Local `origin/main` tracking ref remains:
  `bc4633663c9a7ba3b3b4d52b7f3654384e471cb6`.
- Before this Relay evidence commit, local `main` was eight commits ahead of
  that tracking ref. Re-run `git rev-list --left-right --count
  origin/main...main` before any remote action.
- Bounded source verdict for Apollo paid enrichment: GO.
- Protected-release source verdict: GO, conditional on all external owner and
  credential gates below.
- Release verdict: NO-GO.
- Production verdict: NO-GO.
- The latest source migration is
  `supabase/migrations/0026_apollo_enrichment_authority.sql`.
- Canonical local gate: 146 checks, comprising 28 pretest commands and 118
  test commands.
- Detailed execution plan:
  `/Users/tony/.codex/plans/msourcing-aria-remaining-campaign-blockers-20260712.md`.
- Adversarial audit record:
  `_relay/codex-findings.md`.
- Prior baton archive:
  `_relay/archive/2026-07-13-1400-codex-gpt-5.md`.

## Done this shift

- Implemented exact Apollo paid-operation authority in migration 0026:
  - search persists the provider candidate before paid selection;
  - selection creates an opaque server-owned binding to workspace, tenant,
    campaign, candidate, provider target, and current persisted candidate;
  - prepare claims that binding before a human confirmation is issued;
  - commit serializes quota and idempotency authority, revalidates the persisted
    candidate and target, and records append-only audit evidence;
  - candidate removal, mismatch, provider change, or anonymization revokes the
    authority;
  - same-workspace authorized teammates may complete a prepared operation;
    cross-workspace, cross-tenant, campaign, candidate, target, and replay
    attempts fail closed.
- Implemented bounded retention and erasure:
  - encrypted receipts are retained for 30 days;
  - terminal expired target handles are replaced with `expired:<uuid>` and the
    provider profile hash is zeroed;
  - unresolved `in_progress` and `ambiguous` provider handles remain available
    only for reconciliation;
  - the exact erasure RPC is idempotent and converges after a lost response.
- Moved Apollo paid work into the React-free sourcing action factory and added
  exact typed public errors, current-role checks, current-candidate checks, and
  persisted commit truth.
- Made shared-state persistence authoritative before selection or enrichment
  can report success. A failed save retains one retryable combined snapshot;
  successful retry installs that exact snapshot locally under the skip-persist
  guard before clearing recovery state.
- Added `src/lib/candidate-privacy.ts` as the canonical candidate-rights
  projection. It removes provider IDs and authority, content, outreach,
  replies, bookings, wins, ledger PII, suppression mirrors, linked activities,
  chatbox submissions, ingested IDs, and structured chat PII while preserving
  unrelated boundary-safe text.
- Added selection, admin reconciliation, and admin erasure APIs with strict
  JSON media type, streamed-body byte bounds, no-store typed errors, and exact
  workspace authority.
- Added the 5-route, 187-reference OpenAPI contract plus API, retention, and
  reconciliation documentation.
- Added the Fly cleanup process and release verifier:
  - native Node fetch with `redirect: "error"` and a 10-second abort;
  - startup plus six-hour bounded cleanup passes with workspace isolation;
  - structured release SHA and cleanup counters, including
    `expired_targets_scrubbed`;
  - exact promoted image digest on every web and cleanup Machine;
  - at least one started web Machine;
  - exactly one started cleanup Machine plus one stopped, explicitly paired
    standby on the same digest;
  - one success event for the exact release SHA created after app activation.
- A real two-origin redirect test proved the privileged cleanup request did
  not send `apikey` to the redirected origin.
- Bound the release verifier into `deploy-fly.sh` before deployment receipt
  issuance and copied the worker into the production image.
- Updated the canonical documentation truth to 146 checks and migration 0026.
- Closed the independent full-stack, Cybersecurity Director, and release QA
  findings for the bounded Apollo and protected-deploy source scope. All three
  issued GO after the corrections above.
- Committed the reviewed source on local `main` as `ced2a58`.

## Verification evidence

- One unchanged source snapshot completed with exit 0:
  - `npm run lint`;
  - `npx tsc --noEmit`;
  - `npm test`;
  - `npm run build`;
  - production-image-layout cleanup-worker smoke;
  - `git diff --check`.
- The final application chain reported zero failures. Focused results include:
  - deploy contract 131/131;
  - bootstrap contract 54/54;
  - infrastructure release contract 132/132;
  - volume recovery 35/35;
  - readiness 9/9;
  - public fetch 43/43;
  - function privilege 21/21;
  - Apollo cleanup 5/5;
  - candidate privacy 9/9;
  - erasure route 3/3;
  - store sourcing actions 35/35;
  - OpenAPI 5 routes and 187 references;
  - Apollo authority 47/47;
  - source authority helper 9/9;
  - selection 3/3;
  - reconciliation 8/8;
  - live-role authority 23/23;
  - workspace runtime 18/18;
  - documentation truth 35/35.
- The production Next.js 16.2.10 build compiled and generated every route.
- `npm run test:db-apollo-enrichment` exited 0 on the final database snapshot:
  migration 0026 only, serialized concurrency, same-workspace teammate handoff
  allowed, terminal provider handle scrubbed, unresolved reconciliation handle
  preserved.
- `npm run test:db-privileges` exited 0 on the final database snapshot:
  restricted direct owner sessions, approved legacy baseline and ledger, and no
  secret leak.

## Blockers

1. GitHub credential rotation is not proven. Do not reuse any previously
   exposed or uncertain credential.
2. The identity and authority of the actor that advanced the remote tracking
   ref are still unexplained. Prove provenance before trusting the remote.
3. The local source and Relay commits have not been pushed.
4. Fly credential rotation and owner-controlled organization access are not
   proven.
5. Exact-SHA CI and CodeQL evidence for `ced2a58` and the final Relay commit do
   not exist because those commits are local.
6. The protected production workflow has not applied migration 0026 or
   deployed the new web and cleanup process groups.
7. Read-only live inspection during this wave showed the existing app on the
   older `app` process group with one started and one stopped Machine. That is
   not evidence for the new `web` plus `cleanup` topology.
8. The owner-controlled branch, environment, secret, approval, first-admin,
   and recovery controls remain unverified live.
9. No staging or production receipt yet proves the exact promoted digest on
   active web, active cleanup, and cleanup standby Machines with a fresh
   post-activation cleanup success event.
10. Admin provisioning, restart recovery, two-user authority, one real
    campaign, and real email and WhatsApp acceptance remain unproven.
11. `npm run test:fly-db-volume` previously failed before recovery assertions
    because Docker could not fetch Alpine 3.23 APK indexes. Re-run on a clean
    network; do not bypass the repository or recovery check.
12. Seamless and Sillage still accept raw paid-operation or asynchronous
    provider handles without the Apollo server-owned binding model. The
    sourcing-agent route still accepts overly broad client objects.

## Next steps

1. Rotate GitHub credentials, audit repository access, identify the remote
   actor, and prove the current remote `main` SHA through owner-controlled
   authentication.
2. Reconcile local `main` with verified remote truth without force or history
   destruction. Push `ced2a58` and the Relay evidence commit only after that
   proof.
3. Inspect and capture exact-SHA CI and CodeQL results. Fix every current
   annotation before release.
4. Use the protected production environment and owner approval to create the
   exact recovery receipt and run the hardened deployment workflow. No manual
   unprotected deployment is an acceptable substitute.
5. Apply migration 0026 through the migration ledger, then verify database,
   Auth, PostgREST, Kong, application, and readiness behavior against the exact
   deployed SHA and image digests.
6. Prove the new live topology: started web, started cleanup, explicitly paired
   stopped cleanup standby, every Machine on the promoted digest, and one
   cleanup event for the exact release SHA after app activation with every
   counter present.
7. In staging, prove receipt expiry, terminal provider-handle scrubbing,
   unresolved-handle retention, erasure lost-response convergence, replay
   denial, cross-boundary denial, and same-workspace authorized teammate
   completion.
8. Provision the first admin through the owner-controlled path. Run restart,
   two-user role separation, a complete campaign, candidate sourcing, Apollo
   selection and enrichment, approval, real email, real WhatsApp, reply,
   booking, reporting, export, erasure, and recovery acceptance.
9. After Apollo is live and accepted, apply the same opaque server binding,
   bounded DTO, public-error, retention, erasure, and reconciliation model to
   Seamless and Sillage. Then harden the sourcing-agent client contract.

## Decisions made (don't relitigate)

- Paid provider authority is server-owned and opaque. A raw client provider ID
  never authorizes spend or disclosure.
- Persist the candidate before selection, prepare before human confirmation,
  and commit only against the exact receipt-bound authority.
- Same-workspace authorized teammate handoff is allowed. Tenant, workspace,
  campaign, candidate, target, and replay boundaries remain exact.
- Scrub terminal expired provider handles. Retain unresolved handles only for
  bounded reconciliation.
- Candidate-rights UI must state what the system actually removes and saves;
  it must not claim immediate global deletion.
- Privileged worker requests deny redirects and have bounded timeouts.
- Release proof binds the exact SHA, image digest, process topology, activation
  window, and complete cleanup counters.
- Source, release, and live acceptance are separate claims.
- No exposed or unproven credential may be reused.
- No push or production deploy is authorized until remote actor provenance and
  credential rotation are proven.

## Watch out

- The original OneDrive checkout is dirty and remains on
  `deploy/fly-github-actions`. Do not clean, reset, switch, or discard it.
- Work only in the integration worktree above unless a new isolated worktree is
  intentionally created.
- Claude and Codex share this worktree. Treat every uncommitted file as real
  work and inspect `git status` before editing or committing.
- Do not put credentials, cookies, emails, Machine IDs, or tokens into argv,
  process listings, logs, Relay, URLs, or fixtures.
- Do not infer safe authentication from a tracking ref or successful network
  connection.
- Do not push through unrotated authentication and do not run an unprotected
  production deploy.
- The current live `app` process group is old topology, not proof of the new
  `web` plus `cleanup` release.
- An interrupted test is not evidence. The valid final source proof is the
  unchanged-snapshot exit-0 gate and the two exit-0 PostgreSQL gates above.
- Keep the broader enterprise verdict open until Seamless, Sillage, the
  sourcing-agent boundary, the protected release, and live acceptance close.
