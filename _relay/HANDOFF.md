---
project: MSourcing / ARIA
shift: 3
agent: cursor
updated: 2026-11-23 16:35 America/Sao_Paulo
status: in-progress
---

# Handoff — contact chat on HeyReach

## Current state
- Branch `cursor/contact-chat-heyreach-e11d`, based on `vercel-demo` at `f2d0d3d`.
- Contact chat is `/contacts`: one thread per person, a composer, exact-text approval, then send.
- HeyReach is a server-side token channel. It is off by default. The public account view is `/api/contacts/account` and never includes the token. A missing token shows "Add your account" linking to `/settings#linkedin-account`.
- Sends go through the fake HeyReach MCP `send_message` tool only when the channel is on and an unused exact-text approval matches. Channel off or a missing token refuses the send.
- People search is `aria/people-search` with a fake Apify transport. Results are synthetic and capped at 8. LinkedIn scraper actor ids are refused. No live HeyReach, Apify, or LinkedIn call exists in this slice.
- Gate on this shift: `npx tsc --noEmit && npm test` green, including `tests/contact-chat.mts`.

## Done this shift
- Added `src/lib/contact-chat/` (account view, server memory, fake HeyReach MCP, fake Apify people search, send).
- Added `/contacts`, `/api/contacts/*`, the settings LinkedIn account step, and the Contacts nav item.

## Blockers
- none

## Next steps
1. Keep this draft off `vercel-demo`. Do not retip `#296` or the frozen heads named in the task.
2. A later slice can persist the HeyReach token in the existing vault. This slice keeps it in process memory and never returns it.

## Decisions made (don't relitigate)
- Contact people in a chat. No workflow canvas.
- HeyReach is the send path, and only through its MCP, flag off until an operator turns it on.
- Apify is people search only. No LinkedIn scraper, browser login, Voyager, cookies, or rate-limit bypass.
- The LinkedIn account field matches the token-channel bar: token stays on the server, channel defaults off, missing token points at settings.
- Exact-text approval is single-use and person-scoped. Edited text needs a new approval.
- Fake transports only until a later slice wires a live official API.

## Watch out
- `src/lib/contact-chat/memory.ts` is server-only. Client components must import `account-view.ts` only.
- The token lives on `globalThis` so duplicated module instances share one record. Reset it with `resetContactChatMemory()` in tests.
