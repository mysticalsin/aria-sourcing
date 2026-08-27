---
project: MSourcing / ARIA
shift: 200
agent: cursor-cloud
updated: 2026-08-27T21:47Z
status: demo-ux-plus-0068-integrated-awaiting-owner-redeploy
---

# Handoff — Shift 200

## Current state

- **Branch tip:** `cursor/enterprise-autopilot-b91d` @ **`88b89b5`** (`88b89b5425705aa00fc307636a654d58d14d1148`)
  - Method: **merge** of `cursor/fix-requisition-parse-404-cadd` into demo UX tip
  - Parents: `a679c18` (demo UX) + `bba23f6` (0068/DeepSeek)
  - Includes: `4ff518b`/`393a4be`/`a679c18` + `9da085d`/`bba23f6`
- Gate: **`npx tsc --noEmit && npm test` GREEN** on tip
- **PR #32** remains **CLOSED** — do not reopen; tip push is enough for owner redeploy
- **Live Fly** still **`635eb4e`** — awaiting owner redeploy confirm matching HEAD (do not invent confirm / redeploy)
- Live `apply_workspace_patch` still HTTP 404 / PG `42883` until **0068** applied on DB
- Confirm unlock: `bash scripts/print-fly-deploy-confirm.sh` → `ARIA_PROD_DEPLOY_CONFIRM`
- Microsoft path **SKIPPED** (owner)

## Done this shift

1. Merged parse-404 into enterprise-autopilot; conflicts only in `_relay/HANDOFF.md` (resolved combined)
2. Demo UX preserved: intake title/headcount; dry-run without mailbox; shell-first reload
3. 0068 + worker `digest_unresolved` + DeepSeek secrets wiring on same tip
4. Pushed `88b89b5`; gate green; no redeploy

## Blockers

- Owner must drop confirm → migrate through **0068** + deploy tip **`88b89b5`** matching HEAD
- Live campaign materialization blocked until 0068 on DB
- MS Graph / live Outlook E2E still skipped

## Next steps

1. Owner: redeploy Fly from `cursor/enterprise-autopilot-b91d` @ **`88b89b5`** with matching confirm + apply migrations through 0068
2. Re-verify live: Java brief title+openings=3; Outreach Dry-run; hard reload `/`; `apply_workspace_patch` no digest 42883; webhook campaign materialization
3. Optional: `/tmp/owner-llm.env` with real Kimi/DeepSeek → `bash scripts/fly-apply-owner-llm-secrets.sh`
4. Do not Approve/send; do not invent secrets/confirm; do not resume Microsoft

## Decisions made (don't relitigate)

- Owner closed #32 — accept; push tip without reopen
- Owner skip Microsoft — still in force
- Force Dry-run when no real mailbox account
- Demo UX + 0068 co-located on `enterprise-autopilot-b91d`
- Local gate = CI authority; never invent deploy confirm
- VSS plain text/HTML production baseline; PDF OCR deferred

## Watch out

- Applying 0068 without `ARIA_EXPECTED_MIGRATION*` / tip deploy can desync `/api/ready`
- After deploy, start loop machine if suspended
- Do not set `ARIA_ALLOW_SKIP_LIVE_CALENDAR=1`
