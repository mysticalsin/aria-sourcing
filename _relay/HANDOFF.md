---
project: MSourcing / ARIA
shift: 215
agent: cursor-cloud
updated: 2026-08-28T01:15Z
status: both-e2e-fails-analyzed-deploy-lag-awaiting-owner-remint
---

# Handoff — Shift 215

## Current state

- **Branch tip (git):** `cursor/enterprise-autopilot-b91d` — run `git rev-parse HEAD` (was `d7d7598` before shift 215 audit-matrix commit)
- **Live Fly `aria-mantu-app`:** **`e46912691e9d2ad400dbb5a37f3e68047649727e`** / mig **0068** — still behind tip
- **Deploy confirm:** `/tmp/owner-deploy-confirm.env` is for **`e469126`** — **NO MATCH** vs tip HEAD (did **not** invent; did **not** deploy)
- **Timer:** subscriptions list empty (prior `enterprise-deploy-confirm-recheck` fired — not re-armed this shift)
- Microsoft **SKIPPED** — E2E stays **PARTIAL** when MS skipped (only when FAILS=0)
- Goal `goal-2026-07-08-aria-enterprise-ready` **IN_PROGRESS** (do not complete)
- **PR #32** CLOSED — tip push without reopen

## Done this shift

1. Grepped `/tmp/e2e-run-1787878999.log` — both FAIL lines identified (see below)
2. **No second code bug** — failure #2 is cascade from step 3c provenance deploy-lag
3. Audit matrix +1 row: post-deploy PARTIAL E2E expectations (provenance gate, cascade fail-closed, MS-gap PARTIAL only when FAILS=0) — **51/51** verified
4. Gate green (`npx tsc --noEmit && npm test`)

## Live E2E failure analysis (build `e469126`, 34 pass / 2 fail / 2 warn)

| # | Step | Message | Root cause | Fix/defer |
|---|------|---------|------------|-----------|
| 1 | **3c** | `sourcing-agent (HTTP 200, ok=true, n=2, live=0)` | Live build omits `provenance=live` on HTTP DTOs | **Defer deploy-lag** — fixed at tip `a75bc57`, not on `e469126` |
| 2 | **3 cascade** | `Fly enterprise E2E requires a live sourced candidate (no synthetic cand-e2e)` | Step 3c fail → `cand0.json` null → fail-closed (lines 903–905 e2e-workflow-test.sh) | **Defer cascade** — resolves when #1 deploys; not a separate bug |

**Post-deploy expectation:** after owner remint + golive to tip, re-run with `ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_SKIP_APPROVE_E2E=1` → step 3c should show `live=n` when `n>0`; with MS skipped only → **RESULT: PARTIAL** (not FAIL).

## Blockers

- Owner must mint deploy confirm for current tip HEAD before Fly redeploy
- Live still on `e469126` — provenance fix not deployed until remint + golive
- Microsoft still skipped — no Outlook/Teams confirmLive PASS
- Step 3c can still fail if providers return zero candidates (fail-closed honest)

## Next steps

1. Owner: mint confirm for tip HEAD (`print-fly-deploy-confirm.sh`); keep loop machine started
2. After redeploy: `/api/ready` SHA = tip; re-run live E2E — expect 3c PASS when n>0; RESULT: PARTIAL (MS gap only)
3. Continue live dry-run: source → top10 → Mantu draft → multi-agent quality (no Approve/send)
4. Re-arm deploy-confirm timer if desired (list subscriptions first — dedupes by name)

## Decisions made (don't relitigate)

- Owner closed #32 — accept; tip push without reopen
- Owner skip Microsoft — still in force
- No Approve/send outreach in autonomous E2E — use `ARIA_ALLOW_SKIP_APPROVE_E2E=1`
- Force Dry-run when no real mailbox — regardless of HeyReach/LinkedIn live toggles
- Never `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1` pretending full PASS — PARTIAL only
- `graphStage` belongs on job results / LangGraph checkpoints, never enqueue payloads
- Local gate = CI authority; never invent deploy confirm
- Autonomous loop drafts always land Needs Approval + dryRun until human Approve/send
- sourcing-agent HTTP DTOs must expose `provenance=live` for every real candidate (E2E + client parse contract)
- Second E2E FAIL on live `e469126` is cascade from 3c — not a separate code defect

## Watch out

- Stale confirm for `e469126` will refuse tip HEAD — remint via `print-fly-deploy-confirm.sh`
- Timer dedupes by name — list subscriptions before re-arming
- Provenance fix is wire-format only — zero candidates from unavailable providers still fail closed
- RESULT: PARTIAL requires FAILS=0 — sourcing failures yield RESULT: FAIL even with MS skip
