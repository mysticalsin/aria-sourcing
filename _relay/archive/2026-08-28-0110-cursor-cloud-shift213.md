---
project: MSourcing / ARIA
shift: 213
agent: cursor-cloud
updated: 2026-08-28T01:05Z
status: provenance-fix-pushed-awaiting-owner-mint
---

# Handoff — Shift 213

## Current state

- **Branch tip (git):** `cursor/enterprise-autopilot-b91d` **`9c0fa0d`** (`9c0fa0d…`); fix commits **`a75bc57`** + **`9c0fa0d`**
- **Live Fly `aria-mantu-app`:** **`e46912691e9d2ad400dbb5a37f3e68047649727e`** / mig **0068** — **38 commits behind tip**
- **Deploy confirm:** `/tmp/owner-deploy-confirm.env` is for **`e469126`** — **NO MATCH** vs HEAD **`9c0fa0d`** (did **not** invent; did **not** deploy)
- **Timer:** `enterprise-deploy-confirm-recheck` already armed — do **not** duplicate
- Microsoft **SKIPPED** — E2E stays **PARTIAL** when MS skipped
- Goal `goal-2026-07-08-aria-enterprise-ready` **IN_PROGRESS** (do not complete)
- **PR #32** CLOSED — tip push without reopen

## Done this shift

1. Confirm vs HEAD: stale `e469126` ≠ tip `9c0fa0d` → no Fly deploy (golive would refuse)
2. **Root cause:** `/api/sourcing-agent` returned n>0 candidates but omitted `provenance` on HTTP DTOs; E2E step 3c counts `provenance=="live"` → live=0 while n=2. Internal `candidateFromSourcingAgentDto` already stamped live on store commit; JSON response did not.
3. **Fix (`a75bc57`):** `SourcingAgentCandidateDtoSchema` requires `provenance: z.literal("live")`; route emits `provenance: "live"`; parse rejects non-live; audit matrix + route-authority tests pinned
4. Gate: `npx tsc --noEmit` green; `npm test` green; pushed **`9c0fa0d`**

## Owner deploy note (when confirm minted for tip)

**Tip SHA:** `9c0fa0d` (38 commits ahead of live `e469126`)

**What ships (highlights across tip delta):**
- **sourcing-agent provenance fix** — HTTP candidates now include `provenance=live` (unblocks E2E step 3c when providers return real hits)
- **0068 digest** — already on live; `apply_workspace_patch` no longer 42883
- **graphStage strip** — enqueue payloads omit `graphStage`; resume `campaign_created` without re-parse
- **Campaign chain** — `campaign_create` → `sourcing_batch` → top-10 → `draft_generate` dry-run Needs Approval
- **Non-MS E2E honesty** — PARTIAL when `ARIA_ALLOW_PARTIAL_M365_E2E=1`; step 2f chain probe

**Exact owner commands:**
```bash
bash scripts/print-fly-deploy-confirm.sh
# cat > /tmp/owner-deploy-confirm.env <<'DROP'
# …paste ARIA_RELEASE_SHA + ARIA_PROD_DEPLOY_CONFIRM lines…
# DROP
bash scripts/fly-enterprise-golive-when-ready.sh
```

After deploy: verify `/api/ready` build matches tip; re-run `e2e-workflow-test.sh` with `ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_SKIP_APPROVE_E2E=1`; expect step 3c PASS when providers return candidates (still depends on Exa/Apollo/Tavily/GitHub keys on Fly).

## Blockers

- Owner must mint deploy confirm for **`9c0fa0d`** before Fly redeploy
- Live still on `e469126` — provenance fix not deployed until remint + golive
- Microsoft still skipped — no Outlook/Teams confirmLive PASS
- E2E step 3c can still fail if providers return zero candidates (fail-closed honest) — provenance fix alone does not synthetic-pass

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
- Do not duplicate `enterprise-deploy-confirm-recheck` timer
- Provenance fix is wire-format only — zero candidates from unavailable providers still fail closed
- After deploy, if n>0 but live<n, investigate provider mappers — should not recur post-`a75bc57`
