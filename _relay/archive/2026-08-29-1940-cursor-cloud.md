---
project: MSourcing / ARIA
shift: 390
agent: cursor-cloud
updated: 2026-08-29T19:13Z
status: rei-autopilot-send-wired
---

# Handoff — Shift 390

## Current state

- **Branch:** `cursor/rei-autopilot-send-b91d` — REI autopilot first-touch send path
- **Migration 0076:** `autopilot_critics` approval + service enqueue Email/WA/LinkedIn + HeyReach seat in LinkedIn claim
- **Cron:** `POST /api/cron/autopilot-send-outreach` (Bearer CRON_SECRET)
- **Worker:** `handleDraftGenerate` calls autopilot after critic-green draft; falls back to Needs Approval
- **LinkedIn:** HeyReach REST (`HEYREACH_API_KEY` + `HEYREACH_CAMPAIGN_ID`) or vendor API; else assisted-manual 409
- **Enterprise PR #36** / Fly tip still need Graph for strict RESULT: PASS

## Done this shift

1. Decision matrix `src/lib/rei-autopilot-send.ts` + dispatch `rei-autopilot-dispatch.ts`
2. HeyReach delivery adapter + LinkedIn channel `heyreach` backend
3. Migration 0076 + send route accepts human|autopilot_critics|template_bound
4. Loop worker + generate-outreach-draft returns recipient
5. Switchboard / LinkedIn stack UX copy; hermes anti-AI-slop prompt
6. Unit tests: rei-autopilot-send, linkedin-policy, outreach-guardrails, channel-contract

## Blockers

1. Apply **0076** on live Supabase before autopilot mint/enqueue works
2. Set Fly secrets `HEYREACH_API_KEY` + `HEYREACH_CAMPAIGN_ID` (+ optional `HEYREACH_ACCOUNT_ID`)
3. Graph seat still HOLD for Teams confirmLive / strict E2E PASS
4. Create live **HeyReach** agent seat in Fleet for durable LinkedIn queue (env-only direct HeyReach still works without seat)

## Next steps

```bash
# apply migration 0076 on Supabase, then:
flyctl secrets set -a aria-mantu-app HEYREACH_API_KEY=… HEYREACH_CAMPAIGN_ID=…
# entitle autopilot + arm Sequences on switchboard
npx tsc --noEmit && npm test
bash scripts/run-enterprise-e2e-partial.sh   # still PARTIAL until Graph
```

## Decisions made (don't relitigate)

- Autopilot OFF → human Approve → Send (LinkedIn Pending Manual unless HeyReach/vendor seat)
- Autopilot ON → critics mint `autopilot_critics` → durable queue; no session bots
- Production = Fly only; Microsoft dropzones only for Graph

## Watch out

- claim_email_outbound now uses outbound_approval_authorizes_send (not human-only)
- Do not invent Microsoft secrets; HOLD when dropzones empty
- Canvas: `~/.cursor/projects/workspace/canvases/rei-autopilot-pipeline.canvas.tsx`
