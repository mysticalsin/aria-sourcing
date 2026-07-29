# Production update runbook — owner-run, `704130c`

Written 2026-07-29. Everything below needs production credentials and mutates a live tenant
database, so it is yours to run, not mine. My job here is to make each step exact, name what it
changes, and tell you where it can go wrong.

**Current state:** all work is pushed. `origin/integration/sourcing-enrichment-on-main` = `704130c`,
local in sync, full gate plus `next build` green at that SHA (151 suites, 316 tests).
`origin/vercel-demo` — the default branch Vercel deploys — is at `14f76f1`, **244 commits behind**.

---

## The hard precondition: code at `704130c` requires migrations `0049`–`0053`

Production has none of them. Deployed code would call functions that do not exist:

| Migration | Adds what the code now calls |
|---|---|
| `0049` | `read_workspace_state_for_loop`, `complete_aria_job_with_workspace_patch` |
| `0050` | `sourcing_loop_stage_enabled`, `read_inbound_email_for_loop` |
| `0051` | `attach_provider_run`, `settle_provider_run_by_external`, `read_provider_run_for_loop` |
| `0052` | `aria_job_payload_contract_ok`, `redact_loop_events_for_candidate_erasure` |
| `0053` | `promote_due_sequence_steps`, `record_sequence_step_sent`, `release_elapsed_outreach_contact_window` |

So the order is **migrations first, deploy second**. Reversing it breaks the live app.

---

## Step 0 — take a backup and know what production actually has

Do not trust this document about prod state; measure it.

```bash
# scripts/backup.sh enforces the migration-ledger match and refuses on drift — that refusal
# is information, not an obstacle. Run it first.
./scripts/backup.sh

# Then read the ledger. This is the authoritative list of what prod has applied.
#   select filename, sha256 from public.aria_schema_migrations order by filename;
```

Compare that list against `ls supabase/migrations/*.sql`. Expect prod to stop at `0048`. If it
stops somewhere else, STOP and tell me — the plan below assumes `0049`–`0053` are the gap.

## Step 1 — apply `0049`–`0053`, in order, one at a time

Reuse the established pattern rather than inventing one: `scripts/prod-apply-swarm-fixes.sh` already
runs `psql -v ON_ERROR_STOP=1` inside a Fly image against the prod database and then reconciles
`aria_schema_migrations.sha256` for the files it applied (`:63-74`). Apply in ascending order and
stop at the first error.

**Two of these do more than add functions — know before you run them:**

- **`0052` mutates existing data.** It enforces the ids-only `aria_jobs` payload contract, and its
  migration-time cleanup UPDATEs `payload`, `payload_sha256` and `updated_at` on any existing row
  that violates the new contract. On a production queue with in-flight jobs, that rewrites their
  payloads. Check `select count(*) from public.aria_jobs where status in ('queued','leased')` first;
  if it is non-zero, drain or accept that those payloads get normalised.
- **`0053` alters existing functions**, including `correlate_inbound_email` and `claim_and_record`.
  Behaviour was diffed function-by-function against the versions replaced, and two behaviours the
  first attempt dropped (reply-outcome recording, candidate-erased handling) were restored and are
  asserted. Still: this changes live email-correlation behaviour, so apply it when you can watch.

## Step 2 — verify before deploying anything

```bash
./scripts/backup.sh        # must now PASS the ledger match, having refused before step 1
npm run test:db-privileges # legacy_baseline=approved, and the reviewed-schema fingerprint matches
```

The fingerprint pinned in `docker/bootstrap/legacy-baseline-public-schema.sha256` was earned by
dump-diff at each migration, not pasted. If it mismatches against prod, the prod schema is not what
source says — stop and tell me.

## Step 3 — deploy the app

The sanctioned path is `.github/workflows/deploy-aria-mantu.yml`, `workflow_dispatch` only (no push
trigger — this is why pushing the branch deployed nothing). It requires:

- `release_sha` — "Exact 40-character commit SHA **already passed by CI and CodeQL**"
- `recovery_receipt_sha256` — the reviewed production recovery receipt

**Blocker you need to clear first:** the GitHub Actions budget is exhausted, so no CI or CodeQL run
has validated `704130c`. That input cannot be honestly satisfied today. Restoring the budget and
letting CI go green on the pushed branch is the cheapest way through, and it also gives you the one
check this machine cannot perform — a fresh `npm ci && npm run build`, which is the exact class of
defect that broke a clean build on 2026-07-24 and again on 2026-07-26.

`deploy-fly.sh` is the other path; it now survives its own release verifier for the `loop` process
group (fixed at `453301e`), and it deploys at `:1050`, checks health and readiness at `:1056-1057`,
then verifies machines at `:1071`.

## Step 4 — prove it, do not assume it

```bash
curl -fsS https://aria-mantu-app.fly.dev/api/health
curl -fsS https://aria-mantu-app.fly.dev/api/ready    # must be 200
```

Then the live behaviours this engagement added:

1. Ignite one workspace's loop with a machine credential; confirm a row lands in `aria_jobs`.
2. Confirm `email_sync → inbound_classify` advances with no browser open.
3. Flip that workspace's `kill_switch` true; confirm in-flight work fails `stage_disabled` and
   `dispatchDue` drains nothing.
4. Confirm `messages_outbound` stays 0 — `sequences_enabled` is FALSE, so nothing sends.

## What NOT to do

**Do not fast-forward `origin/vercel-demo` to `704130c` as a shortcut.** It is the Vercel default
branch; 244 commits would land at once and Vercel would serve code against whatever schema the
database has at that moment. Migrations first, then a deliberate deploy at a known SHA.

## Two consequences to expect after this lands

- **Lawful basis now gates every candidate**, not just manually-entered ones. Provider-sourced
  candidates — everything Apify returns — will be REFUSED at outreach approval until an operator
  records consent or legitimate interest in the consent passport. That is correct under Article 14
  and it will stop campaigns that run today. Nobody's outreach silently changes meaning; it stops
  and says why.
- **Job payloads can no longer carry candidate text.** Anything that was relying on reading a
  candidate record straight out of a job payload now reads it by id instead.

## Still unbuilt at `704130c`

Rock 7 (LinkedIn adapter) is building now. Phase C's seven operational items are untouched — most
relevant to a production cutover: there is still no metrics, tracing or error reporting, and
`/api/health` is a constant, so your 3am visibility is thin. Reaper-killed jobs are dead-lettered
with no authenticated read surface.
