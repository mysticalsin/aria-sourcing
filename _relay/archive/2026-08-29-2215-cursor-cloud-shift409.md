---
project: MSourcing / ARIA
shift: 409
agent: cursor-cloud
updated: 2026-08-29T22:05Z
status: prep-recipient-mailbox-parity
---

# Handoff — Shift 409

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39** (related **PR #36**)
- **CODE:** Autopilot + interviewerEmail + 0079 + soft-gap + **interviewer prep never → candidate** + **Graph mailbox Approve→Send parity**
- **Live Fly:** `1665b39` / **0074** — tip + **0076–0079** not applied
- **Dropzones:** absent → Graph = **HOLD**
- **Deploy:** no `ARIA_PROD_DEPLOY_CONFIRM`

## Done this shift

1. `outreachDispatchRecipient` — interviewer prep without override fails closed
2. Autopilot sweep / store Approve path use shared helper
3. `mailboxSeatReadyForAutopilot` + Graph `domain_verified` heal (Approve→Send parity)
4. Suite `tests/outreach-recipient.mts` + manifest freeze refresh

## Blockers (ops only)

1. Deploy tip + **0076–0079**
2. Settings HeyReach; entitle; Sequences; `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams
4. WA Meta template / HeyReach `{message}`

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Interviewer prep must never Autopilot to candidate email
- Graph live mailbox skips vanity DNS (heal domain_verified); API-key mailboxes still need DNS verify
- Service enqueue binds approval body_hash + scope (0079)

## Watch out

- Deploy tip with **0076–0079** together
- Do not mark goal complete until live Fly tip + migration ≥ **0079** + Autopilot E2E
