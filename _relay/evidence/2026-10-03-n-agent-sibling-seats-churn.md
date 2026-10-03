# Sibling seats-churn wipe (2026-10-03)

After Agents seatsRef, tip hunt found the same remount/clear pattern on:

1. `campaign-go-live-checklist.tsx` — effect deps included `props.seats` → cleared durable on Floor Hermes patch
2. `setup-guide-panel.tsx` — effect deps `[seats, campaign, actions]` → wiped durable attach to Hermes theater

Fix: seatsRef + depend on campaignId only. Soft-nav contract 17/17.
