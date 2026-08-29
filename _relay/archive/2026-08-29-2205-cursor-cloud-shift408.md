---
project: MSourcing / ARIA
shift: 408
agent: cursor-cloud
updated: 2026-08-29T21:55Z
status: enqueue-hash-bind-soft-gap
---

# Handoff — Shift 408

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39** (related lineage **PR #36** enterprise remains open)
- **CODE:** Autopilot + interviewerEmail + **0079** enqueue body/scope hash bind + confirm soft-gap fail-closed
- **Live Fly:** `1665b39` / **0074** — tip + **0076–0079** not applied
- **Dropzones:** absent → Graph = **HOLD**
- **Deploy:** no `ARIA_PROD_DEPLOY_CONFIRM`

## Done this shift

1. Migration **0079**: `enqueue_*_service` reject `approval-mismatch` when body/scope hash diverge
2. Worker: only soft-continue Graph/ops statuses; `double_booked`/`not_found`/etc fail-closed (no fake propose)
3. Honesty: STATUS + `_relay/e2e-audit-matrix.md` → live `1665b39`/0074, PR #39
4. Tests for soft-gap + double_booked + 0079 pins

## Blockers (ops only)

1. Owner: deploy tip + **0076–0079** via `print-fly-deploy-confirm` + `fly-deploy-now`
2. Settings HeyReach; entitle; Sequences; `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams
4. WA Meta zero-param template / HeyReach `{message}`

## Next steps

```bash
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# Expect tip SHA + migration >= 0079
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Pre-existing enterprise-matrix FAILs (Graph / golive / PARTIAL E2E) out of Autopilot scope
- Live book must persist Graph mailbox as `interviewerEmail`
- Service enqueue must bind approval body_hash + scope (0079)
- Confirm soft-gap allowlist is exhaustive; other statuses fail-closed

## Watch out

- Deploy tip with **0076–0079** together
- Do not mark goal complete until live Fly tip + migration ≥ **0079** + Autopilot E2E
