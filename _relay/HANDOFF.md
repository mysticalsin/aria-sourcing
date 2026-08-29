---
project: MSourcing / ARIA
shift: 406
agent: cursor-cloud
updated: 2026-08-29T21:38Z
status: quiet-hold-graph-dropzones
---

# Handoff — Shift 406

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #39** tip `4281b55`
- **CODE:** Autopilot path complete in source (send + WA cold template + HeyReach `{message}` + prep critics + 0076/0077/0078 + sweep stale retry)
- **Live Fly:** `1665b39` / **0074** — tip + **0076/0077/0078** not applied
- **Dropzones:** `/tmp/owner-azure-app-id`, `/tmp/owner-microsoft.env`, `/tmp/owner-llm.env` **absent** → Graph = **HOLD**
- **Deploy:** no `ARIA_PROD_DEPLOY_CONFIRM` in agent env

## Done this shift

1. Quiet HOLD reconfirm — dropzones still empty; no Entra chase
2. Re-audited Autopilot code path (WA/HeyReach/prep/slices) — no further code gap without ops
3. `/api/ready` still `1665b39` / `0074`

## Blockers (ops only)

1. Owner: `bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh` (tip + **0076** + **0077** + **0078**)
2. Settings → Save HeyReach; entitle Autopilot; arm Sequences; set Fly `ARIA_LOOP_WORKSPACE_IDS`
3. Graph dropzones for live Teams / strict RESULT: PASS
4. WA cold: zero-param Meta template on seat; HeyReach campaign steps use `{message}` if SendMessage unavailable

## Next steps

```bash
# Owner deploy (agent cannot without ARIA_PROD_DEPLOY_CONFIRM):
bash scripts/print-fly-deploy-confirm.sh && bash scripts/fly-deploy-now.sh
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration}'
# Expect tip SHA + migration >= 0078

# Graph only when dropzones appear — never invent secrets
ls /tmp/owner-azure-app-id /tmp/owner-microsoft.env /tmp/owner-llm.env
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Pre-existing enterprise-matrix 4 FAILs (PR #36 / Graph probe / PARTIAL E2E) are out of this PR's Autopilot scope
- Quiet HOLD: reply HOLD and stop when only checking empty dropzones

## Watch out

- Deploy tip with 0078 together
- Sweep without `ARIA_LOOP_WORKSPACE_IDS` is unconfigured no-op
- Do not mark goal complete until live Fly evidence (tip build + migration ≥ 0078 + Autopilot E2E)
