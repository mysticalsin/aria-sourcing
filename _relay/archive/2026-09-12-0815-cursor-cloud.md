---
project: MSourcing / ARIA
shift: 195
agent: cursor-cloud
updated: 2026-09-12T07:36Z
status: n-agent-ownership-gates-tip-not-released
---

# Handoff — Shift 195

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` — N-agent ownership gates (boot ensure→start, start/take_control seat match, draft fail-closed, floor vmId, readiness honest frameworks bit) + prior isolation harden + sealed outreach
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` `ok:false`, `agentFrameworks:false` (honest — DeerFlow/Flowise not ready)
- **Live fleet:** human LinkedIn login / `sessionHealthy` still outstanding — no invented delivery
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/141 (draft #141; #140 closed)

## Done this shift

1. `bootBrowserComputer` fail-closes on ensure failure / seat mismatch before `start`
2. POST `start`/`take_control` require caller `seatId` == bound seat (409 on mismatch)
3. FE callers (fleet page, campaign agents, viewport) pass `seatId` on start/take_control
4. `resolveDurableComputerId`: `no-healthy-orphan` keeps owned unhealthy id (no twin mint); ownership mismatch still mints
5. LinkedIn draft generation fail-closes when N Browser seats and no explicit `seatId`
6. Floor `vmId` only from fleet-confirmed seat ownership (never Hermes-alone / orphan)
7. Readiness always probes `agentFrameworks` component bit; top-level `ok` ignores it only when not required
8. Tests: boot 13, computer-supervisor 82, readiness 15; typecheck + typecheck:tests green

## Blockers (goal incomplete)

1. Tip not on protected Fly release (`/api/ready` build SHA ≠ tip)
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false)
3. Host cap / DeerFlow+Flowise readiness on Fly (`agentFrameworks:false`)
4. Operator N-seat prove on live (distinct computerIds + floor pulses)
5. Graph free-busy + INTERESTED auto-book still next

## Next steps

1. Land tip via protected release — `/api/ready` build SHA == tip
2. Human Take control → LinkedIn login/2FA → Release → session probe healthy
3. Prove N distinct computerIds + floor pulses on live
4. Prove sealed Tony Walteur Connect land with UI proof
5. Mark PR ready only with tip live + healthy session + N-seat evidence

## Decisions (don't relitigate)

- Never invent `sessionHealthy=true` / LinkedIn delivered without probe + UI proof
- Recruiter-sealed Outreach copy is the only text bots may type/post — no last-mile rewrite
- Invite notes ≤ **200**; Message/Invite fail-closed on disabled Send / missing proof
- Orphan VMs must not green-badge or ops-drive other seats
- Ambiguous N-seat send/approve/draft ⇒ fail-closed
- Cold reclaim/ensure must pre-hydrate DB seat bindings; persist fail rolls back claim
- Start/Take require caller seatId ownership match
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
- Naming drift across tools — verify on-disk symbols with `rg` before editing
