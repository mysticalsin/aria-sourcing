---
project: MSourcing / ARIA
shift: 217
agent: cursor-cloud
updated: 2026-08-28T01:55Z
status: hermes-e2e-plan-shipped-awaiting-owner-deploy-remint
---

# Handoff — Shift 217

## Current state

- **Branch tip:** `cursor/enterprise-autopilot-b91d` (Hermes E2E plan implementation pending push)
- **Live Fly:** still **`e469126`** — deploy confirm stale for **`8950b21`** (not invented; not deployed)
- **Test gate:** `npx tsc --noEmit && npm test` green locally; audit matrix **54/54** after HANDOFF step-3c notes below
- **Microsoft SKIPPED** — goal stays **IN_PROGRESS**
- **PR #32** closed — integration cannot open new PRs

## Done this shift

1. **H6 profile multiplexing:** `resolveHermesProfilePrefix`, `buildHermesSessionKey`, `buildHermesUpstreamPath`, `hermesUpstreamHeaders` in `hermes-proxy.ts`; wired in `hermes/chat` + `hermes/proxy`
2. **Loop Hermes router:** `src/lib/ai/loop-llm.ts` (`resolveLoopLlm`) — draft cron + `classify-inbound-reply` cron prefer Hermes when `HERMES_API_URL`+key; worker `createReplyClassificationModelClient` Hermes path
3. **Pipeline pre-call → first interview:** `pre_call_propose` + `first_interview_book` in `pipeline-transitions.json`, worker handlers, graph intents `pre_call_only`/`interview_only`; mig **0069** adds loop kinds
4. **60 languages:** `BUSINESS_LANGUAGE_CATALOG` (~60 ISO), `LocaleContext` on `JobAnalysis`, `extractLocaleContext`, locale in `buildOutreachPrompt` + draft cron
5. **Schedules panel:** read-only mirror via `GET /api/cron/jobs`
6. **Tests:** `hermes-profile-multiplexing`, `locale-propagation`; audit matrix extended for Hermes + locale chain
7. **Phase 0:** documented deploy blocker — owner must remint confirm for current HEAD before golive; live **`e469126`** still lacks step **3c** provenance fix (expect step 3c PASS after golive when `live=n` and `n>0`)

## Blockers

- Owner deploy confirm for **`8950b21`** (or newer tip after push) before Fly redeploy
- H4/H5 upstream Hermes pin still needs owner sign-off (dedicated MSourcing install documented in code comments)
- Microsoft skipped — full Teams E2E cannot complete

## Next steps

1. Owner: `bash scripts/print-fly-deploy-confirm.sh` → `/tmp/owner-deploy-confirm.env` → golive
2. After deploy: `/api/ready` SHA = tip; live E2E with `ARIA_ALLOW_PARTIAL_M365_E2E=1 ARIA_ALLOW_SKIP_APPROVE_E2E=1` → expect **PARTIAL** (MS gap only)
3. Owner H4 sign-off for dedicated Hermes runtime + H5 pin when ready for production memory

## Decisions made (don't relitigate)

- Skip Microsoft; no Approve/send in autonomous E2E
- Never invent deploy confirm
- Positive interest chain: **pre_call_propose → first_interview_book** (dry-run calendar); `calendar_book` retained as legacy alias
- Dedicated Hermes install recommended over shared Mina fork until H4 complete
- Autonomous drafts: Needs Approval + dryRun always

## Watch out

- `graphStage` never on enqueue payloads
- Hermes session keys cap at 256 chars; profile prefix `ws-{workspaceUuid}`
- Live E2E provenance fix still deploy-lag until golive — step 3c FAIL on live `e469126` when `live=0`; step 3c should show `live=n` after tip deploy
