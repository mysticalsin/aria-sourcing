---
project: MSourcing / ARIA
shift: 411
agent: cursor-cloud
updated: 2026-08-29T22:20Z
status: send-route-heal-closed
---

# Handoff — Shift 411

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #40** (supersedes closed #39; related **PR #36**)
- **CODE:** Autopilot + Approve→Send recipient + Graph heal fail-closed on Autopilot **and** send route
- **Live Fly:** `1665b39` / **0074** — tip + **0076–0079** not applied
- **Dropzones:** absent → Graph = **HOLD**
- **Deploy:** no `ARIA_PROD_DEPLOY_CONFIRM`
- **CI:** Actions jobs fail-fast (budget / rate-limit) — not a tip code signal

## Done this shift

1. `outreach/send` Graph + DNS `domain_verified` heal checks Supabase `{ error }` before in-memory true
2. Pin in `tests/outreach-recipient.mts`
3. Re-opened deliverable as **PR #40** after #39 was closed

## Blockers (ops only)

1. Deploy tip + **0076–0079**
2. Settings HeyReach; entitle; Sequences; `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams
4. WA Meta template / HeyReach `{message}`
5. Restore GitHub Actions budget / Vercel deploy rate limit if CI evidence needed

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Interviewer prep must never send/Autopilot to candidate email
- Graph/DNS heal must observe Supabase error on Autopilot **and** interactive Send
- Service enqueue binds approval body_hash + scope (0079)

## Watch out

- Deploy tip with **0076–0079** together
- Do not mark goal complete until live Fly tip + migration ≥ **0079** + Autopilot E2E
- Ignore Vercel/GHA phantoms when failures are rate-limit/budget
