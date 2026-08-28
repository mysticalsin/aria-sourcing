---
project: MSourcing / ARIA
shift: 210
agent: cursor-cloud
updated: 2026-08-28T00:30Z
status: tip-ahead-draft-quality-recover-awaiting-confirm
---

# Handoff — Shift 210

## Current state

- **Branch tip (git):** `cursor/enterprise-autopilot-b91d` **`0be2666`** (`0be2666b2639ffb196cd8ec394e1d2b4f014fe81`); code **`3753adb`**; feature `cursor/draft-quality-recover-blocked-5ae7` **`3753adb`**
- **Live Fly `aria-mantu-app`:** **`e46912691e9d2ad400dbb5a37f3e68047649727e`** / mig **0068** — behind tip
- **Deploy confirm:** `/tmp/owner-deploy-confirm.env` is for **`e469126`** — **NO MATCH** vs HEAD (did **not** invent; did **not** deploy). Owner must mint for `git rev-parse HEAD` (`bash scripts/print-fly-deploy-confirm.sh`)
- **Setup action requested:** owner mint confirm for tip (cursor-cloud id `fly-deploy-confirm-tip-current`)
- **Timer:** `enterprise-deploy-confirm-recheck` once ~18m — confirm vs HEAD only; deploy only if matched; skip Microsoft; no invent confirm
- Microsoft **SKIPPED** — E2E stays **PARTIAL** when MS skipped
- Goal `goal-2026-07-08-aria-enterprise-ready` **IN_PROGRESS** (do not complete)
- **PR #32** CLOSED — tip push without reopen

## Done this shift

1. Confirm vs HEAD: stale `e469126` ≠ tip `2e861e4`/`3753adb` → no Fly deploy
2. **fix(draft):** live re-validation recovers stale graph `approval_blocked` (`3753adb`):
   - Draft cron no longer hard-fails on graph `approval_blocked` when dedicated live critics clear the block (first peer pass was flaky/harsh)
   - Remaps recovered `approval_blocked` → `queued_for_approval` for the worker
   - Deterministic UI draft paths pin `qualityCriticsUsed: false` (no bare "Quality ready")
   - Dry-run force warning names mailbox-only gate (not "or LinkedIn")
3. Gate: `npx tsc --noEmit` green; `npm test` green; no Approve/send; no MS secrets invented
4. Re-armed one-shot timer `enterprise-deploy-confirm-recheck` (~18m); subscriptions were empty this session

## Blockers

- Owner must mint deploy confirm for current tip HEAD before Fly redeploy
- Live still stalls parse→campaign_create until tip (incl. prior chain + `3753adb`) is deployed
- Microsoft still skipped
- Fresh tip PR create blocked by GitHub integration permissions

## Next steps

1. Owner: mint confirm for tip HEAD and redeploy Fly (app + loop); keep loop machine started
2. After redeploy: prove `/api/ready` SHA matches tip; re-prove need → parse → campaign_create → sourcing_batch past `complete_aria_job`
3. Continue live dry-run: source → top10 → Mantu draft → multi-agent quality (no Approve/send); LinkedIn 409
4. Prove draft cron recovers when first peer pass is `approval_blocked` but live re-validation is ready
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
- Dedicated live re-validation is authoritative over a stale graph `approval_blocked` peer pass
- Local interview slots without Graph sync are **Needs calendar**, not live booked Teams interviews
- Top-10 ranking drops below-min-score candidates; entitled autopilot with zero eligible fails closed
- Graph webhook credential gaps are fail-closed non-retryable; HMAC hiring-need path remains ready without Graph
- LangGraph `shortlistMinScore` must match workspace `auto_shortlist_min_score` (not a higher hardcoded default)

## Watch out

- Stale confirm for `e469126` will refuse tip HEAD — remint via `print-fly-deploy-confirm.sh`
- Do not set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1` as success theatre
- Keep loop machine started after future deploys
- Draft cron may land graph `quality_critics_incomplete` / stale `approval_blocked` then recover via live re-validation — worker only accepts `queued_for_approval` / `approval_blocked` on success
- Unit tests of `draft_quality` must pass `preferLiveCritics: false` when exercising deterministic approval without LLM peers
- After UI regenerate/edit/draft, `qualityCriticsUsed` must stay false until a fresh live-critic path re-sets it
