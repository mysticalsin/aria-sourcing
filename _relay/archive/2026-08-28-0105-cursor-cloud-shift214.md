---
project: MSourcing / ARIA
shift: 214
agent: cursor-cloud
updated: 2026-08-28T01:10Z
status: provenance-fix-at-tip-awaiting-owner-remint
---

# Handoff — Shift 214

## Current state

- **Branch tip (git):** `cursor/enterprise-autopilot-b91d` **`bdcaa78`** (`bdcaa782902b001f11a8a4e2ee888b092a32f441`); code tip **`9c0fa0d`** (provenance fix `a75bc57` + tests)
- **Live Fly `aria-mantu-app`:** **`e46912691e9d2ad400dbb5a37f3e68047649727e`** / mig **0068** — **40 commits behind tip**
- **Deploy confirm:** `/tmp/owner-deploy-confirm.env` is for **`e469126`** — **NO MATCH** vs HEAD **`bdcaa78`** (did **not** invent; did **not** deploy; golive correctly refused)
- **Timer:** `enterprise-deploy-confirm-recheck` re-armed one-shot ~18m (prior subscription had fired — list was empty)
- Microsoft **SKIPPED** — E2E stays **PARTIAL** when MS skipped
- Goal `goal-2026-07-08-aria-enterprise-ready` **IN_PROGRESS** (do not complete)
- **PR #32** CLOSED — tip push without reopen

## Done this shift

1. Confirm vs HEAD: stale `e469126` ≠ tip `bdcaa78` → no Fly deploy (official gate refused)
2. Live probes: `/api/ready` build=`e469126` mig=0068 ok=true; GoTrue password grant HTTP 200
3. Live E2E (`ARIA_ALLOW_PARTIAL_M365_E2E=1` + `ARIA_ALLOW_SKIP_APPROVE_E2E=1`): **34 pass, 2 fail, 2 warn**
   - **Step 2f chain PASS** — webhook campaign reached `status=Sourcing` on live `e469126`
   - **Step 3c FAIL** — sourcing-agent `n=2, live=0` (HTTP DTOs omit `provenance` on live build; fix `a75bc57` at tip not deployed)
   - Approve/send skipped per policy; M365 PARTIAL (no Graph seat)
4. Re-armed one-shot timer `enterprise-deploy-confirm-recheck` (~18m)

## Owner deploy note (when confirm minted for tip)

**Tip SHA:** `bdcaa782902b001f11a8a4e2ee888b092a32f441` (40 commits ahead of live `e469126`)

**What ships (highlights across tip delta):**
- **sourcing-agent provenance fix (`a75bc57`)** — HTTP candidates include `provenance=live` (unblocks E2E step 3c when n>0)
- **0068 digest** — already on live; `apply_workspace_patch` no longer 42883
- **graphStage strip** — enqueue payloads omit `graphStage`; resume `campaign_created` without re-parse
- **Campaign chain** — `campaign_create` → `sourcing_batch` → top-10 → `draft_generate` dry-run Needs Approval
- **Draft quality recover (`3753adb`)** — clears stale graph `approval_blocked` when live critics pass
- **Non-MS E2E honesty** — PARTIAL when `ARIA_ALLOW_PARTIAL_M365_E2E=1`; step 2f chain probe

**Exact owner commands:**
```bash
bash scripts/print-fly-deploy-confirm.sh
# cat > /tmp/owner-deploy-confirm.env <<'DROP'
# …paste ARIA_RELEASE_SHA + ARIA_PROD_DEPLOY_CONFIRM lines for current HEAD…
# DROP
bash scripts/fly-enterprise-golive-when-ready.sh
```

After deploy: verify `/api/ready` build matches tip; re-run `e2e-workflow-test.sh` with `ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_SKIP_APPROVE_E2E=1`; expect step 3c PASS when providers return candidates.

## Blockers

- Owner must mint deploy confirm for **`bdcaa78`** (or whatever `git rev-parse HEAD` is at deploy time) before Fly redeploy
- Live still on `e469126` — provenance fix not deployed until remint + golive
- Microsoft still skipped — no Outlook/Teams confirmLive PASS
- E2E step 3c can still fail if providers return zero candidates (fail-closed honest)

## Next steps

1. Owner: mint confirm for tip HEAD; keep loop machine started
2. After redeploy: `/api/ready` SHA = tip; re-run live E2E — step 3c should show live=n when n>0
3. Continue live dry-run: source → top10 → Mantu draft → multi-agent quality (no Approve/send)
4. Keep Microsoft skipped; do not complete goal; do not reopen #32

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

## Watch out

- Stale confirm for `e469126` will refuse tip HEAD — remint via `print-fly-deploy-confirm.sh`
- Timer dedupes by name — list subscriptions before re-arming
- Provenance fix is wire-format only — zero candidates from unavailable providers still fail closed
- After deploy, if n>0 but live<n, investigate provider mappers — should not recur post-`a75bc57`
