# N-agent tip hunt — pollGeneration seats churn

**When:** 2026-10-03T18:09Z  
**Tip:** `cursor/fly-deploy-land-n-agent-b91d` @ `a3e4862`  
**Scope:** ONE remaining correctness bug after soft-nav pollGeneration + Hermes gates clear.  
**Known closed skipped:** sessionHealthy invent; Fleet Deploy omit campaignId; Take campaignId when attached; PacketFX/pulse attach-gated; liveSeats excludes LI BC; durable `[]` authority; orphan reclaim probe-before-claim; soft-nav late prior-campaign paint (gen guard itself).

## Verdict

`src/components/campaigns/campaign-agents-panel.tsx:254|correctness|pollGeneration+effect clear on seats churn drops same-campaign durable/fleetLoaded|bump gen+clear only on campaignId change; seatsRef for merge`

## Why it breaks N agents after Fly tip land

1. Agents `refresh` deps include `seats` + `hermesCampaignSeats`.
2. Effect `[refresh]` clears durableSeats / fleetLoaded / computers and bumps `pollGeneration` on every refresh identity change.
3. Floor (5s) + Agents (4s) both ingest/patch Hermes seats → frequent seats identity changes while desks are live.
4. In-flight same-campaign fleet poll is discarded; UI falls back to Hermes / blocks Deploy until next poll settles.
5. Soft-nav fix correctly stops foreign-campaign late paint, but over-fires on seats churn (regression vs late same-campaign apply).
