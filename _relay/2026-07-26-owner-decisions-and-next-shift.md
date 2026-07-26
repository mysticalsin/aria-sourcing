# Owner decisions and the next shift — 2026-07-26

Written while the Integrator is unavailable (usage limit until **2026-08-01 15:19**). Rocks 1–4
are shipped; Rock 5 aborted at launch with nothing built. This is the document the next shift
should read first.

## What is true right now

Six commits, each green at its own SHA with the full gate plus `next build` run under Visionary
hands — not claimed, executed:

| SHA | What |
|---|---|
| `f5f1e47` | Provider-egress chokepoint — every provider call carries a policy-minted clearance |
| `fdd20cb` | The bypasses that chokepoint missed (transport imports, probe minting, doc honesty) |
| `453301e` | Release verifier admits Rock 1's `loop` process group — production deploys no longer abort *after* mutating production |
| `886df40` | Loop ignition + a kill switch enforced at enqueue, claim, pre-handler and dispatch |
| `d4ca9af` | Durable Apify runs, metered against caps proved un-raceable |
| `1f8dd39` | The shortlist approval door; all 7 declared stage transitions now have a producer |

At `1f8dd39`: 151 suites, 315 tests, 0 failed, `test:database` 0, `next build` 0,
`loop-jobs-db` 68 assertions plus per-kind SKIP LOCKED races plus cap races.

**Nothing has been pushed or deployed. G6 is untouched.** Everything above is local-only.

## Can it source real candidates?

Human-driven: yes, and it could before today. Log in, search, get candidates, get drafts, nothing
sends without approval.

Autonomously: **not yet.** Today closed the structural gaps — the loop can be ignited by a machine
credential, the per-workspace kill switch actually stops work, Apify runs survive the browser tab,
spend is metered, and the shortlist has a real approval door. What remains before an unattended run
produces contactable candidates is Rock 5 (lawful basis for provider-sourced candidates is a hard
gate, not a nicety) and the operational work in "carried" below.

## Decisions only the Owner can make

1. **Rock 0 — branch topology.** 23 remote-only and 62 local-only commits on
   `integration/sourcing-enrichment-on-main`, no upstream configured, not a fast-forward either way.
   Every commit above is local. Nothing reaches production until this is reconciled, and the choice
   of how (rebase, merge, force-push from a hydrated checkout) is not mine to make.
2. **Tenant-scoped ignition credentials.** `CRON_SECRET` is a single global secret and the target
   workspace arrives in an `x-aria-workspace-id` header, so any holder can ignite any tenant's loop.
   The switchboard still governs what actually runs. For multi-tenant enterprise this probably wants
   a per-workspace credential; it is a design decision with a key-management cost.
3. **The frozen protected-class pattern.** It matches protected-class TERMS, not instances:
   `locations: ["Lagos, Nigeria"]` is allowed. Widening it has a false-positive cost — Rock 2 already
   showed what that costs when it lands on the wrong field, refusing the surname "Young". Whether to
   widen is a compliance trade-off, deliberately left with the Owner.
4. **Lawful basis will block outreach that works today.** Rock 5 enforces it for provider-sourced
   candidates — the Article 14 population, i.e. everything Apify returns. That is correct under GDPR
   and it will stop campaigns that currently run. Worth knowing before it lands, not after.
5. **`fly scale count loop=0` now fails the release check** (a consequence of `453301e`): an absent
   declared process group reads as drift. If scaling the worker to zero is a workflow you want, say
   so and the verifier can distinguish "declared but scaled to zero" from "missing".
6. **Hermes fork (H4/H5).** Still unresolved from earlier shifts: `~/.hermes/hermes-agent` is 4444
   commits behind upstream and carries uncommitted Amaris HR-bot patches, one a live safety control.
   Upgrading touches a different product with different users.

## Found today, not yet fixed

**Phantom dependency — latent build break.** `src/components/floor3d/retro/RetroOfficeScene.tsx`
imports `three-stdlib`, which is NOT in `package.json`. It resolves only because
`@react-three/drei` depends on it, and the file is reachable from `src/app/floor/page.tsx`, so it
is in the build graph. The build is green today because the lockfile pins the transitive. It breaks
when drei is upgraded and drops it, or the lockfile is regenerated.

This is the same class as the regression that broke a clean build on 2026-07-24, and nothing in the
suite catches it: `tests/isolated-build.mts` passes seven assertions by string-matching the build
script without ever building, and a populated `node_modules` masks the phantom. The fix is one line
in `package.json`; the durable fix is an assertion that every external import resolves to a
DECLARED dependency. Not done here because degraded mode is prep-only and the build is currently
green — but it should be the first thing the next shift lands.

## Residuals carried from shipped rocks

- `assertDeclaredTransitionProducers` reads a hand-maintained producer map, so removing an enqueue
  without updating the map still passes. It would not have caught the defect it was written for. The
  stronger form asserts the named handler's body actually enqueues that kind.
- The reviewed-schema fingerprint cannot prove grant or owner deltas — the dump runs `--no-owner
  --no-privileges`. Those are covered separately by `tests/db/function-privileges.sql`.
- The eleven job kinds are hard-coded in `tests/loop-jobs-db.sh` rather than compared mechanically
  against `PIPELINE_STAGE_TRANSITIONS`.
- The privilege allowlist omits roughly 35 live public routines.
- Reaper-killed jobs are dead-lettered silently — no event, no authenticated read surface.
- No observability: no metrics, tracing or error reporting; `/api/health` is a constant.
- The swarm plane still has no disposable-Postgres proof; `tests/swarm-orchestration-db.sh` does not
  exist.
- Recorded blockers 4-8, 11-17, 19-23 and 27-32 from the 2026-07-24 state-of-the-union were never
  re-verified — that auditor ran without Bash, Grep or Glob. Neither confirmed nor retired.

## Environment hazards this session, all of which first looked like code failures

1. **OneDrive resurrects git-deleted files.** `.gitlab-ci.yml` (deleted for secret exposure) and
   `Floor3DScene.tsx` (deleted for breaking a clean build) reappeared as untracked files,
   byte-identical to the deleted versions and carrying their ORIGINAL mtimes. Check mtime before
   attributing an unexpected file to an agent.
2. **Stale Codex artifacts read as fresh output.** With a build refused by the protocol gate, no new
   `last.txt` is written and the file on disk is from a prior engagement. Check the artifact's mtime
   against the run. The verdict parser caught this one via a malformed final line.
3. **Docker address-pool exhaustion.** Each database suite creates its own compose project; after a
   long session Docker refuses new networks with `all predefined address pools have been fully
   subnetted`, which presents as a suite failure. `docker network prune -f`.
4. **A wrapper's exit code is not the proof's exit code.** A background command ending in
   `echo`/`tail` always exits 0. Read the `### EXIT <label> = N` line the runner writes.

## Next shift, in order

1. Land the `three-stdlib` declaration plus an every-import-is-declared assertion.
2. Rock 5 — the brief is written and validated at `.rocket-fuel/brief-rock-5-dataprotection.md`.
   Launch it with `rf-codex.sh start workspace-write` once the Integrator resets.
3. Rock 6 (sequence engine, absorbing the suppression-column and unwindowed-dedupe defects, plus
   `max_sequence_sends_per_day` with a concurrency proof), then Rock 7 (LinkedIn adapter).
4. G6 presentation, and only then a push — after Rock 0 is resolved.

Do not skip the Level 10 proof runs. Five rocks, five first-run failures, every one found by
running the gate rather than reading the diff.
