---
project: MSourcing / ARIA
shift: 100
agent: cursor-cloud
updated: 2026-09-04T13:59Z
status: linkedin-fleet-pr64-open-fly-deploy-blocked
---

# Handoff — Shift 100

## Current state

- **Branch/PR:** `cursor/linkedin-auto-vm-fleet-b91d` → **PR #64** (draft) onto `integration/sourcing-enrichment-on-main`
- Tip SHA: `20110a1d88b895ad33da8f8429f568eb94beeeed`
- LinkedIn Automatic + vault plug-and-play + contact lease + fleet computers are on this tip
- Live Fly `https://aria-mantu-app.fly.dev` build `5728ad41…` / migration `0079_…`:
  - `/api/health` + `/api/ready` → 200
  - `/auth/linkedin` → **401** (route exists)
  - `/api/linkedin/connections`, `/api/fleet/computers`, `/api/knowledge/campaign` → **404** (tip not deployed)
- Agent has **no** `FLY_API_TOKEN` / admin credentials; requested via environment setup actions

---
project: MSourcing / ARIA
shift: 100
agent: cursor-cloud
updated: 2026-09-04T13:59Z
status: linkedin-fleet-pr64-open-fly-deploy-blocked
---

# Handoff — Shift 100

## Current state

- **Branch/PR:** `cursor/linkedin-auto-vm-fleet-b91d` → **PR #64** (draft) onto `integration/sourcing-enrichment-on-main`
- Tip SHA: `20110a1d88b895ad33da8f8429f568eb94beeeed`
- LinkedIn Automatic + vault plug-and-play + contact lease + fleet computers are on this tip
- Live Fly `https://aria-mantu-app.fly.dev` build `5728ad41…` / migration `0079_…`:
  - `/api/health` + `/api/ready` → 200
  - `/auth/linkedin` → **401** (route exists)
  - `/api/linkedin/connections`, `/api/fleet/computers`, `/api/knowledge/campaign` → **404** (tip not deployed)
- Agent has **no** `FLY_API_TOKEN` / admin credentials; requested via environment setup actions

## Done this shift

1. Fixed Rules-of-Hooks in LinkedIn connections panel (`enabled` skip when provider present)
2. Registered `linkedin-credentials` + fleet suites in application manifest; refreshed contract freeze (172/225)
3. Re-opened work as **PR #64**; pushed tip `20110a1`
4. Reconfirmed Fly golive blocker: LinkedIn fleet APIs absent on live tip
5. Local tip smoke (`next dev :3456`): LinkedIn/fleet/knowledge → **401** (not 404); `/auth/linkedin` → **503** needing vault OIDC — tip works; Fly deploy is the remaining gate

## Blockers

1. **Fly deploy** — needs `FLY_API_TOKEN` (or protected `deploy/fly-github-actions` workflow + recovery receipt). Agent cannot mutate production without it.
2. Live DB reports migration **0079**; this branch ledger tops at **0063** — reconcile before/during protected deploy (do not blindly image-swap).
3. Authenticated E2E needs `ADMIN_EMAIL` / `ADMIN_PASSWORD` (demo login off on Fly) + operator vault keys after deploy.

## Next steps

1. Owner: inject `FLY_API_TOKEN` (and ideally admin login) into Cloud Agent secrets, **or** dispatch protected Deploy Aria Mantu with this SHA after CI green + migration reconciliation
2. After deploy: prove `/api/linkedin/connections` → **401** (not 404); paste Aria vault keys; OIDC connect → Automatic Vendor or Browser Computer send
3. Mark PR #64 ready when Fly smoke passes

## Decisions made (don't relitigate)

- **Production = Fly only** — never Vercel
- LinkedIn delivery defaults to Automatic; Manual is opt-in
- Automatic = entitled vendor-api OR browser-computer; no silent assisted-manual fallback
- Postgres contact lease is the only double-contact lock
- **Aria vault keys are plug-and-play primary; env is fallback only**

## Watch out

- `COMPUTER_SUPERVISOR_MOCK_SEND=1` is tests-only — never production
- Live migration **0079** is not in this repo tip — investigate lineage before deploy
- Closed PRs #61 / #63 are superseded by **#64**


1. Fixed Rules-of-Hooks in LinkedIn connections panel (`enabled` skip when provider present)
2. Registered `linkedin-credentials` + fleet suites in application manifest; refreshed contract freeze (172/225)
3. Re-opened work as **PR #64**; pushed tip `20110a1`
4. Reconfirmed Fly golive blocker: LinkedIn fleet APIs absent on live tip
5. Local tip smoke (`next dev :3456`): LinkedIn/fleet/knowledge → **401** (not 404); `/auth/linkedin` → **503** needing vault OIDC — tip works; Fly deploy is the remaining gate

## Blockers

1. **Fly deploy** — needs `FLY_API_TOKEN` (or protected `deploy/fly-github-actions` workflow + recovery receipt). Agent cannot mutate production without it.
2. Live DB reports migration **0079**; this branch ledger tops at **0063** — reconcile before/during protected deploy (do not blindly image-swap).
3. Authenticated E2E needs `ADMIN_EMAIL` / `ADMIN_PASSWORD` (demo login off on Fly) + operator vault keys after deploy.

## Next steps

1. Owner: inject `FLY_API_TOKEN` (and ideally admin login) into Cloud Agent secrets, **or** dispatch protected Deploy Aria Mantu with this SHA after CI green + migration reconciliation
2. After deploy: prove `/api/linkedin/connections` → **401** (not 404); paste Aria vault keys; OIDC connect → Automatic Vendor or Browser Computer send
3. Mark PR #64 ready when Fly smoke passes

## Decisions made (don't relitigate)

- **Production = Fly only** — never Vercel
- LinkedIn delivery defaults to Automatic; Manual is opt-in
- Automatic = entitled vendor-api OR browser-computer; no silent assisted-manual fallback
- Postgres contact lease is the only double-contact lock
- **Aria vault keys are plug-and-play primary; env is fallback only**

## Watch out

- `COMPUTER_SUPERVISOR_MOCK_SEND=1` is tests-only — never production
- Live migration **0079** is not in this repo tip — investigate lineage before deploy
- Closed PRs #61 / #63 are superseded by **#64**
