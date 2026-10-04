# Deep AI / outreach / Microsoft calendar audit — 2026-09-12

## Goal path (operator truth)

```
Outlook need → campaign → source → humanize draft (≤200 Connect note)
  → approve (gateOutbound) → AriaBot Browser Computer Connect/Message
  → candidate reply INTERESTED → book Teams on hiring-manager Outlook calendar
```

## Why Tony’s earlier message often “didn’t land”

1. **Browser Computer `sessionHealthy=false` / login wall** — send correctly refused; no recipient notification.
2. **Connect invite ≠ Messaging** — successful Connect appears under **My Network → Invitations**, not the Messaging inbox.
3. **Invite note > 200 chars** — LinkedIn greys out Send; zero notification (historical 280 truncate was wrong).
4. **Already Pending** — retry does not re-notify.
5. **UI “queued/sent” theater** — dry-run / assisted-manual must never be read as LinkedIn delivery.

Evidence: `_relay/evidence/exec-recruiting-e2e/LINKEDIN-NOTIFICATION-ROOT-CAUSE.md`, Tony reachout receipts with `healthy: false`.

## Gaps found → fixes shipped this shift

| Gap | Severity | Fix |
|-----|----------|-----|
| Drafts written as 120-word emails for default Connect | P0 | Hermes + TASK_SYSTEM LinkedIn Connect rules ≤200 chars; mock LinkedIn invite note via `fitLinkedInInviteNote` |
| Mid-sentence truncate still typed into Connect | P0 | OpenBot fail-closed when note ≫ 200; word-boundary fit only for mild overflow |
| Subject dumped into free DM box | P0 | OpenBot Message path types **body only** |
| Approve only soft-humanized | P1 | `/api/outreach/approve` runs `gateOutbound` + LinkedIn ≤200 enforce |
| Follow-ups skipped LinkedIn guardrail | P1 | `attemptLiveFollowUpGen` injects `linkedInGuardrailPrompt` + 200-char reminder |
| Vendor LinkedIn path skipped last-mile humanize | P1 | `linkedin-channel` humanizes body before vendor post |
| Graph calendar had no Teams meeting | P0 (Mantu) | `createGraphCalendarEvent` sets `isOnlineMeeting` + returns Teams `joinUrl` |
| Booking ignored `campaign.hiringManagerEmail` | P0 (Mantu) | `createBookingFor` pins HM when present on interviewer roster |
| Reply drafts promised dead `{{cal_link}}` | P1 | INTERESTED / QUALIFIED drafts promise Outlook+Teams booking instead of fake link |
| Humanizer skill under-specified | P2 | Skills playbook: ≤200 Connect + empathic voice; humanizer lexicon expanded |

## Still blocked (cannot invent)

- Tip not on protected Fly release (`/api/ready` stale)
- Live LinkedIn session still needs human Take control → login/2FA → Release → probe healthy
- Operator N-seat prove on live
- Graph free-busy against HM calendar (local busy check only) — next iteration
- Auto-attach Browser Computer on campaign create — still manual Attach

## Verification

- `npm run typecheck` green
- `npm run typecheck:tests` green
- `npx tsx tests/linkedin-connections.mts` — 52/52
- `npx tsx tests/linkedin-send-contract.mts` — 9/9
- `npx tsx tests/humanizer.mts` — 41/41
- `npx tsx tests/gate.mts` — 105/105
- `npx tsx tests/outreach-guardrails.mts` — 42/42
- Walkthrough video: `/opt/cursor/artifacts/2026-09-12-tony-walteur-ai-e2e-walkthrough.mp4`
- Receipt: `_relay/evidence/2026-09-12-tony-walteur-ai-e2e-receipt.json` (honest: tip not live; no invented Connect delivery)
