---
project: MSourcing / ARIA
shift: 66
agent: cursor-cloud
updated: 2026-08-25 UTC
status: outlook-llm-observability-ux-shipped
---

# Handoff - Shift 66

## Current state

- Branch `cursor/enterprise-autopilot-b91d` → PR #24 (base `integration/sourcing-enrichment-on-main`).
- Plug-and-play Outlook → open needs → sourcing UX shipped on Intake.
- Recruitment LLM picker + Get started + Observability tabs on Settings (Motion springs; Bklit-style spark bars; Kokonut-like interactive cards).
- GH Actions still budget-blocked (CI-BUDGET); local `npx tsc --noEmit`, `typecheck:tests`, `npm test` green after this shift.

## Done this shift

- `src/lib/outlook-needs.ts` + `OutlookNeedsPanel` on `/intake` — connect Outlook, pull needs, select → parse → campaign.
- Settings: `SetupGuidePanel`, `RecruitmentLlmPanel`, `ObservabilityPanel`; tabs `setup` / `observe`; `?tab=` deep links.
- Need-email subject matcher expanded (`open need`, `platform need`, `requisition`).
- Outlook integration card `setupHref` → `/intake`.
- Tests: `outlook-needs`, `recruitment-llm`; manifest counts/digests updated.

## Blockers

- CI-BUDGET (Tony): restore Actions minutes before PR checks can go green.
- P-1 Docker DB; E-2 Entra; P-7 delivery domain; L-2 LinkedIn vendor.

## Next steps

1. Tony restores Actions budget; re-run PR #24 checks.
2. Live tenant: connect Graph mailbox + enable Anthropic (or other tool-calling) model for sourcing.
3. Optional later: Graph webhook subscriptions for continuous need ingest (not required for HITL pull).

## Decisions made (don't relitigate)

- Inbox pull stays HITL (human selects need → parse → create campaign); no silent auto-campaign from Outlook.
- Intake parse continues on `chat` task; sourcing agent stays on `sourcing` (tool-calling).
- Observability v1 uses in-app agent-events + activities (no Langfuse yet).
- Prior shift 63–65 decisions stand.

## Watch out

- Public demo / dry-run sync returns empty messages — UI must not pretend needs were found.
- Kimi cannot be default for sourcing; Recruitment panel excludes it.
