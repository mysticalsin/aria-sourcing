---
project: MSourcing / ARIA
shift: 413
agent: cursor-cloud
updated: 2026-08-29T22:30Z
status: ops-blocked-stale-deploy-confirm
---

# Handoff — Shift 413

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #40** (tip = `git rev-parse HEAD`)
- **CODE:** Autopilot path complete in source (ops only) — skeptical re-audit found no material code gap
- **Live Fly:** `1665b39` / **0074** — tip + **0076–0079** not applied
- **Dropzones:** Microsoft/LLM absent → Graph = **HOLD**
- **Deploy:** `/tmp/owner-deploy-confirm.env` exists but targets **`1665b39`** (live), **not** tip — do **not** use for tip deploy
- **Docs:** STATUS cites PR #40

## Done this shift

1. Confirmed tip / PR #40 open; Fly still 0074
2. Validated owner-deploy-confirm is stale (SHA mismatch vs tip) — refuse to deploy with it
3. Printed tip-bound confirm via `print-fly-deploy-confirm.sh` for owner

## Blockers (ops only)

1. Owner: remint tip-bound confirm then `bash scripts/fly-deploy-now.sh` (applies **0076–0079**)
2. Settings HeyReach; entitle; Sequences; `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams
4. WA Meta template / HeyReach `{message}`

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh   # must match git rev-parse HEAD
# export printed ARIA_* (do not reuse /tmp/owner-deploy-confirm.env @ 1665b39)
bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# expect tip SHA + migration >= 0079
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Never deploy with a confirm whose SHA ≠ `git rev-parse HEAD`
- Tip Autopilot CODE is complete pending ops

## Watch out

- Stale `/tmp/owner-deploy-confirm.env` is for live `1665b39` — using it cannot ship tip Autopilot
- Do not mark goal complete until live Fly tip + migration ≥ **0079** + Autopilot E2E
