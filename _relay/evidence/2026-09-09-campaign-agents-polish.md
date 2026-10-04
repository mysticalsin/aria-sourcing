# Campaign Agents E2E polish (2026-09-09)

## Fixed

- Observe starts VM (Fleet parity); Take control refuses success on `status=error`
- Toasts + human-control coaching; detach confirm when live
- `assigned_campaign_ids` persistence path (migration 0082 + seats PATCH)
- Audits: `campaign_id`, `jobId` on decide/act/act_done/act_failed

## Proof

- `npx tsc --noEmit` green
- `tests/computer-supervisor.mts` 19/19
- `tests/fleet-seats-assign.mts` 4/4
- `scripts/record-campaign-agents-vm-e2e.mjs` ok → `/opt/cursor/artifacts/aria-campaign-agents-vm-take-control.mp4`

## Fly note

Apply `supabase/migrations/0082_campaign_agent_bindings.sql` before relying on tenant Attach.
