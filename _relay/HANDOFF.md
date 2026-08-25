---
project: MSourcing / ARIA
shift: 63
agent: claude-code
updated: 2026-08-25 America/Toronto
status: build-and-readiness-map-published-branch-pushed
---

# Handoff - Shift 63

## Current state

- Branch `integration/sourcing-enrichment-on-main` is pushed and matches `origin`.
- Shift 62 (Rock 7 LinkedIn channel, `d46a3d2`) was committed and pushed. Its
  DB-proof blockers are still open and are now tracked as P-1 / P-4 in the new
  readiness register rather than only in this baton.
- Working tree is clean. The two files that had been sitting untracked since
  shift 62 are now committed:
  - `.gitlab-ci.yml` — manual GitLab fallback that restores a base64 secret
    bundle and runs `deploy-fly.sh`.
  - `src/components/floor3d/Floor3DScene.tsx` — **orphaned**: nothing imports
    it. Tracked so it is not lost; flagged as P-11 (wire it or delete it).

## Done this shift

- Added `docs/BUILD_AND_READINESS.md`: the map above the deep docs. It covers
  how the system is built (stack, Fly topology, the SQL authority model, the
  sourcing pipeline, the 11-stage loop DAG, the outreach gate, LinkedIn) and
  four gap registers with evidence:
  - P-1..P-12 production readiness
  - E-1..E-10 enterprise readiness
  - A-1..A-10 sourcing autopilot
  - L-1..L-8 LinkedIn autopilot
  Plus a sequenced Phase 0-4 path and the LinkedIn policy boundary that does
  not move.
- Closed L-3 in the same commit: `LINKEDIN_VENDOR_API_URL` and
  `LINKEDIN_VENDOR_API_KEY` are now documented in `.env.local.example` and
  `.env.production.example`, with the fail-closed / no-fallback behaviour
  stated.
- Linked the new document from `README.md` and `docs/README.md`. Also added
  the missing `docs/SOURCING.md` row to the documentation map — it had never
  been listed.

## Verification

Passed:

- `npm run typecheck` -> exit 0.
- `node --import tsx tests/repository-hygiene.mts` -> 11 passed, 0 failed.

Failed (pre-existing, not caused by this shift):

- `node --import tsx tests/docs-truth.mts` -> 45 passed, 1 failed.
  `FAIL: STATUS.md contains a recent, non-future ISO date`.
  `production-readiness/STATUS.md` is dated 2026-07-14; the freshness
  assertion has aged out. Tracked as P-12. Fix by re-reviewing STATUS.md
  against current source and re-dating it — not by bumping the date alone.

Not run in this checkout (same sandbox class as shift 62):

- `npm run test:all`, `npm run test:database`, `npm run test:manifest`,
  `npm run build` — Docker socket, loopback listeners, and Turbopack
  subprocess/port creation are all denied here.

## Blockers

1. P-1: migrations `0053` and `0054` have still never executed against a real
   Postgres. This is the top blocker for everything else.
2. P-2: the full gate set has never run green at one SHA on one machine.
3. P-12: `docs-truth` is red by STATUS.md time decay.

## Next steps

1. On a Docker-enabled machine at this SHA:
   `npm run typecheck && npm run typecheck:tests && npm run lint && npm run test:all && npm run test:database && npm run test:manifest && npm run build`.
2. Confirm `tests/cross-channel-cap-postgres.sh` prints
   `RESULT cross-channel-cap-postgres: concurrent_claims=1 active_claims=1 ambiguous=blocked linkedin=blocked deadlock=none privileges=service-only`.
3. Dump-diff review the three public functions added by `0054` (P-4).
4. Re-review and re-date `production-readiness/STATUS.md` (P-12).
5. Owner decisions that no amount of engineering can substitute for:
   L-2 (pick a compliant LinkedIn messaging vendor, or accept assisted-manual
   forever) and A-4 / A-5 / A-6 (how much authority a machine gets over a
   message to a real person).

## Decisions made (don't relitigate)

- Shift 62's decisions stand: no LinkedIn account fleet, captured session,
  proxy, scraper, or first-party automation; no vendor-api fallback to
  assisted-manual; Email and WhatsApp triggers stay untouched;
  `sequences_enabled` stays false.
- `docs/BUILD_AND_READINESS.md` is a map, not an authority. Where it disagrees
  with `docs/ARCHITECTURE.md`, `docs/SOURCING.md`, or
  `production-readiness/DEPLOYMENT_RUNBOOK.md`, those win on their own subject.
- The dated `production-readiness/*_REPORT.md` and `_relay/*audit*.md` sets are
  evidence, not current state.

## Watch out

- `Floor3DScene.tsx` is now tracked but dead. Do not assume it renders anything.
- The gap registers cite file paths and line numbers at `d46a3d2`. Line numbers
  drift; re-grep before trusting one.
- Claims in the new document are marked verified / assumed / unknown. Do not
  promote an assumed claim to verified without executing something.
