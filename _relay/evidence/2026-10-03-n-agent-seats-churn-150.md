# seatsRef port onto #150 (2026-10-03)

- Source: `4ca658e` on `cursor/n-agent-pollgen-seats-churn-6d88`
- Target: `cursor/fly-deploy-land-n-agent-b91d` (PR #150)
- Files: `src/components/campaigns/campaign-agents-panel.tsx`, `tests/campaign-soft-nav-attach.mts`
- Contract: `node --experimental-strip-types tests/campaign-soft-nav-attach.mts` → 15 passed, 0 failed
- Behavior: bump `pollGeneration` / clear durable only on `campaignId`; seats/Hermes via refs
