---
project: MSourcing / ARIA
plan: 04-sonnet-execution
owner: Claude Sonnet
updated: 2026-07-14
status: local-correctness-ready-release-blocked
---

# Plan 04: Sonnet execution handoff

This is an executable shift plan for Claude Sonnet. Keep local source proof,
integration, protected release, and live sourcing acceptance as separate gates.

## Current verified state

- Worktree: `/Users/tony/.codex/worktrees/msourcing-structure-hygiene`.
- Branch: `codex/aria-structure-hygiene-20260714`.
- Booking/report actions are extracted into
  `src/lib/store/booking-report-actions.ts`; React wiring remains in
  `src/lib/store.ts` as the public facade.
- Booking creation revalidates permission, workspace, candidate identity,
  campaign, stage, interviewer, and slot after calendar I/O and inside commit.
- Provider receipts use `Booking.calendarSync`; provider-linked reschedule and
  cancellation fail closed until server synchronization exists.
- Terminal Completed and No Show bookings permit a later interview round. Past
  reschedules and all four contact-prohibition flags are rejected.
- Calendar UI distinguishes live provider events from demo dry-run bookings.
- Runtime booking/report suite: 25/25. Manifest contract: 8/8. Workspace
  effects: 13/13. Store contracts: 11/11. Typechecks, lint, and diff checks
  are green on the working tree.
- Current source is not yet integrated into local `main`, pushed, deployed, or
  proven against live Fly services.

## Step 1: finish local proof

Run from the worktree and stop on the first failure:

```sh
npm run typecheck
npm run typecheck:tests
npm run lint
npm run test:manifest
npm test
npm run build:isolated
git diff --check
```

Inspect the diff. Only booking/report extraction, slot validation, provider
receipt typing, honest calendar UI, tests, manifest parity, and Relay notes
belong in this change. Never put API keys, candidate PII, or live output into
source, fixtures, logs, or Relay.

## Step 2: review and commit

Append any open findings to `_relay/codex-findings.md`. The durable server-side
booking ledger remains an open production finding even if this local change is
green.

```sh
git diff --stat
git status --short
git add src/app/api/calendar/event/route.ts src/app/calendar/page.tsx \
  src/app/campaigns/[id]/page.tsx \
  src/components/candidates/candidate-drawer.tsx src/lib/booking-status.ts \
  src/lib/mock-ai.ts src/lib/store.ts src/lib/store/booking-report-actions.ts \
  src/lib/store/booking-slot.ts src/lib/types.ts \
  tests/store-booking-report-actions.mts tests/test-manifest-contract.mts \
  tests/test-manifest.mjs tests/workspace-effectful-actions.mts \
  _relay/codex-findings.md _relay/plans/plan-04-sonnet-execution.md
git commit -m "refactor: harden booking and report action boundaries"
```

Rerun the narrow proof after committing and write the final SHA into the
baton. Never reset, clean, or discard concurrent files.

## Step 3: reconcile into local main

```sh
git status --short --branch
git log --oneline --decorate -12
git diff main...HEAD --stat
```

With a clean worktree and green focused commit, integrate the reviewed commits
into local `main` using a reviewed fast-forward or merge. Run the complete
source, security, build, database, recovery, Graphify, and review-lane gates on
the final `main` SHA. Record every exit code.

## Step 4: GitHub release gate

This is blocked until Tony proves that previously exposed GitHub, Fly, and
provider credentials were rotated, access history reviewed, and the current
identity has least-privilege production release authority. `gh auth status`
alone is not proof.

After that evidence exists:

```sh
gh auth status
gh pr view 3 --repo mysticalsin/aria-sourcing-demo
gh pr checks 3 --repo mysticalsin/aria-sourcing-demo
gh run list --repo mysticalsin/aria-sourcing-demo --limit 10
gh run view <run-id> --repo mysticalsin/aria-sourcing-demo --log-failed
git push origin main
```

Read back the remote SHA, exact workflow run, annotations, CodeQL alerts, and
secret-scan result. Fix only from logs if a check is red. Never bypass required
checks.

## Step 5: protected Fly deploy

Deploy only through the protected GitHub workflow. Do not use `fly deploy`,
`supabase db push`, or SQL Editor against production. Verify the target SHA,
migration-ledger parity, and protected bootstrap job first.

After dispatch, verify exact SHA and service health:

```sh
fly status --app aria-mantu-app
fly machine list --app aria-mantu-app
curl -fsS https://aria-mantu-app.fly.dev/login
curl -fsS -o /dev/null -w '%{http_code}\n' https://aria-mantu-app.fly.dev/rest/v1/
curl -fsS -o /dev/null -w '%{http_code}\n' https://aria-mantu-app.fly.dev/auth/v1/health
```

Confirm database/auth machines stay running, migration parity, restart,
backup, and restore evidence. A 200 login page alone is not acceptance.

## Step 6: real sourcing acceptance

Do not call sourcing real until deployed provider configuration is verified.
Verify server-side secrets exist without printing them, provider entitlement is
active, and the approved model returns evidence-backed results.

1. Sign in with an approved admin.
2. Create a campaign with explicit needs and lawful sourcing purpose.
3. Run sourcing through the server-owned provider path.
4. Confirm candidates have source URLs, opaque provider receipts, query
   provenance, timestamps, and no fabricated fields.
5. Confirm deduplication, suppression, review, rejection, and erasure.
6. Confirm Graphify receives only approved aggregate lesson evidence and that an
   accepted lesson changes a later ranking/query decision.
7. Keep outreach, calendar, and paid provider actions behind owner approval.

If a provider is missing, underfunded, or returns 401/402/5xx, record the exact
external blocker and stop. Do not substitute mock reports or prompt echoes for
real candidates.

## Step 7: framework and readiness closure

DeerFlow and Flowise remain inactive until immutable image evidence, private
Fly deployment, constrained egress, bootstrap, PostgreSQL/Redis HA, restore,
role readiness, and disabled-role absence proofs exist. Graphify learning must
have a bounded receipt and no candidate PII. Weekly reports must use stored
campaign evidence, not fixed claims from `src/lib/mock-ai.ts`.

Only after all seven steps are green may the baton status become
`production-ready`. Until then use `local-source-green-release-blocked` and
list exact blocker, evidence, and next command.

## Shift-end Relay requirement

Archive the current `_relay/HANDOFF.md` under `_relay/archive/` with the shift
timestamp, then rewrite `_relay/HANDOFF.md` with exact SHA/branch, tests and
exit codes, changed files, open production blockers, next Sonnet commands,
decisions not to relitigate, and no secrets or candidate data.
