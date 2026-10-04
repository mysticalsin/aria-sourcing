---
project: MSourcing / ARIA
shift: 257
agent: cursor-cloud
updated: 2026-10-03T03:55Z
status: tip-ci-dbsec-assisted-rpc-list-fix
---

# Handoff — Shift 257

## Current state

- **Branch:** `cursor/linkedin-human-claude-chrome-b91d`
- **PR:** https://github.com/mysticalsin/aria-sourcing/pull/148
- **Prior tip:** `33c45cb` (dropped 0086; excluded email wrapper from service_functions)
- **CI on 33c45cb:** Dependency audit / Secret scan / supply chain / CodeQL green; Database security failed on `record_linkedin_assisted_manual_send` wrongly listed as service RPC; Quality still pending when this shift started
- **This fix:** remove authenticated-member `record_linkedin_assisted_manual_send` from in-body service_functions list (no migration / no fingerprint retouch)
- **Fly:** `21a42e7…` stale; `agentFrameworks:false`
- **JEV:** portal key in `.env.local` for Reader best Aria uses

## Done this shift

1. `tests/db/function-privileges.sql` — assisted manual send is `authenticated` + `auth.uid()`, not service_role

## Blockers

1. No Fly deploy token / no Docker for fingerprint dumps
2. Owner: ARIA_JINA_API_KEY Fly secret + tip redeploy + Take→login→Release

## Next steps

1. Confirm tip CI green (Quality + Database security + audit)
2. Owner Fly tip SHA match + LI healthy
3. Do not UpdateGoal complete until Fly tip SHA + LI healthy

## Decisions (don't relitigate)

- Never invent sessionHealthy=true
- Mock send does not bypass sessionHealthy
- Do not re-add 0086 without updating legacy-baseline-public-schema.sha256
- Thin wrappers / authenticated-member RPCs must not be forced through service_role in-body checks
- Never commit ARIA_JINA_API_KEY
- CI audit `--omit=dev` until braces patches or Tailwind 4

## Watch out

- If Database security fails again, read the next signature — do not change function bodies without a new fingerprint dump
