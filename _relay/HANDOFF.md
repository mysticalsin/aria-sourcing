---
project: MSourcing / ARIA
shift: 111
agent: cursor-cloud
updated: 2026-09-08T19:05Z
status: fleet-take-control-ui-green
---

# Handoff — Shift 111

## Current state

- **Branch:** `cursor/linkedin-auto-vm-fleet-b91d` @ `3a6cccc` (+pending docs)
- **Fly UI:** `/login` 200 after rebuild with `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Take control:** Fleet panel + `/fleet/computers/:id/viewport`; human mutex works without remote OpenBot (local viewport URL)
- **Evidence:** `_relay/evidence/2026-09-08-fleet-take-control-ui.md`
- **Video:** `/opt/cursor/artifacts/aria-fleet-take-control-demo.mp4`

## Done this shift

1. Operator viewport when `COMPUTER_SUPERVISOR_URL` unset
2. Fleet ensure sync + Take control auto-opens view
3. Demo UI: create Browser Computer seat → Take control → viewport → Release
4. Fly redeploy with Supabase anon build-arg (fixes auth 503)

## Blockers

1. Live OpenBot Chromium host still not provisioned (`COMPUTER_SUPERVISOR_*`)
2. Fly login needs real GoTrue user (Azure login off); demo login stays off on tenant

## Next steps

1. Owner: set `COMPUTER_SUPERVISOR_URL/TOKEN` + `COMPUTER_TOKEN` on Fly
2. Owner: log into each seat via Take control remote desktop
3. Smoke Automatic LinkedIn send on one seat

## Decisions made (don't relitigate)

- Production = Fly only
- Take control must work in Aria even before remote Chromium is bound (operator viewport)
- Never `COMPUTER_SUPERVISOR_MOCK_SEND=1` on prod

## Watch out

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is a **build-arg** — runtime secrets alone will not fix browser auth
- Do not commit `.env.local`
