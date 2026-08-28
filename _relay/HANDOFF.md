---
project: MSourcing / ARIA
shift: 209
agent: cursor-cloud
updated: 2026-08-28T00:17Z
status: tip-ahead-shortlist-minscore-awaiting-confirm
---

# Handoff — Shift 209

## Current state

- **Branch tip (git):** `cursor/enterprise-autopilot-b91d` **`846015c`** (`846015c23fd237e2de569acd22f6000df91e6a72`); feature `cursor/quality-critics-stale-53d3` **`846015c`**
- **Live Fly `aria-mantu-app`:** **`e46912691e9d2ad400dbb5a37f3e68047649727e`** / mig **0068** — still behind tip (graphStage through shortlistMinScore)
- **Deploy confirm:** `/tmp/owner-deploy-confirm.env` is for **`e469126`** — **NO MATCH** vs HEAD `846015c` (did **not** invent; did **not** deploy)
- **Setup action requested:** owner mint confirm for tip `846015c` via `bash scripts/print-fly-deploy-confirm.sh` + fly-deploy-now (cursor-cloud `request-environment-setup-actions` id `fly-deploy-confirm-tip-846015c`)
- **Timer:** `enterprise-deploy-confirm-recheck` once ~18m — confirm vs HEAD only; deploy only if matched; skip Microsoft; no invent confirm
- Microsoft **SKIPPED** (owner) — Outlook/Teams live E2E out of scope; E2E stays **PARTIAL** when MS skipped
- Goal `goal-2026-07-08-aria-enterprise-ready` **IN_PROGRESS** (do not complete)
- **PR #32** CLOSED — tip push without reopen; fresh draft PR create blocked (`Resource not accessible by integration`); compare: `cursor/enterprise-autopilot-b91d` → `integration/sourcing-enrichment-on-main`

## Done this shift

1. Confirm vs HEAD: stale confirm for live `e469126` ≠ tip `e7ed691`/`846015c` → no Fly deploy
2. Requested owner deploy-confirm setup action for tip `846015c`; subscribed one-shot timer `enterprise-deploy-confirm-recheck` (~18m)
3. Fail-closed shortlist floor + quality honesty (`846015c` on `cursor/quality-critics-stale-53d3`, fast-forwarded to tip):
   - LangGraph `rankTop10` honors workspace `shortlistMinScore` (via checkpoint body); worker passes `auto_shortlist_min_score` so a lowered floor no longer fails entitled shortlists against hardcoded 70
   - `regenerateOutreach` / body `updateOutreach` clear stale `qualityCriticsUsed` (no lying · multi-agent badge after edit)
   - `checkOutreachApproval` warns on stored `needs_review` instead of claiming Quality ready
4. Gate: `npx tsc --noEmit` green; `npm test` green; no Approve/send; no MS secrets invented

## Blockers

- Owner must mint deploy confirm for tip `846015c` / `846015c23fd237e2de569acd22f6000df91e6a72` via `bash scripts/print-fly-deploy-confirm.sh` before Fly redeploy
- Live still stalls parse→campaign_create until tip (incl. `03ddf0d` + `d381ff2` + `fc7299f` + `ac5b7a5` + `b314ade` / `846015c`) is deployed
- Microsoft still skipped
- Fresh tip PR create blocked by GitHub integration permissions

## Next steps

1. Owner: mint confirm for `846015c` and redeploy Fly (app + loop); keep loop machine started
2. After redeploy: prove `/api/ready` SHA=`846015c…`; re-prove synthetic need → `requisition_parse` → `campaign_create` → `sourcing_batch` past `complete_aria_job` (no `22023`)
3. Continue live dry-run: source → top10 (workspace min score) → Mantu draft → multi-agent quality (no Approve/send); LinkedIn 409
4. Operator smoke: email test **hiring_need_handler** without Graph; Outreach Queue Dry-run + Quality; regenerate clears multi-agent badge; Calendar **Needs calendar** titles
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
- LangGraph `shortlistMinScore` must match workspace `auto_shortlist_min_score` (not a higher hardcoded default)

## Watch out

- Stale confirm for `e469126` will refuse tip `846015c` — remint via `print-fly-deploy-confirm.sh`
- Do not set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1` as success theatre
- Keep loop machine started after future deploys
- `campaign_create` now requires campaign blob visible; if workspace lag, retries with `campaign_missing`
- Draft cron may land graph `quality_critics_incomplete` then recover via live re-validation — worker only accepts `queued_for_approval` / `approval_blocked` on success
- Unit tests of `draft_quality` must pass `preferLiveCritics: false` when exercising deterministic approval without LLM peers
- Graph webhook `token_unavailable`/`connection_missing` must stay outside the retryable predicate
- After UI regenerate/edit, `qualityCriticsUsed` must stay false until a fresh live-critic path re-sets it
