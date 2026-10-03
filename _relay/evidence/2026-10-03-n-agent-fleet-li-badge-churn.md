# Fleet / LI / campaign badge seats-churn (2026-10-03)

1. `fleet/page.tsx` — refreshComputers deps included seats; remount + race wipe roster
2. `linkedin-connections-panel.tsx` — load deps included localSeats; remount wipe LI healthy
3. `campaigns/[id]/page.tsx` — durableAgentCount not stamped by campaignId → soft-nav foreign badge

Fix: seatsRef + pollGeneration; durableAgentAuthority {campaignId,count}. Soft-nav 20/20.
