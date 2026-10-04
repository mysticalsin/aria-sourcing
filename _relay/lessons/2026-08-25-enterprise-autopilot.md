# Lesson — ARIA Enterprise Autopilot (2026-08-25)

## What worked
- Treat Postgres claim RPCs as the send authority; app-layer checks alone are insufficient for template_bound.
- Per-user entitlement (`profiles.autopilot_enabled`) + workspace switchboard is the right two-axis model.
- Production MCP must stay fail-closed without an allowlist row; env flags must never open prod alone.
- Auth callback tests must supply Host / x-forwarded-host after publicOrigin change.

## What failed / almost failed
- Cloud sandbox has no Docker → cannot close P-1/P-2 here; track in `_relay/issues-open.md`.
- `.gitlab-ci.yml` tripped infra-release-contract until marked as manual-only reviewed fallback.
- flyctl present without token broke config validate; soft-skip when unauthenticated.
- Roles panel entitlement UI broke "informational" live-role test (distance to phrase / setCurrentRole).

## Do not repeat
- Do not bump STATUS.md date without re-reviewing content (docs-truth freshness).
- Do not recreate claim RPCs without dump-diff against prior migration bodies.
- Do not enable ARIA_LOOP_KILL_SWITCH until migrations 0053–0056 proven on real Postgres.
