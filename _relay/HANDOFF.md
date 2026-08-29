---
project: MSourcing / ARIA
shift: 407
agent: cursor-cloud
updated: 2026-08-29T21:45Z
status: prep-interviewer-email-fixed
---

# Handoff — Shift 407

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **CODE:** Autopilot path + **interviewerEmail** propagation for post-book prep Autopilot; booking slice candidate fallback; bounded HeyReach settings RPC
- **Live Fly:** `1665b39` / **0074** — tip + **0076/0077/0078** not applied
- **Dropzones:** still absent → Graph = **HOLD**
- **Deploy:** no `ARIA_PROD_DEPLOY_CONFIRM`

## Done this shift

1. `confirm-calendar-book` returns `interviewerEmail` (created + replay) from Graph mailbox
2. Worker persists `interviewer` / `interviewerEmail` on live book booking
3. `0078` booking slice falls back to `candidates[].booking`; adds `read_workspace_heyreach_settings_for_loop`
4. HeyReach delivery uses settings slice (no full `state` blob)
5. Prep cron falls back to Graph seat email when booking email empty
6. Tests + STATUS honesty (live Fly 1665b39/0074)

## Blockers (ops only)

1. Owner deploy tip + **0076** + **0077** + **0078**
2. Settings HeyReach; entitle; arm Sequences; `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams
4. WA cold Meta template / HeyReach `{message}` on campaign

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# Expect tip SHA + migration >= 0078
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Pre-existing enterprise-matrix FAILs (Graph / golive / PARTIAL E2E) out of Autopilot scope
- Live book must persist Graph mailbox as `interviewerEmail` so prep Autopilot can send

## Watch out

- Deploy tip with amended 0078 together (candidate booking fallback + heyreach RPC)
- Do not mark goal complete until live Fly tip + migration ≥ 0078 + Autopilot E2E
