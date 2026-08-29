---
project: MSourcing / ARIA
shift: 414
agent: cursor-cloud
updated: 2026-08-29T22:40Z
status: tip-live-ready-graph-hold
---

# Handoff — Shift 414

## Current state

- **Branch / PR:** `cursor/rei-autopilot-send-b91d` → **PR #40**
- **Tip / live:** `b0cf56a` — `/api/ready` **ok:true**, migration **`0079_autopilot_enqueue_approval_hash_bind.sql`**, `components.migration:true`
- **Bootstrap:** fixed 0077 (`DROP FUNCTION` before recreate) → applied **0076–0079** cleanly (`[migrate] complete`)
- **Dropzones:** Microsoft / Azure / LLM owner files absent → Graph Teams = **HOLD** (`graph_secrets_missing=3`)
- **CODE:** Autopilot path in source; live Fly tip + ledger green; Autopilot **E2E still unproven** (entitle / Sequences / HeyReach Settings / `ARIA_LOOP_WORKSPACE_IDS` / WA template)

## Done this shift

1. Fixed `0077_heyreach_inbound_route.sql` — `drop function if exists upsert_linkedin_inbound_route(uuid,text,uuid)` before recreate (Postgres cannot remove `p_operator_label` DEFAULT from 0058/0060)
2. Pinned DROP in enterprise matrix evidence for 0077
3. Reminted tip confirm + `bash scripts/fly-deploy-now.sh` → DEPLOY_EXIT=0
4. Verified `curl /api/ready` → ready + tip SHA + 0079

## Blockers

1. Graph dropzones empty → no live Teams book / interviewer Graph mailbox path (HOLD — do not chase Entra)
2. Ops: Settings HeyReach; entitle `autopilot_enabled`; Sequences; `ARIA_LOOP_WORKSPACE_IDS`; WA Meta zero-param template
3. Autopilot E2E receipt still required before goal complete

## Next steps

```bash
curl -fsS https://aria-mantu-app.fly.dev/api/ready | jq '{ok,build,migration,components}'
# expect ok:true, build=b0cf56a…, migration=0079_…
ls /tmp/owner-azure-app-id /tmp/owner-microsoft.env /tmp/owner-llm.env
# if missing → Graph HOLD; continue Autopilot email/LI ops wiring instead
# Entitle workspace + Sequences + HeyReach Settings + ARIA_LOOP_WORKSPACE_IDS
# Prove Autopilot: inbound → draft → auto-send (email or LI) without human Approve
```

## Decisions made (don't relitigate)

- Never reintroduce full `state` on `read_workspace_state_for_loop`
- Autopilot fail-closed: ready + live critics + Sequences + entitlement
- HOLD when Microsoft dropzones empty
- Interviewer prep must never send/Autopilot to candidate email
- Never deploy with confirm whose SHA ≠ `git rev-parse HEAD`
- 0077 must DROP before recreate when removing parameter defaults

## Watch out

- Do not mark goal complete until Autopilot E2E evidence (not just ready green)
- Stale confirm files under `/tmp/owner-deploy-confirm.env.stale-*` — ignore
- Quiet HOLD: if follow-up is only empty Graph dropzone check → reply HOLD and stop
