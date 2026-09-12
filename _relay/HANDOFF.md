---
project: MSourcing / ARIA
shift: 194
agent: cursor-cloud
updated: 2026-09-12T06:55Z
status: n-agent-isolation-hardened-tip-not-released
---

# Handoff — Shift 194

## Current state

- **Branch tip:** `cursor/openbot-desktop-vm-b91d` — N-agent isolation harden (cold reclaim/ensure steal, persist rollback, ops orphan filter, send sessionHealthy pace) + sealed outreach
- **Fly:** https://aria-mantu-app.fly.dev — tip **not live**; `/api/ready` still stale
- **Live fleet:** human LinkedIn login / `sessionHealthy` still outstanding — no invented delivery
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/139 (draft #139)

## Done this shift

1. POST `/api/fleet/computers` calls `hydrateWorkspaceSeatBindings` + `hydrateFromHost` before ensure/reclaim/navigate/session_probe (cold steal closed)
2. `releaseToOrphan` rolls back in-memory reclaim when `computer_id` persist fails (optional restore prior seat bind)
3. `resolveDurableComputerId` fail-closed on persist failure (no twin mint)
4. Ops board filters exclude `__orphan__` (matches summary)
5. Outreach send passes `sessionHealthy` for LinkedIn Browser Computer (undefined no longer skips the check)
6. Tests: computer-supervisor 81, boot-browser-computer 11; `npm run typecheck` green

## Blockers (goal incomplete)

1. Tip not on protected Fly release (`/api/ready` build SHA ≠ tip)
2. Human Take control + LinkedIn login/2FA (`sessionHealthy` still false)
3. Host cap / agent frameworks readiness on Fly
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
- Ambiguous N-seat send/approve ⇒ fail-closed
- Cold reclaim/ensure must pre-hydrate DB seat bindings; persist fail rolls back claim
- Fly-only LinkedIn / OpenBot / computers
- **Do not bypass protected Fly release guards**

## Watch out

- Demo-login `username` field; ~5/min; `Twalteur@amaris.com`
- Closing PRs often deletes remote branch
- Large mp4s stay in `/opt/cursor/artifacts/`
- Naming drift across tools — verify on-disk symbols with `rg` before editing
