---
project: MSourcing / ARIA
shift: 208
agent: cursor-cloud
updated: 2026-08-28T00:00Z
status: tip-ahead-graph-failclosed-awaiting-confirm
---

# Handoff — Shift 208

## Current state

- **Branch tip (git):** `cursor/enterprise-autopilot-b91d` **`957c7cb`** (`957c7cbbd5531bbe8823909855589be114be9ff8`); code merge `b314ade`; feature `cursor/graph-failclosed-e2e-050f` **`d812bf0`**
- **Live Fly `aria-mantu-app`:** **`e46912691e9d2ad400dbb5a37f3e68047649727e`** / mig **0068** — still behind tip (missing graphStage fix through this shift's graph fail-closed)
- **Deploy confirm:** `/tmp/owner-deploy-confirm.env` is for **`e469126`** — **NO MATCH** vs HEAD `957c7cb` (did **not** invent; did **not** deploy)
- **Setup action requested:** owner mint confirm for tip `957c7cb` via `bash scripts/print-fly-deploy-confirm.sh` + fly-deploy-now (cursor-cloud `request-environment-setup-actions` id `fly-deploy-confirm-tip-957c7cb`)
- Microsoft **SKIPPED** (owner) — Outlook/Teams live E2E out of scope; E2E stays **PARTIAL** when MS skipped
- Goal `goal-2026-07-08-aria-enterprise-ready` **IN_PROGRESS** (do not complete)
- **PR #32** CLOSED — tip push without reopen; fresh draft PR create blocked (`Resource not accessible by integration`); compare: `cursor/enterprise-autopilot-b91d` → `integration/sourcing-enrichment-on-main`

## Done this shift

1. Confirm vs HEAD: stale confirm for live `e469126` ≠ tip `b314ade` → no Fly deploy
2. Requested owner deploy-confirm setup action for tip `957c7cb` (`957c7cbbd5531bbe8823909855589be114be9ff8`)
3. Graph webhook → hiring need fail-closed when Graph absent (`3cfe0df`/`090c461`/`d812bf0`, merge `b314ade`):
   - `fetchGraphMessageForIngest` returns `GraphMessageFetchResult` with `connection_missing` | `token_unavailable` | `message_incomplete` | `message_fetch_failed`
   - Only `message_fetch_failed` / ingest_5xx are retryable (503); credential gaps return 202 without inventing enqueue
4. Skeleton/honesty UX: seed job ads say Mantu Group; seed booking activity uses `bookingInterviewTitle` (Needs calendar, not false Interview booked); candidate drawer toasts use `bookingInterviewTitle`
5. E2E without live calendar: Graph-absent non-retryable pin; Non-MS honesty pins; live `POST /api/email/test` `hiring_need_handler`; calendar dry-run omits Teams join URL/event id
6. Gate: `npx tsc --noEmit` green; targeted contracts + audit matrix **48/48**; no Approve/send; no MS secrets invented
7. Fresh tip PR create blocked by GitHub integration permissions (compare URL only); did not reopen #32

## Blockers

- Owner must mint deploy confirm for tip `957c7cb` / `957c7cbbd5531bbe8823909855589be114be9ff8` via `bash scripts/print-fly-deploy-confirm.sh` before Fly redeploy
- Live still stalls parse→campaign_create until tip (incl. `03ddf0d` + `d381ff2` + `fc7299f` + `ac5b7a5` + `b314ade` / `957c7cb`) is deployed
- Microsoft still skipped
- Fresh tip PR create blocked by GitHub integration permissions

## Next steps

1. Owner: mint confirm for `957c7cb` and redeploy Fly (app + loop); keep loop machine started
2. After redeploy: prove `/api/ready` SHA=`957c7cb…`; re-prove synthetic need → `requisition_parse` → `campaign_create` → `sourcing_batch` past `complete_aria_job` (no `22023`)
3. Continue live dry-run: source → top10 (min score) → Mantu draft → multi-agent quality (no Approve/send); LinkedIn 409
4. Operator smoke: email test **hiring_need_handler** without Graph; Outreach Queue Dry-run + Quality; Calendar **Needs calendar** titles
5. Keep Microsoft skipped; do not complete goal; do not reopen #32

## Decisions made (don't relitigate)

- Owner closed #32 — accept; tip push without reopen
- Owner skip Microsoft — still in force
- Force Dry-run when no real mailbox — regardless of HeyReach/LinkedIn live toggles
- Never `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1` pretending full PASS — PARTIAL only
- `graphStage` belongs on job results / LangGraph checkpoints, never enqueue payloads
- Local gate = CI authority; never invent deploy confirm
- Autonomous loop drafts always land Needs Approval + dryRun until human Approve/send
- `e2e-workflow-test.sh` Approves outreach — skip while "no Approve/send" stands
- Incomplete multi-agent critics fail closed (never autonomous ready without all three peers)
- Local interview slots without Graph sync are **Needs calendar**, not live booked Teams interviews
- Top-10 ranking drops below-min-score candidates; entitled autopilot with zero eligible fails closed
- Graph webhook credential gaps are fail-closed non-retryable; HMAC hiring-need path remains ready without Graph

## Watch out

- Stale confirm for `e469126` will refuse tip `957c7cb` — remint via `print-fly-deploy-confirm.sh`
- Do not set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1` as success theatre
- Keep loop machine started after future deploys
- `campaign_create` now requires campaign blob visible; if workspace lag, retries with `campaign_missing`
- Draft cron may land graph `quality_critics_incomplete` then recover via live re-validation — worker only accepts `queued_for_approval` / `approval_blocked` on success
- Unit tests of `draft_quality` must pass `preferLiveCritics: false` when exercising deterministic approval without LLM peers
- Graph webhook `token_unavailable`/`connection_missing` must stay outside the retryable predicate
