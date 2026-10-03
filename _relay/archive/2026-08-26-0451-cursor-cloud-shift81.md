---
project: MSourcing / ARIA
shift: 81
agent: cursor-cloud
updated: 2026-08-26 UTC
status: campaign-persist-race-fixed-await-fly-deploy
---

# Handoff - Shift 81

## Current state

- **Branch:** `cursor/enterprise-autopilot-b91d` · commit **1bc1ba0** · PR **#28**
- **Production:** https://aria-mantu-app.fly.dev — still on prior build until Fly deploy (no `FLY_API_TOKEN` in agent env)
- User-reported **"Campaign not found. Retry with Source next batch"** after intake → fixed in code, not yet live

## Done this shift

- **Persist-before-source:** intake + launch call `flushWorkspaceSave()` before first `sourceNextBatch`
- **Sourcing retry:** up to 4× backoff retries when agent returns `CAMPAIGN_NOT_FOUND`
- **Title-fit filter:** `candidateMatchesRoleTitle` on LinkedIn/web leads (agent + mappers)
- **Mantu parsing:** profile-description skills, Healthtech industry, client-as-department
- **Role classification:** `Type: Consulting` no longer routes System Designer → finance
- **LinkedIn keywords:** title-first query via `buildLinkedInKeywords`
- **Context:** `flushWorkspaceSave` on `HermesContextValue`; store action count **129**
- Tests: `candidate-fit`, expanded `mantu-intake`/`roles-i18n`, `store-contracts` updated

## Blockers

- Fly deploy blocked: no `FLY_API_TOKEN` / `.fly-token.env` in cloud agent VM
- Pre-existing `infra-release-contract` fail (alternate deploy scripts)

## Next steps

1. Deploy to Fly with `ARIA_RELEASE_SHA=1bc1ba0` via `scripts/fly-deploy-now.sh`
2. E2E verify: intake System Designer email → campaign created → auto-source succeeds (no toast error)
3. Re-source System Designer → LinkedIn profiles titled "System Designer" / systems architect (not quality-only)
4. Confirm dry-run OFF for Pending Manual Send path if testing outreach

## Decisions made (don't relitigate)

- No LangChain rewrite; template drafts OK
- LinkedIn assisted-manual only; Confirm writes ledger
- Below-floor live leads: operator fit endorsement warn-through
- Experience floors → Senior for readiness

## Watch out

- Until deploy lands, production still has the debounced-save race
- Title-fit may return zero candidates if SERP has no title-aligned profiles — operator can broaden brief or retry
