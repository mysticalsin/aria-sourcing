---
project: MSourcing / ARIA
shift: 392
agent: cursor-cloud
updated: 2026-08-29T19:55Z
status: heyreach-settings-api-mcp
---

# Handoff — Shift 392

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **Settings:** LinkedIn stack step 2 accepts **paste API key + campaign id** and **MCP URL** inline (no Fly CLI required for delivery config)
- **Runtime:** `resolveHeyReachConfigForWorkspace` merges Fly env + vault key + `settings.heyreach`
- **Live Fly:** still build `1665b39` / migration **0074** — this tip not deployed; Graph dropzones still absent → **HOLD**

## Done this shift

1. `HeyReachSettings` on `SystemSettings` (`apiKeyId`, `campaignId`, `accountId`)
2. Settings UI: Save HeyReach API + Connect MCP with inline key paste
3. Delivery/dispatch/send/connections resolve workspace vault (not env-only)
4. Keys create/test probe HeyReach via CheckApiKey
5. Unit tests: heyreach-delivery (merge), heyreach-mcp (panel copy)

## Blockers

1. Deploy tip + apply **0076**
2. Operator: Settings → LinkedIn stack → paste key + campaign (or Fly `HEYREACH_*`)
3. Graph dropzones empty — strict PASS HOLD

## Next steps

```bash
# after deploy:
# Settings → Integrations → LinkedIn stack → Save HeyReach API (key + campaign id)
# optional: Connect HeyReach MCP
npx tsc --noEmit && npm test
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Settings vault + campaign id is first-class; Fly env remains optional override
- Autopilot OFF → human Approve → Send; ON → critics mint → queue
- No LinkedIn scrape/session bots

## Watch out

- Client components must import `heyReachSettingsReady` from `heyreach-config` (not `heyreach-delivery`)
- Migration 0076 still required for autopilot_critics mint/enqueue
