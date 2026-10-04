# Agents detach LWW + viewport loading theater (2026-10-03)

1. Agents poll detached via updateSeat(assignedCampaignIds) from Hermes snapshot — could wipe other-campaign durable attach
2. Viewport treated computer==null as unbound orphan reclaim theater

Fixes: skip detach PATCH when seat in durable bindings; unboundOrphan/canDrive require computer != null.
