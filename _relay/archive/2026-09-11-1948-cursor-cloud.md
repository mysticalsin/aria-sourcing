---
project: MSourcing / ARIA
shift: 175
agent: cursor-cloud
updated: 2026-09-11T19:10Z
status: live-prove-login-wall-tip-not-released
---

# Handoff — Shift 175

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `1eba85a` (create-null + seat-own matching + prior reclaim-first stack)
- **Fly:** https://aria-mantu-app.fly.dev — build `8ea3370…` (**tip not live**); `/api/ready` `ok:false` (`agentFrameworks:false`)
- **PR:** #129 → `integration/sourcing-enrichment-on-main` (prior #126–#128 closed / branch wiped on close — recreate after push if needed)
- **Durable bot:** `comp_7fe31958-589b-497f-8de7-c5083bf53ff5` ↔ seat `600e8afa-a7c4-40ef-91c8-f4854fa9e5fc`
- **Host:** 3/5 computers; fleet list shows 1 bound row

## Done this shift

1. Live demo-login + fleet GET + `session_probe` → `sessionHealthy:false` (honest)
2. Floor/Fleet/Settings screenshots: LinkedIn Computer visible; floor badge **LinkedIn session unhealthy**
3. Take control opened computers desktop; LinkedIn **login wall**; no LinkedIn passwords in `/tmp/aria-e2e`; `release_control` done
4. Live action enum **missing** `reclaim_healthy_orphan` — only on tip
5. Evidence: `_relay/evidence/n-agent-live/` (+ `/opt/cursor/artifacts/*live*`)

## Blockers (goal incomplete)

1. Tip not on protected Fly release branch / deploy pipeline
2. LinkedIn login wall — needs human credentials / 2FA Take control
3. OPENBOT_MAX_COMPUTERS=5
4. `/api/ready` agentFrameworks:false (Deerflow/Flowise adapters)
5. Operator N-seat prove of tip features (create-null, reclaim-first) still outstanding on live

## Next steps

1. Land tip via protected release (`deploy/fly-github-actions`) — confirm `/api/ready` build SHA == tip
2. Human Take control → LinkedIn login on durable VM → Release → `session_probe` true
3. With tip live: Deploy/Login reclaim-before-mint; leave Floor open; prove N distinct computerIds, no cross-desk bleed
4. Mark PR ready only when tip SHA live + session prove + N-seat evidence

## Decisions (don't relitigate)

- Fly-only LinkedIn / OpenBot / computers
- Never invent `sessionHealthy=true` without `/session_probe`
- Never invent `computerId` from `seat.id`; never mint on GET/poll
- Reclaim must persist `agent_seats.computer_id` same request
- Poll GET+sync only; ensure must not steal durable bindings
- Login must not trust Hermes-only computerId over empty API/DB
- Floor/Settings sync Hermes from fleet GET
- All boot paths reclaim-before-mint; seat create leaves computerId null
- computerId fallback must not cross seat ownership
- Unique `(workspace_id, computer_id)` (0084)
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login ~5/min; user `Twalteur@amaris.com` (password in `/tmp/aria-e2e/demo_pw.clean` — do not commit)
- Closing PRs often deletes remote branch — push + recreate PR
- `comp_tony_01` login-wall twin; prefer UUID durable after probe
- Personalized invite notes free-tier max **200** chars
