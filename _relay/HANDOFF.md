---
project: MSourcing / ARIA
shift: 85
agent: cursor-cloud
updated: 2026-08-26 UTC
status: multi-provider-sourcing-live
---

# Handoff - Shift 85

## Current state

- **Production:** https://aria-mantu-app.fly.dev · image **deployment-01M0Z5SFQR7AT2RRB4AHEH79TF** (version 40) · migration **0060**
- **Branch/PR:** `cursor/enterprise-autopilot-b91d` · #29
- Unified multi-provider sourcing is live: Source next batch → orchestrator fans out LinkedIn profiles (Apify under the hood when keyed), LinkedIn/web, GitHub, etc.
- Operator-facing platform stamps are LinkedIn/GitHub/… — never Apify. Source via Apify button removed from campaigns.
- E2E: `/api/sourcing-agent` returned 5 new LinkedIn candidates @ 84–94 (dedupe vs existing campaign inventory); zero Apify in payload. Artifact: `/opt/cursor/artifacts/sourcing-multiprovider-e2e.json`
- UI proof: Source next batch present, no Apify CTA. Artifact: `/opt/cursor/artifacts/campaign-source-next-batch-no-apify.png`
- Workspace has 1 Apify connector key row (LinkedIn profile search backend)

## Done this shift

- Provider registry + adapters (`src/lib/sourcing/providers/`)
- `runMultiProviderSourcing` orchestrator (parallel fan-out, richness-prefer merge, 80% floor)
- Wired sourcing-agent deterministic path + LinkedIn tool path + Hermes chat
- mapApifyCandidates defaults to `sourcePlatform: "LinkedIn"`
- Neutral Integrations / API key labels; removed SourceApifyButton from campaign page
- Tests: `multi-provider-sourcing`, updated apify/integrations/sourcing-agent fixtures
- Deployed to Fly + live API/UI verification

## Blockers

- `/api/ready` still reports old `ARIA_RELEASE_SHA` / agentFrameworks false (expected until release-identity secrets updated)
- Known pre-existing `infra-release-contract` fail on alternate deploy scripts

## Next steps

1. Optional: refresh workspace Integrations card copy from persisted state so Operators see "LinkedIn profile search"
2. Optional: purge pre-floor / legacy `sourcePlatform: Apify` rows
3. Update `ARIA_RELEASE_SHA` secret to match deployed image when doing a reviewed release

## Decisions made (don't relitigate)

- Apify is an invisible LinkedIn-profile backend — never operator-facing branding on campaign sourcing
- 80% quality floor remains hard; deepen search instead of lowering the bar
- Minimum batch target remains 10; honest shortfall when supply/dedupe cannot fill
- Do not commit passwords or Fly secrets into `_relay/` / git

## Watch out

- LinkedIn profile search (Apify) poll budget ~75s; orchestrator runs it in parallel with web/GitHub
- SERP + profile dedupe prefers profile richness for the same LinkedIn URL
