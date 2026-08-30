---
project: MSourcing / ARIA
shift: 404
agent: cursor-cloud
updated: 2026-08-29T21:40Z
status: rei-last-0074-cron-fixed
---

# Handoff — Shift 404

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **CODE:** All Autopilot/loop crons use post-0074 slices (including `poll-provider-run`); STATUS/manifest honesty updated
- **Live Fly:** still `1665b39` / **0074**; Graph dropzones absent → **HOLD**; deploy tip + **0076/0077/0078**

## Done this shift

1. Fixed `poll-provider-run` (last cron still reading full state blob)
2. `mapApifyCandidates` accepts `CandidateDedupeIdentity[]`
3. STATUS honesty: prep Autopilot + migrations through 0078
4. `workspace-loop-slices` contract suite + manifest freeze bump
5. Fly secrets checklist + `fly.app.toml` note for `ARIA_LOOP_WORKSPACE_IDS`

## Blockers (ops only)

1. Deploy tip + apply **0076** + **0077** + **0078**
2. Settings HeyReach Save; entitle; arm Sequences; set `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams
4. WA cold Meta template / HeyReach `{message}`

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty

## Watch out

- Deploy tip and 0078 together — tip without 0078 will miss slice RPCs
