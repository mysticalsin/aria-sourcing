---
project: MSourcing / ARIA
shift: 199
agent: cursor-cloud
updated: 2026-09-12T09:00Z
status: fly-app-tip-deployed-owner-run
---

# Handoff — Shift 199

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` @ `21a42e7da6c271758ea4cade91c8d5658032832d`
- **Fly app:** https://aria-mantu-app.fly.dev — owner-run `scripts/prod-deploy-app.sh` shipped tip image (machines v305). `/api/health` 200.
- **Release identity:** `ARIA_RELEASE_SHA` secret set to tip; confirm `/api/ready.build == tip`.
- **Still not_ready:** `agentFrameworks=false` (DeerFlow/Flowise host cap). Fleet LinkedIn `sessionHealthy` still CAPTCHA/login wall (unchanged).
- **Deploy path used:** Fly only (no Vercel). App-only owner script after migrations already at `0084_*`. Fixed mirror to include `Dockerfile.prod` + client/server boundary for `HOST_ORPHAN_SEAT_ID`.

## Done this shift

1. Fly-only deploy of tip via sanctioned `prod-deploy-app.sh` (local Fly token + reviewed confirm + clean tree)
2. Fixed `prod-deploy-app.sh` mirror to copy `Dockerfile.prod` and stamp `ARIA_RELEASE_SHA`
3. Fixed client import of `HOST_ORPHAN_SEAT_ID` via `src/lib/computer-constants.ts` so Fly Next build succeeds
4. Set Fly secret `ARIA_RELEASE_SHA` to tip (secrets override deploy `--env`)

## Blockers

1. Human Take control → LinkedIn CAPTCHA/login/2FA → Release → `sessionHealthy:true`
2. Host cap / frameworks readiness (`agentFrameworks`)
3. Tip not on protected `deploy/fly-github-actions` (non-FF; GHA protected path still blocked) — live tip used owner app-only path instead
4. Live N-seat prove + sealed land with Messaging UI proof

## Next steps

1. Confirm `/api/ready.build == 21a42e7da6c271758ea4cade91c8d5658032832d`
2. Operator Take control on live computer → finish LinkedIn login → Release → probe healthy
3. Re-run marketing recorder; claim Messaging only with UI proof
4. Optionally FF/merge tip onto `deploy/fly-github-actions` for next protected full release

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Copy lessons stay separate from VM UI lessons
- Sealed outreach copy is the only text bots type/post
- **Do not bypass protected Fly release guards** — owner `prod-deploy-app.sh` with confirm is the sanctioned app-only path when DB ledger is current
- Fly only for LinkedIn / OpenBot / computers (not Vercel)

## Watch out

- `fly secrets` `ARIA_RELEASE_SHA` overrides `fly deploy --env`
- Mirror must include `Dockerfile.prod` (`fly.app.toml` dockerfile)
- Demo-login username `Twalteur@amaris.com`; ~5/min
