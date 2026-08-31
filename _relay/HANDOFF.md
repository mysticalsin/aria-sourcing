---
project: MSourcing / ARIA
shift: 437
agent: cursor-cloud
updated: 2026-08-31T13:04Z
status: fly-6pn-web-bind-pr-open
---

# Handoff — Shift 437

## Current state

- **PR #55 OPEN** https://github.com/mysticalsin/aria-sourcing/pull/55
- Branch `cursor/fly-web-ipv6-6pn-7595` from `main` (`1847c79`)
- Bind fix commit `2de3a4a`: `HOSTNAME` is `::` in `fly.app.toml` and `Dockerfile.prod`
- Live Fly still binds IPv4-only until this PR is deployed: loop ticks `dispatch:unreachable` over 6PN
- Did not touch PR 54 / sourcing-engine. Did not merge.

## Done this shift

1. Confirmed live failure mode from the request: `web.process.aria-mantu-app.internal` is IPv6 6PN; web listened on `0.0.0.0`
2. Set `HOSTNAME="::"` in `fly.app.toml` `[env]` and `Dockerfile.prod` runner ENV
3. Left image HEALTHCHECK on `127.0.0.1` (Linux dual-stack `::` still serves IPv4-mapped localhost)
4. Opened PR #55 against `main` with post-deploy verify steps
5. `npx tsc --noEmit` clean. Tests that read these files: `login-page` 17/17, `infra-release-contract` 134/134. Full `npm test` failed only on pre-existing `flyctl ENOENT` in `infra/agent-frameworks/fly/deployment.test.mjs` (this VM has no flyctl; unrelated toml files)

## Blockers

- None for the bind change
- Live loop drain stays degraded until Fly redeploys this image/env
- Do not merge from this agent

## Next steps

```bash
# After Fly deploy of this PR
# From the loop machine:
#   fetch(process.env.ARIA_WEB_INTERNAL_URL + '/api/health')  # must be ok
# Loop ticks must stop reporting dispatch:unreachable
curl -fsS https://aria-mantu-app.fly.dev/api/health
```

## Decisions made (don't relitigate)

- Listen bind is `::`, not `0.0.0.0`. Fly `*.process.*.internal` is IPv6; IPv4-only bind breaks loop-to-web dispatch
- Keep Dockerfile HEALTHCHECK on `127.0.0.1`
- One logical change only: web listen bind for 6PN. No LinkedIn/Apify/OAuth/Vercel/PR54 work
- #49 closed permanently; #51 Europe successor already merged
- Slim Fly deploy preserves live 0079 migration identity (tip tree ledger ends 0054)

## Watch out

- Public `https://aria-mantu-app.fly.dev/api/cron/dispatch-outbound` already works; that does not prove 6PN
- Kong already dual-listens `0.0.0.0:8000, [::]:8000`; Next.js can only set one HOSTNAME
- Do not rebase onto sourcing-engine / PR 54
