---
project: MSourcing / ARIA
shift: 97
agent: cursor-cloud
updated: 2026-08-26 UTC
status: mantu-e2e-langchain-microsoft365
---

# Handoff - Shift 97

## Current state

- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29 → `integration/sourcing-enrichment-on-main`
- **LangChain recruiting graph:** [`src/lib/langchain/recruiting-graph.ts`](src/lib/langchain/recruiting-graph.ts) — LangGraph orchestrates webhook → parse → source → top 10 → quality → approve → interview
- **Webhook routing (no polling):** [`src/lib/inbound-email-router.ts`](src/lib/inbound-email-router.ts) — hiring needs → `requisition_parse`; replies → `inbound_classify`
- **Multi-agent outreach quality:** [`src/lib/outreach-quality-pipeline.ts`](src/lib/outreach-quality-pipeline.ts) — empathy + compliance + human-likeness before approval
- **Mantu brand outreach:** [`src/lib/mantu-brand.ts`](src/lib/mantu-brand.ts) — voice + HTML email wrapper (mantu-pptx palette)
- **Microsoft 365 stack UI:** [`microsoft365-stack.tsx`](src/components/settings/microsoft365-stack.tsx) — Entra SSO, Outlook, Teams, webhook intake
- **Teams calendar:** `createGraphCalendarEvent` uses `isOnlineMeeting` + `teamsForBusiness`; join URL preferred
- **Deps:** `@langchain/core`, `@langchain/langgraph` added

## Done this shift

- Email webhook accepts `subject`; routes Mantu need emails to sourcing pipeline (not classify)
- `generateOutreachLive` runs quality pipeline + Mantu HTML for Email channel
- Outreach cards show Quality score badge
- Tests: `mantu-e2e-loop`, `inbound-email-router`; email-inbound-contract updated

## E2E loop (target state)

```
Webhook (Outlook adapter) → requisition_parse → campaign → source → top 10
  → draft (Mantu brand + quality critics) → human approve → send
  → reply webhook → classify → draft → book (Teams) → prep
```

## Blockers (ops)

- Entra SSO: `NEXT_PUBLIC_ENABLE_AZURE_LOGIN=true` + GoTrue Azure on Fly
- Outlook OAuth: `MICROSOFT_CLIENT_*` + connect in Settings
- Webhook: `EMAIL_INBOUND_WEBHOOK_SECRET` + Graph/n8n adapter
- 7 pre-existing failures in `store-sourcing-actions.mts` (unchanged)

## Next steps

1. Ops: Microsoft 365 enterprise setup on Fly (SSO + Graph + webhook)
2. Wire loop worker `handleRequisitionParse` to call intake parse + auto campaign create
3. Triage `store-sourcing-actions` failures
4. Extend `e2e-workflow-test.sh` with need-webhook + quality gate steps

## Decisions made (don't relitigate)

- LangChain LangGraph added for E2E orchestration (user request overrides prior "no LangChain rewrite" note for orchestration layer only; Postgres authority unchanged)
- LinkedIn still assisted-manual (409); no inbox polling — webhook-only activation
- Top shortlist = 10 (`TOP_CANDIDATE_SHORTLIST_SIZE`)
- Microsoft Teams confirmed as calendar/meeting pillar (user clarified "Alcoa" → Teams)

## Watch out

- Quality pipeline blocks salary disclosure and generic openers — may increase `needs_review` rate initially
- `Microsoft365Stack` step 2 links to `#email-connections-panel` for Connect Outlook
- LangGraph graph skips interview scheduling when any draft is `blocked`
