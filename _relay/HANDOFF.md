---
project: MSourcing / ARIA
shift: 403
agent: cursor-cloud
updated: 2026-08-29T21:30Z
status: rei-post-0074-slice-fix
---

# Handoff — Shift 403

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39**
- **CODE:** Autopilot crons fixed for post-0074 revision-only reads (slice RPCs); sweep can merge outreach → Scheduled
- **Live Fly:** still `1665b39` / **0074**; Graph dropzones absent → **HOLD**; need deploy tip + **0076/0077/0078**

## Done this shift

1. Migration **0078**: booking/skills/outreach/scoring/identity slices + `merge_outreach_message`
2. Rewired crons to slices: `generate-outreach-draft`, `interview-prep-dispatch`, `autopilot-send-outreach`, `propose/confirm-calendar-book`, `run-sourcing-batch`
3. Sweep persists Scheduled via `merge_outreach_message` after durable queue
4. Helper `src/lib/workspace-loop-slices.ts`

## Blockers (ops only)

1. Deploy tip + apply **0076** + **0077** + **0078**
2. Settings HeyReach Save; entitle; arm Sequences; `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams
4. WA cold Meta template / HeyReach `{message}`

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# migration must show 0078_…
bash scripts/run-enterprise-e2e-partial.sh
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` blob on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty

## Watch out

- Tip before 0078 apply will 404/503 on prep/draft/sweep if only 0074 is live — deploy migration with tip
- Sweep without `ARIA_LOOP_WORKSPACE_IDS` is a no-op (`unconfigured`)
