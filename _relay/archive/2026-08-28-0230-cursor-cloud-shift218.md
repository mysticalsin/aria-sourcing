---
project: MSourcing / ARIA
shift: 217
agent: cursor-cloud
updated: 2026-08-28T01:55Z
status: hermes-e2e-plan-shipped-awaiting-owner-deploy-remint
---

# Handoff — Shift 217

## Current state

- **Branch tip:** `cursor/enterprise-autopilot-b91d` **`c4e592e`** (Hermes E2E plan complete; push pending)
- **Live Fly:** still **`e469126`** — deploy confirm stale for **`8950b21`** (not invented; not deployed)
- **Test gate:** `npx tsc --noEmit && npm test` green locally; audit matrix **54/54** after HANDOFF step-3c notes below
- **Microsoft SKIPPED** — goal stays **IN_PROGRESS**
- **PR #32** closed — integration cannot open new PRs

## Done this shift

1. **Fix: "Campaign authority changed during sourcing"** — fingerprint now excludes `validationWarnings` drift; `localeContext` in projection schema; fingerprint recomputed after `flushWorkspaceSave` before live sourcing
2. **Hermes recruiter voice** — shared `hermes-recruiter-voice.ts`: empathetic, human, memory-aware; wired into loop-llm + hermes/chat (never reveal AI/agent)
3. Prior shift: H6 isolation, pre-call pipeline, 60-lang locale, audit 54/54; live **`e469126`** still lacks step **3c** provenance fix (expect step 3c PASS after golive when `live=n` and `n>0`)

## Blockers

- Owner deploy confirm for **`8950b21`** (or newer tip after push) before Fly redeploy
- H4/H5 upstream Hermes pin still needs owner sign-off (dedicated MSourcing install documented in code comments)
- Microsoft skipped — full Teams E2E cannot complete

## Next steps

1. Owner: `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env` → golive
2. After deploy: `/api/ready` SHA = tip; live E2E with `ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_SKIP_APPROVE_E2E=1` → expect **PARTIAL** (MS gap only)
3. Owner H4 sign-off for dedicated Hermes runtime + H5 pin when ready for production memory

## Decisions made (don't relitigate)

- **Fly = production.** No Vercel deploys, debugging, or CI authority for live behavior

- Skip Microsoft; no Approve/send in autonomous E2E
- Never invent deploy confirm
- Positive interest chain: **pre_call_propose → first_interview_book** (dry-run calendar); `calendar_book` retained as legacy alias
- Dedicated Hermes install recommended over shared Mina fork until H4 complete
- Autonomous drafts: Needs Approval + dryRun always

## Watch out

- `graphStage` never on enqueue payloads
- Hermes session keys cap at 256 chars; profile prefix `ws-{workspaceUuid}`
- Live E2E provenance fix still deploy-lag until golive — step 3c FAIL on live `e469126` when `live=0`; step 3c should show `live=n` after tip deploy
