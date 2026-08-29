---
project: MSourcing / ARIA
shift: 400
agent: cursor-cloud
updated: 2026-08-29T21:35Z
status: rei-channel-heyreach-body-gates
---

# Handoff — Shift 400

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **This shift:** WA inbound guardrails override + live critics; inbound channel → draft; confirm-calendar-book Autopilot gate; HeyReach SendMessage draft body + {message} fields; 0077 HeyReach inbound routes; Settings registers route on Save
- **Live Fly:** `1665b39` / **0074**; **0076/0077 not applied**; Graph dropzones absent → **HOLD**

## Done this shift

1. WA inbound: effectiveGuardrails when armed; validateOutreachQualityLive before mint
2. Worker: plumb reply channel into draft_generate / draft cron
3. confirm-calendar-book: entitle + Sequences or `autopilot_disarmed`
4. heyreach-delivery: inbox SendMessage with draft; AddLeads `{message}` custom field
5. Migration **0077** + Settings ensure_connect after Save HeyReach

## Blockers

1. Deploy tip + **0076** + **0077**
2. HeyReach campaign must use `{message}` when SendMessage unavailable
3. Graph dropzones empty — strict PASS HOLD

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
# Settings → Save HeyReach (registers inbound route); entitle; arm Sequences
# In HeyReach campaign steps, use {message} personalization for first-touch copy
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Workspace Autopilot arm overrides locked agent_specs.guardrails.autopilot:false for WA replies
- Live book cron fail-closed without Autopilot+Sequences (human uses /api/calendar/event)
- HeyReach prefers SendMessage of Aria body; campaign AddLeads is fallback with {message}
- HOLD when Microsoft dropzones empty

## Watch out

- Deploy both 0076 and 0077
- Worker soft-continues on confirm status `autopilot_disarmed`
