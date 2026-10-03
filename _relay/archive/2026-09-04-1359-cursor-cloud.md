---
project: MSourcing / ARIA
shift: 99
agent: cursor-cloud
updated: 2026-09-04 UTC
status: linkedin-aria-vault-keys-wired
---

# Handoff — Shift 99

## Current state

- **Branch/PR:** `cursor/linkedin-auto-vm-fleet-b91d` → PR #61 (`integration/sourcing-enrichment-on-main`)
- LinkedIn delivery still defaults to **Automatic**; Manual is Settings toggle
- **Aria Settings vault is now the primary credential path** for LinkedIn OIDC, Vendor API, and Computer Supervisor (env remains fallback)
- New vault providers: `LinkedIn OIDC`, `LinkedIn Vendor API`, `Computer Supervisor`
- Settings fields on `SystemSettings`: `linkedinClientId`, `linkedinClientSecretKeyId`, `linkedinVendorApiUrl`, `linkedinVendorApiKeyId`, `computerSupervisorUrl`, `computerSupervisorTokenKeyId`
- Resolver: `src/lib/linkedin-credentials.ts` (session + workspace/service-role paths)
- UI: `LinkedInCredentialsPanel` inside LinkedIn outreach stack; API keys panel hints updated
- Adapters / OAuth / connections readiness / dispatch / send all resolve vault first

## Done this shift

1. Wired LinkedIn OIDC client secret, vendor API key, and computer-supervisor token to Aria API-key vault
2. Settings → LinkedIn plug-and-play panel (URLs + key selectors); secrets never stored in settings JSON
3. `linkedin-channel` + `computer-supervisor` accept vault-resolved credentials (env fallback)
4. OAuth start/callback + connections readiness use workspace settings + vault
5. Tests: `linkedin-credentials` 15/15, channel-contract 17/17, connections 47/47, computer-supervisor 8/8; `tsc --noEmit` green

## Blockers

- Live Fly tip still needs PR #61 deploy + migration **0063**
- Authenticated E2E still needs admin session + operator-pasted Aria keys (or env)
- N=100 computer RAM budget still not provisioned

## Next steps

1. Ops: deploy PR #61 to Fly; apply 0063
2. In Aria Settings: add LinkedIn OIDC / Vendor / Computer Supervisor keys → attach on LinkedIn stack
3. Smoke: OIDC connect → automatic Vendor or Browser Computer send; second seat blocked on same identity

## Decisions made (don't relitigate)

- **Production = Fly only** — never Vercel
- LinkedIn delivery defaults to Automatic; Manual is opt-in
- Automatic = entitled vendor-api OR browser-computer; no silent assisted-manual fallback
- Postgres contact lease is the only double-contact lock
- **Aria vault keys are plug-and-play primary; env is fallback only**

## Watch out

- `COMPUTER_SUPERVISOR_MOCK_SEND=1` is tests-only — never production
- `bindComputerSupervisorEndpoint` must be cleared in `finally` after browser deliver
- Vault providers must match exactly: `LinkedIn OIDC`, `LinkedIn Vendor API`, `Computer Supervisor`
