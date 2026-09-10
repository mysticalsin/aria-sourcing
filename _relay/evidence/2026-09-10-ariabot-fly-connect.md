# AriaBot Fly connect verification — 2026-09-10

## Errors fixed
1. `Public demo: external provider access and durable delivery changes are disabled.`
2. `No AriaBot seat / Create an AriaBot Browser Computer seat first`
3. Follow-on: `not-linkedin-seat` from `upsert_linkedin_inbound_route`

## Fixes
- `ENABLE_PUBLIC_DEMO_ARIABOT=true` Fly secret + policy carve-out
- Migration `0083_ariabot_inbound_route_browser_computer.sql` applied on prod DB
- Connect API: Browser Computer inbound route failure is non-fatal

## Live proof
- App: https://aria-mantu-app.fly.dev
- Seat: LinkedIn Browser Computer `600e8afa-a7c4-40ef-91c8-f4854fa9e5fc` live
- Computer: `comp_7fe31958-589b-497f-8de7-c5083bf53ff5` status ready
- Navigate audit: warmup to https://www.linkedin.com/login
- View URL HTTP 200: https://aria-mantu-computers.fly.dev/view/comp_7fe31958-589b-497f-8de7-c5083bf53ff5

## Remaining human step
Operator Take control → LinkedIn login + 2FA once → Release → campaign Approve/Send.
