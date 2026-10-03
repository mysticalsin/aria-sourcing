---
project: MSourcing / ARIA
shift: 103
agent: cursor-cloud
updated: 2026-09-05T18:57Z
status: openbot-browser-computer-primary
---

# Handoff — Shift 103

## Current state

- **Branch/PR:** `cursor/linkedin-auto-vm-fleet-b91d` → update PR #66 (or current open PR on this branch)
- **Product direction (locked):** Automatic LinkedIn outreach uses **OpenBot Browser Computer** (sandbox/VM via computer supervisor) — **not** LinkedIn OIDC or Vendor API as the send path
- Live Fly tip still has LinkedIn/fleet APIs; supervisor secrets may still be unset on Fly

## Done this shift

1. Credentials panel leads with OpenBot supervisor URL + Computer Supervisor vault token; OIDC/Vendor demoted to Advanced
2. `ensure_connect` accepts `LinkedIn Browser Computer`; creates seat with `computer_id` + `linkedin_delivery_backend=browser-computer`
3. Connections UI primary CTA: Create OpenBot Browser Computer seat; OIDC optional under details
4. Automatic seat preference / send path prefers Browser Computer over Vendor API
5. Documented OpenBot connect steps in `services/computer-supervisor/README.md`

## Blockers

1. Need real OpenBot supervisor base URL + token (Settings vault or Fly `COMPUTER_SUPERVISOR_URL` / `COMPUTER_SUPERVISOR_TOKEN`)
2. Admin login to create seat and complete LinkedIn login via Fleet Observe / Take control
3. Do **not** set `COMPUTER_SUPERVISOR_MOCK_SEND=1` on production

## Next steps

1. Operator: paste OpenBot supervisor URL + token in Settings → LinkedIn (or Fly secrets)
2. Create OpenBot Browser Computer seat → Fleet Observe → LinkedIn login/2FA in sandbox
3. Smoke Automatic send through supervisor; mark PR ready after smoke

## Decisions made (don't relitigate)

- Production = Fly only (`aria-mantu-app`)
- LinkedIn defaults Automatic; Manual opt-in
- **Automatic send path = OpenBot Browser Computer (primary)**; Vendor API is legacy optional; no silent assisted-manual fallback
- Login for Automatic seats happens inside the OpenBot sandbox (Fleet Observe), not via LinkedIn OIDC for send
- Postgres contact lease = only double-contact lock
- Aria vault primary; env fallback

## Watch out

- Rotate any Fly token shared in chat if transcript retained
- Never commit Fly tokens / supervisor secrets
- Provider string is `LinkedIn Browser Computer`; vault provider `Computer Supervisor`
